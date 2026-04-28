const { z } = require('zod');

const NOTIFICATIONS_VALIDATION = {
  updatePreferences: z
    .object({
      fcmEnabled: z.coerce.boolean()
    })
    .strict()
};

module.exports = {
  NOTIFICATIONS_VALIDATION
};

