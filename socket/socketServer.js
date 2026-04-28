const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const { notifyNewChatMessage } = require('../services/fcmMessaging');

let io;
const onlineSocketCounts = new Map(); // userId -> number of connected sockets

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(event, data) {
  // eslint-disable-next-line no-console
  console.log(`[Socket] ${event}`, JSON.stringify(data ?? {}));
}

async function ensureConversationMember(conversationId, userId) {
  const cid = String(conversationId ?? '').trim();
  const uid = String(userId);
  if (!cid) return null;
  const conversation = await prisma.conversation.findUnique({ where: { id: cid } });
  if (!conversation) return null;
  if (!conversation.memberIds.map(String).includes(uid)) return null;
  return conversation;
}

function roomForConversation(conversationId) {
  return `conv:${String(conversationId)}`;
}

function roomForUser(userId) {
  return `user:${String(userId)}`;
}

function getUsersCurrentlyInConversation(conversationId) {
  if (!io) return new Set();
  const room = io.sockets.adapter.rooms.get(roomForConversation(conversationId));
  if (!room || room.size === 0) return new Set();
  const users = new Set();
  for (const sid of room) {
    const s = io.sockets.sockets.get(sid);
    const uid = s?.data?.userId;
    if (uid) users.add(String(uid));
  }
  return users;
}

async function emitPresenceToPeers(userId, isOnline) {
  if (!io) return;
  const me = String(userId);
  const conversations = await prisma.conversation.findMany({
    where: { memberIds: { has: me } },
    select: { memberIds: true }
  });
  const peers = new Set();
  for (const c of conversations) {
    for (const id of c.memberIds.map(String)) {
      if (id !== me) peers.add(id);
    }
  }
  const payload = { userId: me, status: isOnline ? 'online' : 'offline' };
  for (const pid of peers) {
    io.to(roomForUser(pid)).emit('presence:update', payload);
  }
  log('presence:update', payload);
}

// ── Core: emit message:new only to conversation room (no double-emit) ─────────
// FIX: previously also emitted to each user:<id> room causing duplicates.
// Now only the conversation room is used — all members in that room get it once.
// Members NOT in the room (background) rely on FCM push notification.
function emitMessageNew(conversationId, message) {
  if (!io) return;
  const payload = { conversationId: String(conversationId), message };
  io.to(roomForConversation(conversationId)).emit('message:new', payload);
  log('message:new', { conversationId, messageId: message.id });
}

// ── Shared message persistence (single source of truth) ──────────────────────
// Both socket message:send and REST sendMessage delegate here to avoid duplication.
async function persistAndBroadcast({ conversationId, senderId, type, text, media, streak }) {
  const createdAt = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: String(senderId),
      type,
      text: text ?? null,
      media: media ?? null,
      streakExpiresAt:
        type === 'streak'
          ? new Date(createdAt.getTime() + Number(streak.ttlSeconds) * 1000)
          : null
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt }
  });

  // Auto-mark read for recipients currently in the conversation room
  const inRoom = getUsersCurrentlyInConversation(conversationId);
  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const recipients = (conv?.memberIds ?? []).map(String).filter((id) => id !== String(senderId));
  const activeRecipients = recipients.filter((id) => inRoom.has(id));

  if (activeRecipients.length > 0) {
    await Promise.all(
      activeRecipients.map((rid) =>
        prisma.conversationReadState.upsert({
          where: { conversationId_userId: { conversationId, userId: rid } },
          create: { conversationId, userId: rid, lastReadMessageId: String(message.id), lastReadAt: message.createdAt },
          update: { lastReadMessageId: String(message.id), lastReadAt: message.createdAt }
        })
      )
    );
    // Notify room that these recipients have read up to this message
    io.to(roomForConversation(conversationId)).emit('message:read', {
      conversationId,
      messageId: String(message.id),
      userIds: activeRecipients
    });
    log('message:read (auto)', { conversationId, messageId: message.id, activeRecipients });
  }

  emitMessageNew(conversationId, message);

  notifyNewChatMessage({
    memberIds: conv?.memberIds ?? [],
    senderId,
    conversationId,
    message,
    suppressUserIds: activeRecipients
  }).catch(() => {});

  return message;
}

