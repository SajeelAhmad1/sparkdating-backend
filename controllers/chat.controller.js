const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const prisma = require('../utils/prisma');
const { parseBody, parseQuery } = require('../utils/validation');
const { CHAT_VALIDATION } = require('../validations/chat.validation');
const { notifyNewChatMessage } = require('../services/fcmMessaging');
const { emitMessageNew, getUsersCurrentlyInConversation } = require('../socket/socketServer');

function toPeer(user) {
  return {
    id: String(user.id),
    firstName: user.profile?.firstName ?? null,
    lastName: user.profile?.lastName ?? null,
    photos: user.profile?.photos ?? []
  };
}

async function ensureConversationMember(conversationId, userId) {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId }
  });
  if (!conversation) throw new AppError('Conversation not found', 404);
  if (!conversation.memberIds.includes(userId)) throw new AppError('Forbidden', 403);
  return conversation;
}

exports.createDirectConversation = catchAsync(async (req, res) => {
  const { userId } = parseBody(CHAT_VALIDATION.createDirectConversation, req);
  const me = String(req.user.id);
  if (userId === me) throw new AppError('Cannot chat with yourself', 400);

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true }
  });
  if (!target) throw new AppError('User not found', 404);

  let conversation = await prisma.conversation.findFirst({
    where: {
      type: 'direct',
      memberIds: { hasEvery: [me, userId] }
    }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: {
        type: 'direct',
        memberIds: [me, userId]
      }
    });
  }

  res.status(201).json({
    status: 'success',
    data: { conversation }
  });
});

exports.listConversations = catchAsync(async (req, res) => {
  const { limit = 20 } = parseQuery(CHAT_VALIDATION.listConversations, req);
  const me = String(req.user.id);

  const conversations = await prisma.conversation.findMany({
    where: { memberIds: { has: me } },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: limit
  });

  const items = [];
  for (const c of conversations) {
    const peerId = c.memberIds.find((id) => id !== me) ?? null;
    // eslint-disable-next-line no-await-in-loop
    const [peer, lastMessage, readState, streakCount] = await Promise.all([
      peerId
        ? prisma.user.findUnique({
            where: { id: peerId },
            select: { id: true, profile: { select: { firstName: true, lastName: true, photos: true } } }
          })
        : Promise.resolve(null),
      prisma.message.findFirst({
        where: { conversationId: String(c.id) },
        orderBy: { createdAt: 'desc' }
      }),
      prisma.conversationReadState.findUnique({
        where: { conversationId_userId: { conversationId: String(c.id), userId: me } }
      }),
      prisma.message.count({
        where: {
          conversationId: String(c.id),
          type: 'streak',
          senderId: { not: me },
          streakExpiresAt: { gt: new Date() },
          streakViewedBy: { hasNone: [me] }
        }
      })
    ]);

    let unreadCount = 0;
    if (lastMessage) {
      if (!readState?.lastReadAt) {
        // eslint-disable-next-line no-await-in-loop
        unreadCount = await prisma.message.count({ where: { conversationId: String(c.id) } });
      } else {
        // eslint-disable-next-line no-await-in-loop
        unreadCount = await prisma.message.count({
          where: { conversationId: String(c.id), createdAt: { gt: readState.lastReadAt } }
        });
      }
    }

    const now = new Date();
    const ref = lastMessage?.createdAt ?? c.lastMessageAt ?? null;
    let chatStatus = 'active';
    if (ref) {
      const days = (now.getTime() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 5) chatStatus = 'locked';
      else if (days >= 3) chatStatus = 'lockingSoon';
    }

    items.push({
      conversationId: String(c.id),
      type: c.type,
      otherUser: peer ? toPeer(peer) : null,
      unreadCount,
      streakCount,
      chatStatus,
      lastMessage: lastMessage
        ? {
            id: String(lastMessage.id),
            type: lastMessage.type,
            text: lastMessage.text,
            // Prevent viewing snaps from the list screen.
            media: lastMessage.type === 'streak' ? null : lastMessage.media,
            streakExpiresAt: lastMessage.streakExpiresAt,
            createdAt: lastMessage.createdAt
          }
        : null,
      lastMessageAt: c.lastMessageAt
    });
  }

  res.json({
    status: 'success',
    data: { items }
  });
});

