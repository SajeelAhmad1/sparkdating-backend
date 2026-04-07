const { z } = require('zod');

const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { generateOtp4 } = require('../utils/otp');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sha256
} = require('../utils/jwt');

const prisma = require('../utils/prisma');

const OTP_TTL_MS = 5 * 60 * 1000;
const OAUTH_SESSION_TTL_MS = 10 * 60 * 1000;

function parseBody(schema, req) {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    throw new AppError(result.error.issues.map((i) => i.message).join(', '), 400);
  }
  return result.data;
}

async function issueTokensForUser(userId) {
  const accessToken = signAccessToken({ sub: String(userId), typ: 'access' });
  const refreshToken = signRefreshToken({ sub: String(userId), typ: 'refresh' });

  const decoded = verifyRefreshToken(refreshToken);
  const expiresAt = new Date(decoded.exp * 1000);

  await prisma.refreshToken.create({
    data: {
      userId: String(userId),
      tokenHash: sha256(refreshToken),
      expiresAt
    }
  });

  return { accessToken, refreshToken };
}

exports.signupStart = catchAsync(async (req, res) => {
  const { phone } = parseBody(
    z.object({
      phone: z.string().min(7).max(20)
    }),
    req
  );

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw new AppError('Phone is already registered. Please login.', 409);

  const otp = generateOtp4();
  const otpHash = sha256(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const session = await prisma.signupSession.create({
    data: { phone, otpHash, otpExpiresAt }
  });

  // For now we mock SMS delivery.
  // eslint-disable-next-line no-console
  console.log(`[MOCK SMS] OTP for ${phone}: ${otp}`);

  res.status(201).json({
    status: 'success',
    data: {
      signupSessionId: String(session.id),
      next: 'enter_otp'
    }
  });
});

exports.signupVerifyOtp = catchAsync(async (req, res) => {
  const { phone, code, signupSessionId } = parseBody(
    z.object({
      phone: z.string().min(7).max(20),
      code: z.string().regex(/^\d{4}$/, 'Code must be 4 digits'),
      signupSessionId: z.string().min(1)
    }),
    req
  );

  const session = await prisma.signupSession.findFirst({
    where: { id: signupSessionId, phone }
  });
  if (!session) throw new AppError('Signup session not found', 404);
  if (session.otpVerifiedAt) throw new AppError('OTP already verified', 409);
  if (new Date(session.otpExpiresAt).getTime() < Date.now()) throw new AppError('OTP expired', 400);

  if (sha256(code) !== session.otpHash) throw new AppError('Invalid code', 400);
  await prisma.signupSession.update({
    where: { id: session.id },
    data: { otpVerifiedAt: new Date() }
  });

  res.json({ status: 'success', data: { next: 'complete_profile' } });
});

exports.signupComplete = catchAsync(async (req, res) => {
  const {
    signupSessionId,
    phone,
    firstName,
    lastName,
    gender,
    dob,
    bio,
    height,
    ethnicity,
    interests,
    photos
  } = parseBody(
    z.object({
      signupSessionId: z.string().min(1),
      phone: z.string().min(7).max(20),
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
    req
  );

  const session = await prisma.signupSession.findFirst({
    where: { id: signupSessionId, phone }
  });
  if (!session) throw new AppError('Signup session not found', 404);
  if (!session.otpVerifiedAt) throw new AppError('OTP not verified', 403);

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) throw new AppError('Invalid dob', 400);

  const foundInterests = await prisma.interest.findMany({
    where: { name: { in: interests } },
    select: { id: true, name: true }
  });
  const foundNames = new Set(foundInterests.map((i) => i.name));
  const invalid = interests.filter((i) => !foundNames.has(i));
  if (invalid.length) throw new AppError(`Invalid interests: ${invalid.join(', ')}`, 400);
  const uniqueInterests = [...new Set(interests)];
  if (uniqueInterests.length < 3 || uniqueInterests.length > 5) {
    throw new AppError('Select min 3 and max 5 unique interests', 400);
  }

  const existing = await prisma.user.findUnique({ where: { phone } });
  if (existing) throw new AppError('User already exists. Please login.', 409);

  const user = await prisma.user.create({
    data: {
      phone,
      firstName,
      lastName,
      gender,
      dob: dobDate,
      bio: bio ?? null,
      height: height == null ? null : Math.round(height),
      ethnicity: ethnicity ?? null,
      photos,
      interests: {
        create: foundInterests
          .filter((i) => uniqueInterests.includes(i.name))
          .map((i) => ({
            interestId: i.id
          }))
      }
    },
    include: {
      interests: { include: { interest: true } }
    }
  });

  const tokens = await issueTokensForUser(user.id);

  res.status(201).json({
    status: 'success',
    data: {
      user,
      ...tokens
    }
  });
});

exports.loginStart = catchAsync(async (req, res) => {
  const { phone } = parseBody(z.object({ phone: z.string().min(7).max(20) }), req);

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new AppError('User not found. Please signup.', 404);

  const otp = generateOtp4();
  const otpHash = sha256(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const session = await prisma.signupSession.create({
    data: { phone, otpHash, otpExpiresAt }
  });
  // eslint-disable-next-line no-console
  console.log(`[MOCK SMS] Login OTP for ${phone}: ${otp}`);

  res.status(201).json({ status: 'success', data: { loginSessionId: String(session.id), next: 'enter_otp' } });
});

exports.loginVerifyOtp = catchAsync(async (req, res) => {
  const { phone, code, loginSessionId } = parseBody(
    z.object({
      phone: z.string().min(7).max(20),
      code: z.string().regex(/^\d{4}$/),
      loginSessionId: z.string().min(1)
    }),
    req
  );

  const session = await prisma.signupSession.findFirst({
    where: { id: loginSessionId, phone }
  });
  if (!session) throw new AppError('Login session not found', 404);
  if (new Date(session.otpExpiresAt).getTime() < Date.now()) throw new AppError('OTP expired', 400);
  if (sha256(code) !== session.otpHash) throw new AppError('Invalid code', 400);

  const user = await prisma.user.findUnique({ where: { phone } });
  if (!user) throw new AppError('User not found. Please signup.', 404);

  const tokens = await issueTokensForUser(user.id);

  res.json({ status: 'success', data: { user, ...tokens } });
});

exports.refresh = catchAsync(async (req, res) => {
  const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError('Invalid refresh token', 401);
  }

  const tokenHash = sha256(refreshToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt) throw new AppError('Refresh token revoked', 401);
  if (new Date(existing.expiresAt).getTime() < Date.now()) throw new AppError('Refresh token expired', 401);

  // rotation: revoke old, issue new
  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() }
  });

  const user = await prisma.user.findUnique({ where: { id: String(decoded.sub) } });
  if (!user) throw new AppError('User not found', 404);

  const tokens = await issueTokensForUser(user.id);
  res.json({ status: 'success', data: { ...tokens } });
});

