const { Expo } = require('expo-server-sdk');
const { getMessaging } = require('../utils/firebaseAdmin');
const prisma = require('../utils/prisma');

const expo = new Expo();
const BATCH_SIZE = 500;
const FCM_TTL_SECONDS = 4 * 7 * 24 * 3600; // 4 weeks

// ── Payload builders ──────────────────────────────────────────────────────────

function buildPreview(message) {
  if (message.type === 'text' && message.text) return String(message.text).slice(0, 120);
  if (message.type === 'image') return 'Sent an image';
  if (message.type === 'streak') return 'Sent a streak';
  return 'New message';
}

function buildDataPayload(conversationId, message, senderId) {
  const createdAt =
    message.createdAt instanceof Date
      ? message.createdAt.toISOString()
      : String(message.createdAt ?? '');
  const preview =
    message.type === 'text' && message.text
      ? String(message.text).slice(0, 400)
      : message.type === 'image' ? '[image]'
      : message.type === 'streak' ? '[streak]'
      : '';
  const out = {
    type: 'new_message',
    conversationId: String(conversationId),
    messageId: String(message.id),
    senderId: String(senderId),
    messageType: String(message.type ?? 'text'),
    textPreview: preview,
    createdAt,
  };
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, String(v)]));
}

// ── Token cleanup (Firebase) ──────────────────────────────────────────────────

function collectInvalidFcmTokens(responses, tokens) {
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

// ── Send via Expo Push Service (for ExponentPushToken[...] tokens) ────────────

async function sendViaExpoPush({ expoTokens, message, conversationId, senderId }) {
  if (expoTokens.length === 0) return { sent: 0, failed: 0, invalidRemoved: 0 };

  const body = buildPreview(message);
  const data = buildDataPayload(conversationId, message, senderId);

  const messages = expoTokens.map((token) => ({
    to: token,
    title: 'New message',
    body,
    data,
    sound: null, // no custom sound — avoids "custom sound not found" warning
    channelId: 'chat',
    priority: 'high',
    ttl: FCM_TTL_SECONDS,
    collapseKey: String(conversationId),
  }));

  const chunks = expo.chunkPushNotifications(messages);
  let sent = 0;
  let failed = 0;
  const invalidTokens = [];

  for (const chunk of chunks) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const receipts = await expo.sendPushNotificationsAsync(chunk);
      receipts.forEach((receipt, i) => {
        if (receipt.status === 'ok') {
          sent += 1;
        } else {
          failed += 1;
          console.warn('[FCM/Expo] Send error:', receipt.message, receipt.details);
          // Mark invalid Expo tokens for removal
          if (
            receipt.details?.error === 'DeviceNotRegistered' ||
            receipt.details?.error === 'InvalidCredentials'
          ) {
            invalidTokens.push(chunk[i].to);
          }
        }
      });
    } catch (err) {
      console.error('[FCM/Expo] Chunk send error:', err.message);
      failed += chunk.length;
    }
  }

  // Remove invalid tokens from DB
  let invalidRemoved = 0;
  if (invalidTokens.length > 0) {
    await prisma.fcmToken.deleteMany({ where: { token: { in: invalidTokens } } });
    invalidRemoved = invalidTokens.length;
    console.log(`[FCM/Expo] Removed ${invalidRemoved} invalid tokens`);
  }

  return { sent, failed, invalidRemoved };
}

// ── Send via Firebase Admin SDK (for raw FCM tokens) ─────────────────────────

async function sendViaFirebase({ fcmTokens, message, conversationId, senderId }) {
  if (fcmTokens.length === 0) return { sent: 0, failed: 0, invalidRemoved: 0 };

  const messaging = getMessaging();
  if (!messaging) {
    console.warn('[FCM/Firebase] Firebase not initialised — skipping');
    return { sent: 0, failed: fcmTokens.length, invalidRemoved: 0 };
  }

  const data = buildDataPayload(conversationId, message, senderId);
  const notification = { title: 'New message', body: buildPreview(message) };

  let sent = 0;
  let failed = 0;
  let invalidRemoved = 0;

  for (let i = 0; i < fcmTokens.length; i += BATCH_SIZE) {
    const chunk = fcmTokens.slice(i, i + BATCH_SIZE);
    try {
      // eslint-disable-next-line no-await-in-loop
      const batch = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification,
        data,
        android: {
          priority: 'high',
          ttl: FCM_TTL_SECONDS * 1000,
          collapseKey: String(conversationId),
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-collapse-id': String(conversationId),
            'apns-expiration': String(Math.floor(Date.now() / 1000) + FCM_TTL_SECONDS),
          },
        },
      });

      batch.responses.forEach((r) => {
        if (r.success) sent += 1;
        else failed += 1;
      });

      const invalid = collectInvalidFcmTokens(batch.responses, chunk);
      if (invalid.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await prisma.fcmToken.deleteMany({ where: { token: { in: invalid } } });
        invalidRemoved += invalid.length;
        console.log(`[FCM/Firebase] Removed ${invalid.length} invalid tokens`);
      }
    } catch (err) {
      console.error(`[FCM/Firebase] Batch error:`, err.message);
      failed += chunk.length;
    }
  }

  return { sent, failed, invalidRemoved };
}

// ── Main entry: routes tokens to correct sender ───────────────────────────────

async function sendFcmToTokens({ tokens, message, conversationId, senderId }) {
  const unique = [...new Set(tokens.filter(Boolean))];
  if (unique.length === 0) return { sent: 0, failed: 0, invalidRemoved: 0 };

  // Split tokens by type
  const expoTokens = unique.filter((t) => Expo.isExpoPushToken(t));
  const fcmTokens  = unique.filter((t) => !Expo.isExpoPushToken(t));

  console.log(`[FCM] Sending to ${expoTokens.length} Expo tokens, ${fcmTokens.length} FCM tokens`);

  const [expoResult, fcmResult] = await Promise.all([
    sendViaExpoPush({ expoTokens, message, conversationId, senderId }),
    sendViaFirebase({ fcmTokens, message, conversationId, senderId }),
  ]);

  return {
    sent: expoResult.sent + fcmResult.sent,
    failed: expoResult.failed + fcmResult.failed,
    invalidRemoved: expoResult.invalidRemoved + fcmResult.invalidRemoved,
  };
}

module.exports = { sendFcmToTokens };
