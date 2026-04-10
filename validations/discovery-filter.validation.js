const { z } = require('zod');

const DISCOVERY_FILTER_VALIDATION = Object.freeze({
  update: z.object({
    youngerAgeDelta: z.number().int().min(0).max(30).optional(),
    olderAgeDelta: z.number().int().min(0).max(30).optional(),
    maxDistanceKm: z.number().int().min(1).max(300).optional(),
    isActive: z.boolean().optional()
  })
});

module.exports = {
  DISCOVERY_FILTER_VALIDATION
};
