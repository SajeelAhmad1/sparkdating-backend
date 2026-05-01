const { Queue } = require('bullmq');

const QUEUE_NAME = 'fcm-notifications';

// ── Redis connection config ───────────────────────────────────────────────────
// Reads REDIS_URL (e.g. redis://localhost:6379) or falls back to localhost.
function redisConnection() {
  const url = process.env.REDIS_URL;
  if (url) {
    return {
      url,
      tls: url.startsWith('rediss://') ? {} : undefined,
    };
  }
  return {
    host: process.env.REDIS_HOST || 'localhost',
    port: Number(process.env.REDIS_PORT) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
  };
}

// Singleton queue instance — shared across the main process
let _queue = null;

function getFcmQueue() {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 }, // 1s → 2s → 4s
        removeOnComplete: { count: 500 },              // keep last 500 completed
        removeOnFail: { count: 200 },                  // keep last 200 failed for inspection
      },
    });

    _queue.on('error', (err) => {
      // eslint-disable-next-line no-console
      console.error('[FCMQueue] Queue error:', err.message || err.code || 'Connection failed - is Redis running?');
    });
  }
  return _queue;
}

/**
 * Enqueue an FCM notification job.
 * Called by persistAndBroadcast — fire-and-forget, never throws.
 *
 * @param {{ messageId: string, conversationId: string, senderId: string, memberIds: string[], suppressUserIds?: string[] }} payload
 */
async function enqueueFcmNotification(payload) {
  try {
    const queue = getFcmQueue();
    // Job id = messageId ensures idempotency at queue level (no duplicate jobs for same message)
    await queue.add('SEND_FCM_NOTIFICATION', payload, {
      jobId: `fcm_${payload.messageId}`,
    });
    // eslint-disable-next-line no-console
    console.log(`[FCMQueue] Enqueued job fcm:${payload.messageId}`);
  } catch (err) {
    // Never crash the chat flow if Redis is unavailable
    // eslint-disable-next-line no-console
    console.error('[FCMQueue] Failed to enqueue FCM job:', err.message);
  }
}

module.exports = { getFcmQueue, enqueueFcmNotification, QUEUE_NAME, redisConnection };