// ── Socket server init ────────────────────────────────────────────────────────

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true }
  });

  // Auth middleware
  io.use((socket, next) => {
    const raw = socket.handshake.auth?.token ?? socket.handshake.query?.token;
    const token = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : null;
    if (!token) return next(new Error('Unauthorized'));
    try {
      const decoded = verifyAccessToken(token);
      if (decoded.typ !== 'access') return next(new Error('Unauthorized'));
      socket.data.userId = String(decoded.sub);
      return next();
    } catch {
      return next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.data.joinedConversations = new Set();

    // Each user has a personal room for presence updates
    socket.join(roomForUser(userId));

    const prev = onlineSocketCounts.get(String(userId)) ?? 0;
    onlineSocketCounts.set(String(userId), prev + 1);
    if (prev === 0) {
      emitPresenceToPeers(userId, true).catch(() => {});
    }
    log('connection', { userId, totalSockets: prev + 1 });

    // ── conversation:join ─────────────────────────────────────────────────
    socket.on('conversation:join', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        await socket.join(roomForConversation(conversationId));
        socket.data.joinedConversations.add(conversationId);
        log('conversation:join', { userId, conversationId });
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // ── conversation:leave ────────────────────────────────────────────────
    socket.on('conversation:leave', (payload) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (conversationId) {
        socket.leave(roomForConversation(conversationId));
        socket.data.joinedConversations?.delete(conversationId);
        log('conversation:leave', { userId, conversationId });
      }
    });

    // ── message:send (socket is the ONLY send path) ───────────────────────
    socket.on('message:send', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');

        const type = payload?.type;
        if (!['text', 'image', 'streak'].includes(type)) throw new Error('Invalid type');
        if (type === 'text' && !payload?.text) throw new Error('Text is required');
        if ((type === 'image' || type === 'streak') && !payload?.media) throw new Error('Media is required');
        if (type === 'streak' && !payload?.streak?.ttlSeconds) throw new Error('streak.ttlSeconds is required');

        log('message:send', { userId, conversationId, type });

        const message = await persistAndBroadcast({
          conversationId,
          senderId: userId,
          type,
          text: payload?.text,
          media: payload?.media,
          streak: payload?.streak
        });

        if (typeof cb === 'function') cb({ ok: true, data: { message } });
      } catch (e) {
        log('message:send error', { userId, error: e.message });
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // ── message:read (socket-based read receipts) ─────────────────────────
    socket.on('message:read', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        const lastReadMessageId = String(payload?.lastReadMessageId ?? '').trim();
        if (!conversationId || !lastReadMessageId) throw new Error('conversationId and lastReadMessageId required');

        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');

        const message = await prisma.message.findUnique({
          where: { id: lastReadMessageId },
          select: { id: true, conversationId: true, createdAt: true }
        });
        if (!message || String(message.conversationId) !== conversationId) {
          throw new Error('Message not found in this conversation');
        }

        await prisma.conversationReadState.upsert({
          where: { conversationId_userId: { conversationId, userId: String(userId) } },
          create: { conversationId, userId: String(userId), lastReadMessageId: String(message.id), lastReadAt: message.createdAt },
          update: { lastReadMessageId: String(message.id), lastReadAt: message.createdAt }
        });

        // Broadcast read receipt to all members in the room
        io.to(roomForConversation(conversationId)).emit('message:read', {
          conversationId,
          messageId: String(message.id),
          userIds: [String(userId)]
        });
        log('message:read', { userId, conversationId, messageId: message.id });

        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // ── typing:start / typing:stop ────────────────────────────────────────
    // FIX: removed DB membership check on every keystroke — use joinedConversations set instead
    socket.on('typing:start', (payload, cb) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (!conversationId || !socket.data.joinedConversations?.has(conversationId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Not in conversation' });
        return;
      }
      socket.to(roomForConversation(conversationId)).emit('typing:update', {
        conversationId,
        userId: String(userId),
        isTyping: true
      });
      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('typing:stop', (payload, cb) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (!conversationId || !socket.data.joinedConversations?.has(conversationId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Not in conversation' });
        return;
      }
      socket.to(roomForConversation(conversationId)).emit('typing:update', {
        conversationId,
        userId: String(userId),
        isTyping: false
      });
      if (typeof cb === 'function') cb({ ok: true });
    });

    // ── presence:ping (query current online status) ───────────────────────
    socket.on('presence:ping', (payload, cb) => {
      const targetId = String(payload?.userId ?? '').trim();
      if (!targetId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'userId required' });
        return;
      }
      const isOnline = (onlineSocketCounts.get(targetId) ?? 0) > 0;
      const status = isOnline ? 'online' : 'offline';
      socket.emit('presence:update', { userId: targetId, status });
      if (typeof cb === 'function') cb({ ok: true, userId: targetId, status });
    });

    // ── disconnect ────────────────────────────────────────────────────────
    socket.on('disconnect', () => {
      const cur = onlineSocketCounts.get(String(userId)) ?? 0;
      const next = Math.max(0, cur - 1);
      if (next === 0) onlineSocketCounts.delete(String(userId));
      else onlineSocketCounts.set(String(userId), next);
      if (cur > 0 && next === 0) {
        emitPresenceToPeers(userId, false).catch(() => {});
      }
      log('disconnect', { userId, remainingSockets: next });
    });
  });

  return io;
}

module.exports = {
  initSocket,
  emitMessageNew,
  persistAndBroadcast,
  getUsersCurrentlyInConversation
};
