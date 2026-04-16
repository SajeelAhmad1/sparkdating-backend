const { z } = require('zod');

const DISCOVERY_PREFERENCES_VALIDATION = Object.freeze({
  update: z.object({
    youngerAgeDelta: z.number().int().min(0).max(30).optional(),
    olderAgeDelta: z.number().int().min(0).max(30).optional(),
    maxDistanceKm: z.number().int().min(1).max(300).optional()
  })
});

module.exports = {
  DISCOVERY_PREFERENCES_VALIDATION
};
