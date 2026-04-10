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
    maxDistanceKm: z.number().min(1).max(300).default(50),
    minAge: z.number().int().min(18).max(100),
    maxAge: z.number().int().min(18).max(100),
    limit: z.number().int().min(1).max(50).default(20)
  }),
  swipe: z.object({
    toUserId: z.string().min(1),
    action: z.enum(['like', 'pass', 'super_like'])
  })
});

module.exports = {
  DISCOVERY_VALIDATION
};
