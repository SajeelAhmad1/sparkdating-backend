const { z } = require('zod');

const FCM_VALIDATION = {
  tokenBody: z
    .object({
      token: z.string().trim().min(10, 'token is required').max(4096)
    })
    .strict()
};

module.exports = {
  FCM_VALIDATION
};
