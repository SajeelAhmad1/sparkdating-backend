const { z } = require('zod');

const ringSchema = z.array(z.tuple([z.number(), z.number()])).min(4);

const geometrySchema = z.union([
  z.object({
    type: z.literal('Polygon'),
    coordinates: z.array(ringSchema).min(1)
  }),
  z.object({
    type: z.literal('MultiPolygon'),
    coordinates: z.array(z.array(ringSchema).min(1)).min(1)
  })
]);

const SERVICE_AREA_VALIDATION = Object.freeze({
  create: z.object({
    name: z.string().min(2).max(120),
    countryCode: z.string().trim().min(2).max(3),
    isActive: z.boolean().optional(),
    geometry: geometrySchema
  }),
  update: z.object({
    name: z.string().min(2).max(120).optional(),
    countryCode: z.string().trim().min(2).max(3).optional(),
    isActive: z.boolean().optional(),
    geometry: geometrySchema.optional()
  })
});

module.exports = {
  SERVICE_AREA_VALIDATION
};