exports.logout = catchAsync(async (req, res) => {
  const { refreshToken } = parseBody(z.object({ refreshToken: z.string().min(10) }), req);
  const tokenHash = sha256(refreshToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (existing && !existing.revokedAt)
    await prisma.refreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
  res.json({ status: 'success' });
});

exports.googleVerify = catchAsync(async (req, res) => {
  const { idToken } = parseBody(z.object({ idToken: z.string().min(50) }), req);

  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new AppError('GOOGLE_CLIENT_ID is not configured', 500);
  }

  // Lazy-load so non-google flows don't require the dependency at runtime.
  // eslint-disable-next-line global-require
  const { OAuth2Client } = require('google-auth-library');
  const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  let payload;
  try {
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    payload = ticket.getPayload();
  } catch {
    throw new AppError('Invalid Google token', 401);
  }

  const googleSub = payload?.sub;
  if (!googleSub) throw new AppError('Google token missing subject', 401);

  // If user already exists, treat as login.
  const existingUser = await prisma.user.findFirst({
    where: { googleSub },
    include: { interests: { include: { interest: true } } }
  });
  if (existingUser) {
    const tokens = await issueTokensForUser(existingUser.id);
    return res.json({
      status: 'success',
      data: {
        user: existingUser,
        ...tokens,
        next: 'home'
      }
    });
  }

  const oauthSession = await prisma.oauthSignupSession.create({
    data: {
      provider: 'google',
      providerSub: googleSub,
      email: payload?.email ?? null,
      displayName: payload?.name ?? null,
      givenName: payload?.given_name ?? null,
      familyName: payload?.family_name ?? null,
      picture: payload?.picture ?? null,
      expiresAt: new Date(Date.now() + OAUTH_SESSION_TTL_MS)
    }
  });

  return res.status(201).json({
    status: 'success',
    data: {
      oauthSessionId: String(oauthSession.id),
      next: 'complete_profile',
      profile: {
        email: payload?.email ?? null,
        displayName: payload?.name ?? null,
        givenName: payload?.given_name ?? null,
        familyName: payload?.family_name ?? null,
        picture: payload?.picture ?? null
      }
    }
  });
});

