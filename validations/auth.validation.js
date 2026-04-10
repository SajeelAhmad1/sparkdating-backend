const { z } = require('zod');

const phoneSchema = z.string().trim().min(7).max(20);
const emailSchema = z.string().trim().email().max(120);

const contactBaseSchema = z.object({
  phone: phoneSchema.optional(),
  email: emailSchema.optional()
});

function requireExactlyOneContact(schema) {
  return schema.refine((data) => (data.phone ? 1 : 0) + (data.email ? 1 : 0) === 1, {
    message: 'Provide exactly one of phone or email'
  });
}

const contactSchema = requireExactlyOneContact(contactBaseSchema);

const AUTH_VALIDATION = Object.freeze({
  signupStart: contactSchema,
  signupVerifyOtp: requireExactlyOneContact(
    contactBaseSchema.extend({
      code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits'),
      signupSessionId: z.string().min(1)
    })
  ),
  signupSetPassword: requireExactlyOneContact(
    contactBaseSchema.extend({
      signupSessionId: z.string().min(1),
      password: z.string().min(6).max(100)
    })
  ),
  loginStart: contactSchema,
  loginVerifyOtp: requireExactlyOneContact(
    contactBaseSchema.extend({
    code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits'),
      loginSessionId: z.string().min(1)
    })
  ),
  loginWithPassword: z
    .object({
      identifier: z.string().trim().min(3).max(120).optional(),
      phone: phoneSchema.optional(),
      email: emailSchema.optional(),
      password: z.string().min(1).max(100)
    })
    .refine((data) => {
      const valueCount = [data.identifier, data.phone, data.email].filter(Boolean).length;
      return valueCount === 1;
    }, 'Provide exactly one of identifier, phone, or email'),
  refresh: z.object({ refreshToken: z.string().min(10) }),
  logout: z.object({ refreshToken: z.string().min(10) }),
  googleVerify: z.object({ idToken: z.string().min(50) }),
  completeProfile: z.object({
    firstName: z.string().min(1).max(80),
    lastName: z.string().min(1).max(80),
    gender: z.enum(['male', 'female', 'other']),
    dob: z.string().min(4),
    bio: z.string().max(500).optional(),
    height: z.number().min(50).max(300).optional(),
    ethnicity: z.string().max(80).optional(),
    interests: z.array(z.string()).min(3).max(5),
    photos: z.array(z.string().min(1)).min(1).max(4)
  }),
  editProfile: z
    .object({
      firstName: z.string().min(1).max(80).optional(),
      lastName: z.string().min(1).max(80).optional(),
      gender: z.enum(['male', 'female', 'other']).optional(),
      dob: z.string().min(4).optional(),
      bio: z.string().max(500).optional(),
      height: z.number().min(50).max(300).optional(),
      ethnicity: z.string().max(80).optional(),
      interests: z.array(z.string()).min(3).max(5).optional(),
      photos: z.array(z.string().min(1)).min(1).max(4).optional()
    })
    .refine((data) => Object.keys(data).length > 0, 'Provide at least one field to update')
});

module.exports = {
  AUTH_VALIDATION
};
