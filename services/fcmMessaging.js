const { getMessaging } = require('../utils/firebaseAdmin');
const prisma = require('../utils/prisma');

const BATCH = 500;

function buildDataPayload(conversationId, message, senderId) {
  const createdAt =
    message.createdAt instanceof Date ? message.createdAt.toISOString() : String(message.createdAt ?? '');
  const preview =
    message.type === 'text' && message.text
      ? String(message.text).slice(0, 400)
      : message.type === 'image'
        ? '[image]'
        : message.type === 'streak'
          ? '[streak]'
          : '';
  const out = {
    type: 'new_message',
    conversationId: String(conversationId),
    messageId: String(message.id),
    senderId: String(senderId),
    messageType: String(message.type ?? 'text'),
    textPreview: preview,
    createdAt
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)]));
}

function buildNotificationPayload(message) {
  const body =
    message.type === 'text' && message.text
      ? String(message.text).slice(0, 120)
      : message.type === 'image'
        ? 'Sent an image'
        : message.type === 'streak'
          ? 'Sent a streak'
          : 'New message';
  return {
    title: 'New message',
    body
  };
}

function collectInvalidTokens(responses, tokens) {
  const invalid = [];
  responses.forEach((r, i) => {
    if (r.success) return;
    const code = r.error?.code;
    if (
      code === 'messaging/invalid-registration-token' ||
      code === 'messaging/registration-token-not-registered'
    ) {
      invalid.push(tokens[i]);
    }
  });
  return invalid;
}

/**
 * Sends FCM data messages to all devices of conversation members except the sender.
 */
async function notifyNewChatMessage({ memberIds, senderId, conversationId, message, suppressUserIds = [] }) {
  const messaging = getMessaging();
  if (!messaging) return;

  const sender = String(senderId);
  const suppressed = new Set((suppressUserIds ?? []).map(String));
  const recipients = [...new Set(memberIds.map(String))].filter((id) => id !== sender && !suppressed.has(String(id)));
  if (recipients.length === 0) return;

  const enabledUsers = await prisma.user.findMany({
    where: { id: { in: recipients }, fcmNotificationsEnabled: true },
    select: { id: true }
  });
  const enabledIds = enabledUsers.map((u) => String(u.id));
  if (enabledIds.length === 0) return;

  const rows = await prisma.fcmToken.findMany({
    where: { userId: { in: enabledIds } },
    select: { token: true }
  });
  const tokenList = [...new Set(rows.map((r) => r.token).filter(Boolean))];
  if (tokenList.length === 0) return;

  const data = buildDataPayload(conversationId, message, sender);
  const notification = buildNotificationPayload(message);

  for (let i = 0; i < tokenList.length; i += BATCH) {
    const chunk = tokenList.slice(i, i + BATCH);

    // eslint-disable-next-line no-await-in-loop
    const batch = await messaging.sendEachForMulticast({
      tokens: chunk,
      notification,
      data,
      android: { priority: 'high' },
      apns: { headers: { 'apns-priority': '10' } }
    });
    const invalid = collectInvalidTokens(batch.responses, chunk);
    if (invalid.length > 0) {
      // eslint-disable-next-line no-await-in-loop
      await prisma.fcmToken.deleteMany({ where: { token: { in: invalid } } });
    }
  }
}

module.exports = {
  notifyNewChatMessage
};