exports.googleCompleteProfile = catchAsync(async (req, res) => {
  const {
    oauthSessionId,
    phone,
    firstName,
    lastName,
    gender,
    dob,
    bio,
    height,
    ethnicity,
    interests,
    photos
  } = parseBody(
    z.object({
      oauthSessionId: z.string().min(1),
      phone: z.string().min(7).max(20),
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
    req
  );

  const session = await prisma.oauthSignupSession.findUnique({
    where: { id: oauthSessionId }
  });
  if (!session) throw new AppError('OAuth signup session not found', 404);
  if (new Date(session.expiresAt).getTime() < Date.now()) throw new AppError('OAuth signup session expired', 400);
  if (session.usedAt) throw new AppError('OAuth signup session already used', 409);
  if (session.provider !== 'google') throw new AppError('Invalid OAuth provider', 400);

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) throw new AppError('Invalid dob', 400);

  const foundInterests = await prisma.interest.findMany({
    where: { name: { in: interests } },
    select: { id: true, name: true }
  });
  const foundNames = new Set(foundInterests.map((i) => i.name));
  const invalid = interests.filter((i) => !foundNames.has(i));
  if (invalid.length) throw new AppError(`Invalid interests: ${invalid.join(', ')}`, 400);
  const uniqueInterests = [...new Set(interests)];
  if (uniqueInterests.length < 3 || uniqueInterests.length > 5) {
    throw new AppError('Select min 3 and max 5 unique interests', 400);
  }

  const existingPhone = await prisma.user.findUnique({ where: { phone } });
  if (existingPhone) throw new AppError('Phone is already registered. Please login.', 409);

  const user = await prisma.user.create({
    data: {
      phone,
      firstName,
      lastName,
      gender,
      dob: dobDate,
      bio: bio ?? null,
      height: height == null ? null : Math.round(height),
      ethnicity: ethnicity ?? null,
      photos,
      email: session.email,
      googleSub: session.providerSub,
      interests: {
        create: foundInterests
          .filter((i) => uniqueInterests.includes(i.name))
          .map((i) => ({
            interestId: i.id
          }))
      }
    },
    include: {
      interests: { include: { interest: true } }
    }
  });

  await prisma.oauthSignupSession.update({
    where: { id: session.id },
    data: { usedAt: new Date() }
  });

  const tokens = await issueTokensForUser(user.id);
  return res.status(201).json({
    status: 'success',
    data: {
      user,
      ...tokens,
      next: 'home'
    }
  });
});

