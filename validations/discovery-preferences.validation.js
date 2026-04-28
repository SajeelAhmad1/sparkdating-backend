const { z } = require('zod');

const DISCOVERY_PREFERENCES_VALIDATION = Object.freeze({
  update: z.object({
    youngerAgeDelta: z.number().int().min(0).max(30).optional(),
    olderAgeDelta: z.number().int().min(0).max(30).optional(),
    // API distance is in miles (we convert to km for storage/querying)
    maxDistanceMiles: z.number().int().min(1).max(300).optional(),
    // Backward compatible (older clients)
    maxDistanceKm: z.number().int().min(1).max(500).optional(),
    showMe: z.array(z.string().trim().min(1)).min(1).max(10).optional()
  })
});

module.exports = {
  DISCOVERY_PREFERENCES_VALIDATION
};