exports.listMessages = catchAsync(async (req, res) => {
  const { cursor, limit = 30 } = parseQuery(CHAT_VALIDATION.listMessages, req);
  const conversationId = String(req.params.conversationId ?? '').trim();
  if (!conversationId) throw new AppError('Conversation id is required', 400);
  const me = String(req.user.id);

  await ensureConversationMember(conversationId, me);

  const where = {
    conversationId,
    ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
  };

  const messages = await prisma.message.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit
  });

  // Snap (streak) rules:
  // - sender can never view it (media always redacted)
  // - receiver can view it only once (first time we return media, we mark it viewed)
  // - expired streaks never show media
  const now = new Date();
  const toMarkViewed = [];
  const redacted = messages.map((m) => {
    if (m.type !== 'streak') return m;

    const isSender = String(m.senderId) === me;
    const isExpired = m.streakExpiresAt ? new Date(m.streakExpiresAt) <= now : false;
    const alreadyViewed = Array.isArray(m.streakViewedBy) && m.streakViewedBy.includes(me);

    if (isSender || isExpired || alreadyViewed) {
      return { ...m, media: null };
    }

    // Receiver, not viewed yet, not expired: allow exactly once.
    toMarkViewed.push(String(m.id));
    return m;
  });

  if (toMarkViewed.length) {
    await Promise.all(
      toMarkViewed.map((id) =>
        prisma.message.update({
          where: { id },
          data: { streakViewedBy: { push: me } }
        })
      )
    );
  }

  const oldest = messages[messages.length - 1] ?? null;
  res.json({
    status: 'success',
    data: {
      items: redacted.reverse(),
      nextCursor: oldest ? oldest.createdAt.toISOString() : null
    }
  });
});

exports.sendMessage = catchAsync(async (req, res) => {
  const payload = parseBody(CHAT_VALIDATION.sendMessage, req);
  const conversationId = String(req.params.conversationId ?? '').trim();
  if (!conversationId) throw new AppError('Conversation id is required', 400);
  const me = String(req.user.id);

  const conversation = await ensureConversationMember(conversationId, me);

  if (payload.type === 'text' && !payload.text) {
    throw new AppError('Text is required for text message', 400);
  }
  if ((payload.type === 'image' || payload.type === 'streak') && !payload.media) {
    throw new AppError('Media is required for image/streak message', 400);
  }
  if (payload.type === 'streak' && !payload.streak?.ttlSeconds) {
    throw new AppError('streak.ttlSeconds is required for streak message', 400);
  }

  const createdAt = new Date();
  const message = await prisma.message.create({
    data: {
      conversationId,
      senderId: me,
      type: payload.type,
      text: payload.text ?? null,
      media: payload.media ?? null,
      streakExpiresAt: payload.type === 'streak' ? new Date(createdAt.getTime() + payload.streak.ttlSeconds * 1000) : null
    }
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { lastMessageAt: message.createdAt }
  });

  emitMessageNew(conversation.memberIds, conversationId, message);

  const inRoom = getUsersCurrentlyInConversation(conversationId);
  const recipients = conversation.memberIds.map(String).filter((id) => id !== String(me));
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
  }

  notifyNewChatMessage({
    memberIds: conversation.memberIds,
    senderId: me,
    conversationId,
    message,
    suppressUserIds: activeRecipients
  }).catch(() => {});

  res.status(201).json({
    status: 'success',
    data: {
      message
    }
  });
});

exports.markConversationRead = catchAsync(async (req, res) => {
  const { lastReadMessageId } = parseBody(CHAT_VALIDATION.markRead, req);
  const conversationId = String(req.params.conversationId ?? '').trim();
  if (!conversationId) throw new AppError('Conversation id is required', 400);
  const me = String(req.user.id);

  await ensureConversationMember(conversationId, me);

  const message = await prisma.message.findUnique({
    where: { id: lastReadMessageId },
    select: { id: true, conversationId: true, createdAt: true }
  });
  if (!message || String(message.conversationId) !== conversationId) {
    throw new AppError('Message not found in this conversation', 404);
  }

  const readState = await prisma.conversationReadState.upsert({
    where: { conversationId_userId: { conversationId, userId: me } },
    create: {
      conversationId,
      userId: me,
      lastReadMessageId: String(message.id),
      lastReadAt: message.createdAt
    },
    update: {
      lastReadMessageId: String(message.id),
      lastReadAt: message.createdAt
    }
  });

  res.json({
    status: 'success',
    data: {
      readState
    }
  });
});

