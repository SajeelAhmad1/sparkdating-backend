const { Server } = require('socket.io');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');
const { notifyNewChatMessage } = require('../services/fcmMessaging');

let io;

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
    socket.join(`user:${userId}`);

    // Join the conversation room when opening the thread
    socket.on('conversation:join', async (payload, cb) => {
      try {
        const conversationId = String(payload?.conversationId ?? '').trim();
        if (!conversationId) throw new Error('conversationId required');
        const conv = await ensureConversationMember(conversationId, userId);
        if (!conv) throw new Error('Forbidden');
        await socket.join(`conv:${conversationId}`);
        if (typeof cb === 'function') cb({ ok: true });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });

    socket.on('conversation:leave', (payload) => {
      const conversationId = String(payload?.conversationId ?? '').trim();
      if (conversationId) socket.leave(`conv:${conversationId}`);
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
        notifyNewChatMessage({
          memberIds: conv.memberIds,
          senderId: userId,
          conversationId,
          message
        }).catch(() => {});

        if (typeof cb === 'function') cb({ ok: true, data: { message } });
      } catch (e) {
        if (typeof cb === 'function') cb({ ok: false, error: e.message });
      }
    });
  });

  return io;
}

function emitMessageNew(memberIds, conversationId, message) {
  if (!io) return;
  const cid = String(conversationId);
  const payload = { conversationId: cid, message };

  io.to(`conv:${cid}`).emit('message:new', payload);
  for (const mid of memberIds.map(String)) {
    io.to(`user:${mid}`).emit('message:new', payload);
  }
}

module.exports = {
  initSocket,
  emitMessageNew
};

