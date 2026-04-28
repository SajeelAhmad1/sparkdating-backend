const { z } = require('zod');

const objectId = z.string().trim().min(1, 'Id is required');

const CHAT_VALIDATION = {
  createDirectConversation: z
    .object({
      userId: objectId
    })
    .strict(),
  listConversations: z
    .object({
      limit: z.coerce.number().int().min(1).max(50).optional()
    })
    .strict(),
  listMessages: z
    .object({
      cursor: z.string().datetime().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional()
    })
    .strict(),
  sendMessage: z
    .object({
      type: z.enum(['text', 'image', 'streak']),
      text: z.string().trim().min(1).max(2000).optional(),
      media: z
        .object({
          url: z.string().url(),
          width: z.number().int().positive().optional(),
          height: z.number().int().positive().optional(),
          mime: z.string().trim().min(1).optional(),
          size: z.number().int().positive().optional()
        })
        .optional(),
      streak: z
        .object({
          ttlSeconds: z.number().int().min(10).max(7 * 24 * 60 * 60)
        })
        .optional()
    })
    .strict(),
  markRead: z
    .object({
      lastReadMessageId: objectId
    })
    .strict()
};

module.exports = {
  CHAT_VALIDATION
};

