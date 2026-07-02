const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const { sendFcmToTokens } = require('../services/fcmMessaging');
const { photoUrl } = require('../utils/photos');

let io;
const onlineSocketCounts = new Map();

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(event, data) {
  console.log(`[Socket] ${event}`, JSON.stringify(data ?? {}));
}

function isUserOnline(userId) {
  return (onlineSocketCounts.get(String(userId)) ?? 0) > 0;
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

function emitMessageNew(conversationId, message, recipientIds = []) {
  if (!io) return;
  const serialized = serializeMessage(message, conversationId);
  const payload = { conversationId: String(conversationId), message: serialized };
  io.to(roomForConversation(conversationId)).emit('message:new', payload);
  for (const rid of recipientIds) {
    io.to(roomForUser(rid)).emit('message:new', payload);
  }
  log('message:new', { conversationId, messageId: serialized.id });
}

function serializeMessage(message, conversationId) {
  const toIso = (v) => {
    if (v == null) return null;
    return v instanceof Date ? v.toISOString() : String(v);
  };
  return {
    id: String(message.id),
    conversationId: String(message.conversationId ?? conversationId),
    senderId: String(message.senderId),
    type: message.type,
    text: message.text ?? null,
    media: message.media ?? null,
    streakExpiresAt: toIso(message.streakExpiresAt),
    streakViewedBy: Array.isArray(message.streakViewedBy) ? message.streakViewedBy.map(String) : [],
    createdAt: toIso(message.createdAt),
    updatedAt: toIso(message.updatedAt ?? message.createdAt),
  };
}

function emitMessageDelivered(conversationId, messageId, recipientIds, senderId) {
  if (!io || !recipientIds.length) return;
  const payload = {
    conversationId: String(conversationId),
    messageId: String(messageId),
    userIds: recipientIds.map(String),
  };
  io.to(roomForUser(String(senderId))).emit('message:delivered', payload);
  io.to(roomForConversation(conversationId)).emit('message:delivered', payload);
  log('message:delivered', { conversationId, messageId, recipientIds });
}

async function notifyDeliveredOnJoin(conversationId, viewerId) {
  const latestPeerMessage = await prisma.message.findFirst({
    where: { conversationId, senderId: { not: String(viewerId) } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, senderId: true },
  });
  if (!latestPeerMessage) return;
  emitMessageDelivered(
    conversationId,
    latestPeerMessage.id,
    [String(viewerId)],
    latestPeerMessage.senderId
  );
}

// ── FCM push (inline, no queue) ─────────────────────────────────────────────

async function sendPushNotification({ message, conversationId, senderId, memberIds, suppressUserIds = [] }) {
  try {
    const suppressed = new Set([String(senderId), ...suppressUserIds.map(String)]);
    const candidates = [...new Set(memberIds.map(String))].filter((id) => !suppressed.has(id));

    if (candidates.length === 0) return;

    const enabledUsers = await prisma.user.findMany({
      where: { id: { in: candidates }, fcmNotificationsEnabled: true },
      select: { id: true },
    });
    const enabledIds = enabledUsers.map((u) => String(u.id));
    if (enabledIds.length === 0) return;

    const tokenRows = await prisma.fcmToken.findMany({
      where: { userId: { in: enabledIds } },
      select: { token: true },
    });
    if (tokenRows.length === 0) return;

    const tokens = [...new Set(tokenRows.map((r) => r.token))];

    const sender = await prisma.user.findUnique({
      where: { id: String(senderId) },
      select: { profile: { select: { firstName: true, lastName: true, photos: true } } },
    });
    const senderName =
      `${sender?.profile?.firstName ?? ''} ${sender?.profile?.lastName ?? ''}`.trim() || 'New message';
    const senderPhotoUrl = photoUrl(sender?.profile?.photos?.[0]) ?? '';

    await sendFcmToTokens({
      tokens,
      message,
      conversationId,
      senderId,
      senderName,
      senderPhotoUrl,
    });
  } catch (err) {
    console.error('[FCM] Push failed:', err.message);
  }
}

// ── Shared message persistence ────────────────────────────────────────────────

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

  const conv = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const recipients = (conv?.memberIds ?? []).map(String).filter((id) => id !== String(senderId));

  emitMessageNew(conversationId, message, recipients);

  const deliveredRecipients = recipients.filter((id) => isUserOnline(id));
  if (deliveredRecipients.length > 0) {
    emitMessageDelivered(conversationId, message.id, deliveredRecipients, senderId);
  }

  const inRoom = getUsersCurrentlyInConversation(conversationId);
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

    const readPayload = {
      conversationId,
      messageId: String(message.id),
      userIds: activeRecipients
    };

    io.to(roomForConversation(conversationId)).emit('message:read', readPayload);
    io.to(roomForUser(String(senderId))).emit('message:read', readPayload);

    log('message:read (auto)', { conversationId, messageId: message.id, activeRecipients });
  }

  sendPushNotification({
    message,
    conversationId: String(conversationId),
    senderId: String(senderId),
    memberIds: (conv?.memberIds ?? []).map(String),
  });

  return message;
}

