const { z } = require('zod');

const objectId = z.string().trim().min(1, 'Id is required');

const USER_VALIDATION = {
  getUserById: z
    .object({
      userId: objectId
    })
    .strict()
};

module.exports = {
  USER_VALIDATION
};

