const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const { notifyNewChatMessage } = require('../services/fcmMessaging');

let io;
const onlineSocketCounts = new Map(); // userId -> number of connected sockets

async function ensureConversationMember(conversationId, userId) {
  const cid = String(conversationId ?? '').trim();
  const uid = String(userId);
  if (!cid) return null;

  const conversation = await prisma.conversation.findUnique({
    where: { id: cid }
  });
  if (!conversation) return null;
  if (!conversation.memberIds.map(String).includes(uid)) return null;
  return conversation;
}

function roomNameForConversation(conversationId) {
  return `conv:${String(conversationId)}`;
}

function roomNameForUser(userId) {
  return `user:${String(userId)}`;
}

function getUsersCurrentlyInConversation(conversationId) {
  if (!io) return new Set();
  const room = io.sockets.adapter.rooms.get(roomNameForConversation(conversationId));
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
    io.to(roomNameForUser(pid)).emit('presence:update', payload);
  }
}

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
    socket.join(roomNameForUser(userId));

    const prev = onlineSocketCounts.get(String(userId)) ?? 0;
    onlineSocketCounts.set(String(userId), prev + 1);
    if (prev === 0) {
      emitPresenceToPeers(userId, true).catch(() => {});
    }

    // Join the conversation room when opening the thread
    socket.on('conversation:join', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        await socket.join(roomNameForConversation(conversationId));
        socket.data.joinedConversations.add(String(conversationId));
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('conversation:leave', (payload) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (conversationId) {
        socket.leave(roomNameForConversation(conversationId));
        socket.data.joinedConversations?.delete(String(conversationId));
      }
    });

    // Typing indicators
    socket.on('typing:start', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        socket.to(roomNameForConversation(conversationId)).emit('typing:update', {
          conversationId,
          userId: String(userId),
          isTyping: true
        });
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('typing:stop', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        socket.to(roomNameForConversation(conversationId)).emit('typing:update', {
          conversationId,
          userId: String(userId),
          isTyping: false
        });
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    // Optional: send messages over socket (persists + emits + triggers FCM)
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

        const createdAt = new Date();
        const message = await prisma.message.create({
          data: {
            conversationId,
            senderId: String(userId),
            type,
            text: payload?.text ?? null,
            media: payload?.media ?? null,
            streakExpiresAt:
              type === 'streak'
                ? new Date(createdAt.getTime() + Number(payload.streak.ttlSeconds) * 1000)
                : null
          }
        });

        await prisma.conversation.update({
          where: { id: conversationId },
          data: { lastMessageAt: message.createdAt }
        });

        emitMessageNew(conv.memberIds, conversationId, message);

        // If a recipient currently has this conversation open (joined the room),
        // we treat the message as read for that user and suppress FCM for them.
        const inRoom = getUsersCurrentlyInConversation(conversationId);
        const recipients = conv.memberIds.map(String).filter((id) => id !== String(userId));
        const activeRecipients = recipients.filter((id) => inRoom.has(String(id)));
        if (activeRecipients.length > 0) {
          await Promise.all(
            activeRecipients.map((rid) =>
              prisma.conversationReadState.upsert({
                where: { conversationId_userId: { conversationId, userId: String(rid) } },
                create: {
                  conversationId,
                  userId: String(rid),
                  lastReadMessageId: String(message.id),
                  lastReadAt: message.createdAt
                },
                update: {
                  lastReadMessageId: String(message.id),
                  lastReadAt: message.createdAt
                }
              })
            )
          );
          io.to(roomNameForConversation(conversationId)).emit('conversation:read', {
            conversationId,
            messageId: String(message.id),
            userIds: activeRecipients
          });
        }

        notifyNewChatMessage({
          memberIds: conv.memberIds,
          senderId: userId,
          conversationId,
          message,
          suppressUserIds: activeRecipients
        }).catch(() => {});

        if (typeof cb === 'function') cb({ ok: true, data: { message } });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('disconnect', () => {
      const cur = onlineSocketCounts.get(String(userId)) ?? 0;
      const next = Math.max(0, cur - 1);
      if (next === 0) onlineSocketCounts.delete(String(userId));
      else onlineSocketCounts.set(String(userId), next);
      if (cur > 0 && next === 0) {
        emitPresenceToPeers(userId, false).catch(() => {});
      }
    });
  });

  return io;
}

function emitMessageNew(memberIds, conversationId, message) {
  if (!io) return;
  const cid = String(conversationId);
  const payload = { conversationId: cid, message };

  io.to(roomNameForConversation(cid)).emit('message:new', payload);
  for (const mid of memberIds.map(String)) {
    io.to(roomNameForUser(mid)).emit('message:new', payload);
  }
}

module.exports = {
  initSocket,
  emitMessageNew,
  getUsersCurrentlyInConversation
};

