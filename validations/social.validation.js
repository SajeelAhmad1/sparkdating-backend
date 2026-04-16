const { z } = require('zod');

const objectIdString = z.string().min(1, 'Invalid user id');

const SOCIAL_VALIDATION = Object.freeze({
  blockUser: z.object({
    blockedUserId: objectIdString
  }),
  sendConnectionRequest: z.object({
    toUserId: objectIdString
  }),
  listConnectionRequests: z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    direction: z.enum(['received', 'sent']).optional().default('received')
  }),
  listBlocked: z.object({
    page: z.coerce.number().int().min(1).optional().default(1)
  })
});

module.exports = {
  SOCIAL_VALIDATION
};
