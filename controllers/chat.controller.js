const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const prisma = require('../utils/prisma');
const { parseBody, parseQuery } = require('../utils/validation');
const { CHAT_VALIDATION } = require('../validations/chat.validation');

const { photoUrls } = require('../utils/photos');

function toIso(value) {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function toPeer(user) {
  return {
    id: String(user.id),
    firstName: user.profile?.firstName ?? null,
    lastName: user.profile?.lastName ?? null,
    photos: photoUrls(user.profile?.photos ?? [])
  };
}

async function ensureConversationMember(conversationId, userId) {
  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  if (!conversation) throw new AppError('Conversation not found', 404);
  if (!conversation.memberIds.includes(userId)) throw new AppError('Forbidden', 403);
  return conversation;
}

// ── REST: Create direct conversation ─────────────────────────────────────────
exports.createDirectConversation = catchAsync(async (req, res) => {
  const { userId } = parseBody(CHAT_VALIDATION.createDirectConversation, req);
  const me = String(req.user.id);
  if (userId === me) throw new AppError('Cannot chat with yourself', 400);

  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  if (!target) throw new AppError('User not found', 404);

  const peerId = String(userId);
  let conversation = await prisma.conversation.findFirst({
    where: { type: 'direct', memberIds: { hasEvery: [me, peerId] } }
  });

  if (!conversation) {
    conversation = await prisma.conversation.create({
      data: { type: 'direct', memberIds: [me, peerId] }
    });
  }

  res.status(201).json({ status: 'success', data: { conversation } });
});

// ── REST: List conversations ──────────────────────────────────────────────────
// FIX: replaced N+1 loop with batched parallel queries per conversation
exports.listConversations = catchAsync(async (req, res) => {
  const { limit = 20 } = parseQuery(CHAT_VALIDATION.listConversations, req);
  const me = String(req.user.id);

  const conversations = await prisma.conversation.findMany({
    where: { memberIds: { has: me } },
    orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
    take: limit
  });

  if (conversations.length === 0) {
    return res.json({ status: 'success', data: { items: [] } });
  }

  const convIds = conversations.map((c) => String(c.id));
  const peerIds = [...new Set(
    conversations
      .map((c) => c.memberIds.map(String).find((id) => id !== me))
      .filter(Boolean)
  )];

  // Batch all queries in parallel — no N+1
  const [peers, lastMessages, readStates, streakCounts, unreadCounts] = await Promise.all([
    // All peer profiles in one query
    prisma.user.findMany({
      where: { id: { in: peerIds } },
      select: { id: true, profile: { select: { firstName: true, lastName: true, photos: true } } }
    }),
    // Last message per conversation — one query, group in memory
    prisma.message.findMany({
      where: { conversationId: { in: convIds } },
      orderBy: { createdAt: 'desc' },
      distinct: ['conversationId']
    }),
    // All read states for me in one query
    prisma.conversationReadState.findMany({
      where: { conversationId: { in: convIds }, userId: me }
    }),
    // Streak counts per conversation in one aggregation
    prisma.message.groupBy({
      by: ['conversationId'],
      where: {
        conversationId: { in: convIds },
        type: 'streak',
        senderId: { not: me },
        streakExpiresAt: { gt: new Date() },
        NOT: { streakViewedBy: { has: me } }
      },
      _count: { id: true }
    }),
    // Unread counts per conversation
    prisma.message.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: convIds } },
      _count: { id: true }
    })
  ]);

  // Index into maps for O(1) lookup
  const peerMap = new Map(peers.map((p) => [String(p.id), p]));
  const lastMsgMap = new Map(lastMessages.map((m) => [String(m.conversationId), m]));
  const readStateMap = new Map(readStates.map((r) => [String(r.conversationId), r]));
  const streakMap = new Map(streakCounts.map((s) => [String(s.conversationId), s._count.id]));
  const totalMsgMap = new Map(unreadCounts.map((u) => [String(u.conversationId), u._count.id]));

  // For unread: need messages after lastReadAt — batch per conversation
  const unreadPerConv = new Map();
  await Promise.all(
    conversations.map(async (c) => {
      const cid = String(c.id);
      const readState = readStateMap.get(cid);
      const lastMsg = lastMsgMap.get(cid);
      if (!lastMsg) { unreadPerConv.set(cid, 0); return; }
      if (!readState?.lastReadAt) {
        unreadPerConv.set(cid, totalMsgMap.get(cid) ?? 0);
      } else {
        const count = await prisma.message.count({
          where: { conversationId: cid, createdAt: { gt: readState.lastReadAt } }
        });
        unreadPerConv.set(cid, count);
      }
    })
  );

  const now = new Date();
  const items = conversations.map((c) => {
    const cid = String(c.id);
    const peerId = c.memberIds.map(String).find((id) => id !== me) ?? null;
    const peer = peerId ? peerMap.get(String(peerId)) : null;
    const lastMessage = lastMsgMap.get(cid) ?? null;

    const ref = lastMessage?.createdAt ?? c.lastMessageAt ?? null;
    let chatStatus = 'active';
    if (ref) {
      const days = (now.getTime() - new Date(ref).getTime()) / (1000 * 60 * 60 * 24);
      if (days >= 5) chatStatus = 'locked';
      else if (days >= 3) chatStatus = 'lockingSoon';
    }

    return {
      conversationId: cid,
      type: c.type,
      otherUser: peer ? toPeer(peer) : null,
      unreadCount: unreadPerConv.get(cid) ?? 0,
      streakCount: streakMap.get(cid) ?? 0,
      chatStatus,
      lastMessage: lastMessage
        ? {
            id: String(lastMessage.id),
            type: lastMessage.type,
            text: lastMessage.text,
            senderId: String(lastMessage.senderId),
            media: lastMessage.type === 'streak' ? null : lastMessage.media,
            streakExpiresAt: toIso(lastMessage.streakExpiresAt),
            createdAt: toIso(lastMessage.createdAt)
          }
        : null,
      lastMessageAt: toIso(c.lastMessageAt)
    };
  });

  res.json({ status: 'success', data: { items } });
});

