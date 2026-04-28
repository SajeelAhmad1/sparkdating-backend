const { z } = require('zod');

const DISCOVERY_VALIDATION = Object.freeze({
  updateLocation: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  areaAvailability: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180)
  }),
  discoverProfiles: z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    cursor: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(50).default(10)
  }),
  swipe: z.object({
    toUserId: z.string().min(1),
    action: z.enum(['like', 'swipe'])
  })
});

module.exports = {
  DISCOVERY_VALIDATION
};
