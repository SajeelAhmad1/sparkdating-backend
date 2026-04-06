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

exports.getInterestsCatalog = catchAsync(async (req, res) => {
  const interests = await prisma.interest.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }]
  });
  res.json({ status: 'success', data: { interests } });
});

