/**
 * FCM Worker — run as a separate process:
 *   node workers/fcmWorker.js
 *
 * Responsibilities:
 *  1. Fetch message + recipients from DB
 *  2. Check idempotency (skip already-sent per user)
 *  3. Suppress online users
 *  4. Fetch & deduplicate FCM tokens
 *  5. Send via FCM
 *  6. Record delivery log
 */

require('dotenv').config();

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const prisma = require('../utils/prisma');
const { sendFcmToTokens } = require('../services/fcmMessaging');
const { QUEUE_NAME, redisConnection } = require('../queue/fcmQueue');

// ── Redis client for idempotency + online-user store ─────────────────────────

const conn = redisConnection();
const redisOpts = {
  ...(conn.url ? {} : conn),
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 1000, 30000),
  ...(conn.tls ? { tls: conn.tls } : {}),
};
const redis = conn.url ? new Redis(conn.url, redisOpts) : new Redis(redisOpts);

redis.on('error', (err) => console.error('[FCMWorker] Redis error:', err.message));

// ── Idempotency helpers ───────────────────────────────────────────────────────
// Key: fcm_sent:<messageId>:<userId>  TTL: 7 days
// Set before sending — if key exists, skip.

const IDEMPOTENCY_TTL = 7 * 24 * 3600; // 7 days in seconds

async function isAlreadySent(messageId, userId) {
  const key = `fcm_sent:${messageId}:${userId}`;
  const val = await redis.get(key);
  return val !== null;
}

async function markAsSent(messageId, userId) {
  const key = `fcm_sent:${messageId}:${userId}`;
  await redis.set(key, '1', 'EX', IDEMPOTENCY_TTL);
}

// ── Online-user suppression ───────────────────────────────────────────────────
// socketServer stores online counts in memory — not accessible cross-process.
// Worker uses Redis key: online:<userId> set by socketServer on connect/disconnect.
// See socketServer.js for where these keys are written.

async function isUserOnline(userId) {
  const val = await redis.get(`online:${userId}`);
  return val !== null && Number(val) > 0;
}

// ── Job processor ─────────────────────────────────────────────────────────────

async function processFcmJob(job) {
  const { messageId, conversationId, senderId, memberIds, suppressUserIds = [] } = job.data;

  console.log(`[FCMWorker] Processing job ${job.id} | messageId=${messageId}`);

  // 1. Fetch message from DB (source of truth)
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  if (!message) {
    console.warn(`[FCMWorker] Message ${messageId} not found — skipping`);
    return { skipped: true, reason: 'message_not_found' };
  }

  // 2. Build recipient list — exclude sender + suppressed
  const suppressed = new Set([String(senderId), ...suppressUserIds.map(String)]);
  const candidates = [...new Set(memberIds.map(String))].filter((id) => !suppressed.has(id));

  if (candidates.length === 0) {
    console.log(`[FCMWorker] No candidates for job ${job.id} — skipping`);
    return { skipped: true, reason: 'no_candidates' };
  }

  // 3. Filter: notifications enabled + not online + not already sent
  const eligibleIds = [];
  for (const userId of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const [alreadySent, online] = await Promise.all([
      isAlreadySent(messageId, userId),
      isUserOnline(userId),
    ]);

    if (alreadySent) {
      console.log(`[FCMWorker] Already sent to ${userId} for message ${messageId} — skipping`);
      continue;
    }
    if (online) {
      console.log(`[FCMWorker] User ${userId} is online — suppressing FCM`);
      continue;
    }
    eligibleIds.push(userId);
  }

  if (eligibleIds.length === 0) {
    console.log(`[FCMWorker] All recipients suppressed for job ${job.id}`);
    return { skipped: true, reason: 'all_suppressed' };
  }

  // 4. Check FCM notifications enabled in DB (batch)
  const enabledUsers = await prisma.user.findMany({
    where: { id: { in: eligibleIds }, fcmNotificationsEnabled: true },
    select: { id: true },
  });
  const enabledIds = enabledUsers.map((u) => String(u.id));

  if (enabledIds.length === 0) {
    console.log(`[FCMWorker] No users with FCM enabled for job ${job.id}`);
    return { skipped: true, reason: 'fcm_disabled' };
  }

  // 5. Fetch FCM tokens (deduplicated at DB level via unique constraint)
  const tokenRows = await prisma.fcmToken.findMany({
    where: { userId: { in: enabledIds } },
    select: { token: true, userId: true },
  });

  if (tokenRows.length === 0) {
    console.log(`[FCMWorker] No FCM tokens found for job ${job.id}`);
    return { skipped: true, reason: 'no_tokens' };
  }

  // 6. Mark idempotency keys BEFORE sending (prevents duplicate on retry race)
  await Promise.all(enabledIds.map((uid) => markAsSent(messageId, uid)));

  // 7. Send
  const tokens = [...new Set(tokenRows.map((r) => r.token))];
  const result = await sendFcmToTokens({ tokens, message, conversationId, senderId });

  console.log(
    `[FCMWorker] Job ${job.id} done | sent=${result.sent} failed=${result.failed} invalidRemoved=${result.invalidRemoved}`
  );

  return result;
}

// ── Worker setup ──────────────────────────────────────────────────────────────

const worker = new Worker(QUEUE_NAME, processFcmJob, {
  connection: redisConnection(),
  concurrency: 5, // process up to 5 jobs in parallel
});

worker.on('completed', (job, result) => {
  console.log(`[FCMWorker] Job ${job.id} completed`, result);
});

worker.on('failed', (job, err) => {
  console.error(`[FCMWorker] Job ${job?.id} failed (attempt ${job?.attemptsMade}):`, err.message);
});

worker.on('error', (err) => {
  // Worker-level error — do NOT crash
  console.error('[FCMWorker] Worker error:', err.message);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

async function shutdown() {
  console.log('[FCMWorker] Shutting down...');
  await worker.close();
  await redis.quit();
  await prisma.$disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

console.log('[FCMWorker] Started — listening for FCM jobs');