// ── REST: List messages (paginated history) ───────────────────────────────────
exports.listMessages = catchAsync(async (req, res) => {
  const { cursor, limit = 30 } = parseQuery(CHAT_VALIDATION.listMessages, req);
  const conversationId = String(req.params.conversationId ?? '').trim();
  if (!conversationId) throw new AppError('Conversation id is required', 400);
  const me = String(req.user.id);

  await ensureConversationMember(conversationId, me);

  const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
  const peerId = conversation?.memberIds?.find((id) => id !== me) ?? null;

  const where = {
    conversationId,
    ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {})
  };

  const [messages, peerReadState] = await Promise.all([
    prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit
    }),
    peerId
      ? prisma.conversationReadState.findUnique({
          where: { conversationId_userId: { conversationId, userId: String(peerId) } },
          select: { lastReadAt: true },
        })
      : null,
  ]);

  const peerReadAt = peerReadState?.lastReadAt ? new Date(peerReadState.lastReadAt) : null;

  const now = new Date();
  const toMarkViewed = [];
  const redacted = messages.map((m) => {
    if (m.type !== 'streak') return m;
    const isSender = String(m.senderId) === me;
    // Senders always keep their media — they took the photo, they can replay it.
    // Only receivers have the ephemeral view-once restriction.
    if (isSender) return m;
    const isExpired = m.streakExpiresAt ? new Date(m.streakExpiresAt) <= now : false;
    const alreadyViewed = Array.isArray(m.streakViewedBy) && m.streakViewedBy.includes(me);
    if (isExpired || alreadyViewed) return { ...m, media: null };
    toMarkViewed.push(String(m.id));
    return m;
  });

  if (toMarkViewed.length) {
    await Promise.all(
      toMarkViewed.map((id) =>
        prisma.message.update({ where: { id }, data: { streakViewedBy: { push: me } } })
      )
    );
  }

  const oldest = messages[messages.length - 1] ?? null;
  const items = redacted.reverse().map((m) => {
    const base = { ...m };
    if (String(m.senderId) === me && peerId && peerReadAt) {
      const msgAt = new Date(m.createdAt);
      if (msgAt <= peerReadAt) {
        base.readBy = [String(peerId)];
      }
    }
    return base;
  });

  res.json({
    status: 'success',
    data: {
      items,
      nextCursor: oldest ? oldest.createdAt.toISOString() : null
    }
  });
});

// NOTE: sendMessage (REST) and markConversationRead (REST) are intentionally removed.
// All message sending and read receipts are handled exclusively via Socket.IO.
// This eliminates the duplicate-message bug that occurred when both paths were active.
