const { z } = require('zod');

const REFERRAL_VALIDATION = Object.freeze({
  referralCode: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .optional(),
});

module.exports = { REFERRAL_VALIDATION };