// ── Socket server init ────────────────────────────────────────────────────────

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true }
  });

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
    socket.data.convPeerMap = {};

    socket.join(roomForUser(userId));

    const prev = onlineSocketCounts.get(String(userId)) ?? 0;
    onlineSocketCounts.set(String(userId), prev + 1);
    if (prev === 0) {
      emitPresenceToPeers(userId, true).catch(() => {});
    }
    log('connection', { userId, totalSockets: prev + 1 });

    socket.on('conversation:join', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        await socket.join(roomForConversation(conversationId));
        socket.data.joinedConversations.add(conversationId);
        socket.data.convPeerMap[conversationId] = conv.memberIds
          .map(String)
          .filter((id) => id !== String(userId));
        log('conversation:join', { userId, conversationId });
        notifyDeliveredOnJoin(conversationId, userId).catch(() => {});
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('conversation:leave', (payload) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (conversationId) {
        socket.leave(roomForConversation(conversationId));
        socket.data.joinedConversations?.delete(conversationId);
        delete socket.data.convPeerMap[conversationId];
        log('conversation:leave', { userId, conversationId });
      }
    });

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

        if (typeof cb === 'function') {
          cb({ ok: true, data: { message: serializeMessage(message, conversationId) } });
        }
      } catch (e) {
        log('message:send error', { userId, error: e.message });
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('message:read', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        const lastReadMessageId = String(payload?.lastReadMessageId ?? '').trim();
        if (!conversationId || !lastReadMessageId) throw new Error('conversationId and lastReadMessageId required');

        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');

        const message = await prisma.message.findUnique({
          where: { id: lastReadMessageId },
          select: { id: true, conversationId: true, createdAt: true, senderId: true }
        });
        if (!message || String(message.conversationId) !== conversationId) {
          throw new Error('Message not found in this conversation');
        }

        await prisma.conversationReadState.upsert({
          where: { conversationId_userId: { conversationId, userId: String(userId) } },
          create: { conversationId, userId: String(userId), lastReadMessageId: String(message.id), lastReadAt: message.createdAt },
          update: { lastReadMessageId: String(message.id), lastReadAt: message.createdAt }
        });

        const readPayload = {
          conversationId,
          messageId: String(message.id),
          userIds: [String(userId)]
        };

        io.to(roomForConversation(conversationId)).emit('message:read', readPayload);

        const senderId = String(message.senderId ?? '');
        if (senderId && senderId !== String(userId)) {
          io.to(roomForUser(senderId)).emit('message:read', readPayload);
        }

        log('message:read', { userId, conversationId, messageId: message.id });
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    function broadcastTyping(conversationId, isTyping) {
      const typingPayload = { conversationId, userId: String(userId), isTyping };
      socket.to(roomForConversation(conversationId)).emit('typing:update', typingPayload);
      const peers = socket.data.convPeerMap?.[conversationId] ?? [];
      for (const pid of peers) {
        io.to(roomForUser(pid)).emit('typing:update', typingPayload);
      }
    }

    socket.on('typing:start', (payload, cb) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (!conversationId || !socket.data.joinedConversations?.has(conversationId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Not in conversation' });
        return;
      }
      broadcastTyping(conversationId, true);
      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('typing:stop', (payload, cb) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (!conversationId || !socket.data.joinedConversations?.has(conversationId)) {
        if (typeof cb === 'function') cb({ ok: false, error: 'Not in conversation' });
        return;
      }
      broadcastTyping(conversationId, false);
      if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('presence:ping', (payload, cb) => {
      const targetId = String(payload?.userId ?? '').trim();
      if (!targetId) {
        if (typeof cb === 'function') cb({ ok: false, error: 'userId required' });
        return;
      }
      const online = (onlineSocketCounts.get(targetId) ?? 0) > 0;
      const status = online ? 'online' : 'offline';
      socket.emit('presence:update', { userId: targetId, status });
      if (typeof cb === 'function') cb({ ok: true, userId: targetId, status });
    });

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
