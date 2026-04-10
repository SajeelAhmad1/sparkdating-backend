const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { generateOtp4 } = require('../utils/otp');
const { parseBody } = require('../utils/validation');
const { AUTH_VALIDATION } = require('../validations/auth.validation');
const { AUTH_ERRORS } = require('../errors/auth.errors');
const { PROFILE_ERRORS } = require('../errors/profile.errors');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  sha256
} = require('../utils/jwt');

const prisma = require('../utils/prisma');
const bcrypt = require('bcryptjs');

const OTP_TTL_MS = 5 * 60 * 1000;

function normalizeContact(data) {
  if (data.email) return { email: data.email.trim().toLowerCase() };
  return { phone: data.phone.trim() };
}

function buildContactWhere(contact) {
  return contact.email ? { email: contact.email } : { phone: contact.phone };
}

function resolvePasswordLoginWhere(data) {
  if (data.email) return { email: data.email.trim().toLowerCase() };
  if (data.phone) return { phone: data.phone.trim() };

  const identifier = data.identifier.trim();
  const isEmail = identifier.includes('@');
  return isEmail ? { email: identifier.toLowerCase() } : { phone: identifier };
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
  const contact = normalizeContact(parseBody(AUTH_VALIDATION.signupStart, req));
  const existing = await prisma.user.findFirst({ where: buildContactWhere(contact) });
  if (existing) throw new AppError(AUTH_ERRORS.ACCOUNT_EXISTS, 409);

  const otp = generateOtp4();
  const otpHash = sha256(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const session = await prisma.signupSession.create({
    data: { ...contact, otpHash, otpExpiresAt }
  });

  // For now we mock SMS delivery.
  // eslint-disable-next-line no-console
  console.log(`[MOCK OTP] Signup OTP for ${contact.email ?? contact.phone}: ${otp}`);

  res.status(201).json({
    status: 'success',
    data: {
      signupSessionId: String(session.id),
      next: 'enter_otp'
    }
  });
});

exports.signupVerifyOtp = catchAsync(async (req, res) => {
  const { code, signupSessionId, ...rawContact } = parseBody(AUTH_VALIDATION.signupVerifyOtp, req);
  const contact = normalizeContact(rawContact);

  const session = await prisma.signupSession.findFirst({
    where: { id: signupSessionId, ...buildContactWhere(contact) }
  });
  if (!session) throw new AppError(AUTH_ERRORS.SIGNUP_SESSION_NOT_FOUND, 404);
  if (session.otpVerifiedAt) throw new AppError(AUTH_ERRORS.OTP_ALREADY_VERIFIED, 409);
  if (session.usedAt) throw new AppError(AUTH_ERRORS.SIGNUP_SESSION_ALREADY_USED, 409);
  if (new Date(session.otpExpiresAt).getTime() < Date.now()) throw new AppError(AUTH_ERRORS.OTP_EXPIRED, 400);

  if (sha256(code) !== session.otpHash) throw new AppError(AUTH_ERRORS.INVALID_CODE, 400);
  await prisma.signupSession.update({
    where: { id: session.id },
    data: { otpVerifiedAt: new Date() }
  });

  res.json({
    status: 'success',
    data: {
      signupSessionId: String(session.id),
      next: 'set_password'
    }
  });
});

exports.signupSetPassword = catchAsync(async (req, res) => {
  const { signupSessionId, password, ...rawContact } = parseBody(AUTH_VALIDATION.signupSetPassword, req);
  const contact = normalizeContact(rawContact);

  const session = await prisma.signupSession.findFirst({
    where: { id: signupSessionId, ...buildContactWhere(contact) }
  });
  if (!session) throw new AppError(AUTH_ERRORS.SIGNUP_SESSION_NOT_FOUND, 404);
  if (!session.otpVerifiedAt) throw new AppError(AUTH_ERRORS.OTP_NOT_VERIFIED, 403);
  if (session.usedAt) throw new AppError(AUTH_ERRORS.SIGNUP_SESSION_ALREADY_USED, 409);
  if (new Date(session.otpExpiresAt).getTime() < Date.now()) throw new AppError(AUTH_ERRORS.OTP_EXPIRED, 400);

  const existing = await prisma.user.findFirst({ where: buildContactWhere(contact) });
  if (existing) throw new AppError(AUTH_ERRORS.ACCOUNT_EXISTS, 409);

  const passwordHash = await bcrypt.hash(password, 12);

  const user = await prisma.user.create({
    data: {
      ...contact,
      passwordHash
    }
  });

  await prisma.signupSession.update({
    where: { id: session.id },
    data: { usedAt: new Date() }
  });

  const tokens = await issueTokensForUser(user.id);
  return res.status(201).json({
    status: 'success',
    data: {
      user,
      ...tokens,
      next: 'complete_profile'
    }
  });
});

exports.loginStart = catchAsync(async (req, res) => {
  const contact = normalizeContact(parseBody(AUTH_VALIDATION.loginStart, req));

  const user = await prisma.user.findFirst({ where: buildContactWhere(contact) });
  if (!user) throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, 404);

  const otp = generateOtp4();
  const otpHash = sha256(otp);
  const otpExpiresAt = new Date(Date.now() + OTP_TTL_MS);

  const session = await prisma.signupSession.create({
    data: { ...contact, otpHash, otpExpiresAt }
  });
  // eslint-disable-next-line no-console
  console.log(`[MOCK OTP] Login OTP for ${contact.email ?? contact.phone}: ${otp}`);

  res.status(201).json({ status: 'success', data: { loginSessionId: String(session.id), next: 'enter_otp' } });
});

exports.loginVerifyOtp = catchAsync(async (req, res) => {
  const { code, loginSessionId, ...rawContact } = parseBody(AUTH_VALIDATION.loginVerifyOtp, req);
  const contact = normalizeContact(rawContact);

  const session = await prisma.signupSession.findFirst({
    where: { id: loginSessionId, ...buildContactWhere(contact) }
  });
  if (!session) throw new AppError(AUTH_ERRORS.LOGIN_SESSION_NOT_FOUND, 404);
  if (new Date(session.otpExpiresAt).getTime() < Date.now()) throw new AppError(AUTH_ERRORS.OTP_EXPIRED, 400);
  if (sha256(code) !== session.otpHash) throw new AppError(AUTH_ERRORS.INVALID_CODE, 400);

  const user = await prisma.user.findFirst({ where: buildContactWhere(contact) });
  if (!user) throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, 404);

  const tokens = await issueTokensForUser(user.id);

  res.json({ status: 'success', data: { user, ...tokens } });
});

exports.loginWithPassword = catchAsync(async (req, res) => {
  const { password, ...loginInput } = parseBody(AUTH_VALIDATION.loginWithPassword, req);
  const where = resolvePasswordLoginWhere(loginInput);

  const user = await prisma.user.findFirst({
    where,
    include: { profile: true, interests: { include: { interest: true } } }
  });
  if (!user) throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);
  if (!user.passwordHash) throw new AppError(AUTH_ERRORS.PASSWORD_LOGIN_NOT_ENABLED, 401);

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) throw new AppError(AUTH_ERRORS.INVALID_CREDENTIALS, 401);

  const tokens = await issueTokensForUser(user.id);
  return res.json({ status: 'success', data: { user, ...tokens, next: user.profile ? 'home' : 'complete_profile' } });
});

exports.refresh = catchAsync(async (req, res) => {
  const { refreshToken } = parseBody(AUTH_VALIDATION.refresh, req);

  let decoded;
  try {
    decoded = verifyRefreshToken(refreshToken);
  } catch {
    throw new AppError(AUTH_ERRORS.INVALID_REFRESH_TOKEN, 401);
  }

  const tokenHash = sha256(refreshToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (!existing || existing.revokedAt) throw new AppError(AUTH_ERRORS.REFRESH_TOKEN_REVOKED, 401);
  if (new Date(existing.expiresAt).getTime() < Date.now()) throw new AppError(AUTH_ERRORS.REFRESH_TOKEN_EXPIRED, 401);

  // rotation: revoke old, issue new
  await prisma.refreshToken.update({
    where: { tokenHash },
    data: { revokedAt: new Date() }
  });

  const user = await prisma.user.findUnique({ where: { id: String(decoded.sub) } });
  if (!user) throw new AppError(AUTH_ERRORS.USER_NOT_FOUND, 404);

  const tokens = await issueTokensForUser(user.id);
  res.json({ status: 'success', data: { ...tokens } });
});

exports.logout = catchAsync(async (req, res) => {
  const { refreshToken } = parseBody(AUTH_VALIDATION.logout, req);
  const tokenHash = sha256(refreshToken);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash } });
  if (existing && !existing.revokedAt)
    await prisma.refreshToken.update({ where: { tokenHash }, data: { revokedAt: new Date() } });
  res.json({ status: 'success' });
});

exports.googleVerify = catchAsync(async (req, res) => {
  const { idToken } = parseBody(AUTH_VALIDATION.googleVerify, req);

  if (!process.env.GOOGLE_CLIENT_ID) {
    throw new AppError(AUTH_ERRORS.GOOGLE_CLIENT_ID_MISSING, 500);
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
    throw new AppError(AUTH_ERRORS.INVALID_GOOGLE_TOKEN, 401);
  }

  const googleSub = payload?.sub;
  if (!googleSub) throw new AppError(AUTH_ERRORS.GOOGLE_TOKEN_SUBJECT_MISSING, 401);

  const existingUser = await prisma.user.findFirst({
    where: { googleSub },
    include: { profile: true, interests: { include: { interest: true } } }
  });

  const user =
    existingUser ??
    (await prisma.user.create({
      data: {
        googleSub,
        ...(payload?.email ? { email: payload.email } : {})
      }
    }));

  const tokens = await issueTokensForUser(user.id);
  const hasProfile = !!(existingUser?.profile);

  return res.status(existingUser ? 200 : 201).json({
    status: 'success',
    data: {
      user: existingUser ?? user,
      ...tokens,
      next: hasProfile ? 'home' : 'complete_profile',
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

exports.completeProfile = catchAsync(async (req, res) => {
  const { firstName, lastName, gender, dob, bio, height, ethnicity, interests, photos } = parseBody(
    AUTH_VALIDATION.completeProfile,
    req
  );

  const userId = String(req.user.id);

  const existingProfile = await prisma.profile.findUnique({ where: { userId } });
  if (existingProfile) throw new AppError(PROFILE_ERRORS.ALREADY_EXISTS, 409);

  const dobDate = new Date(dob);
  if (Number.isNaN(dobDate.getTime())) throw new AppError(PROFILE_ERRORS.INVALID_DOB, 400);

  const foundInterests = await prisma.interest.findMany({
    where: { name: { in: interests } },
    select: { id: true, name: true }
  });
  const foundNames = new Set(foundInterests.map((i) => i.name));
  const invalid = interests.filter((i) => !foundNames.has(i));
  if (invalid.length) throw new AppError(`${PROFILE_ERRORS.INVALID_INTERESTS_PREFIX} ${invalid.join(', ')}`, 400);
  const uniqueInterests = [...new Set(interests)];
  if (uniqueInterests.length < 3 || uniqueInterests.length > 5) {
    throw new AppError(PROFILE_ERRORS.UNIQUE_INTERESTS_RANGE, 400);
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      profile: {
        create: {
          firstName,
          lastName,
          gender,
          dob: dobDate,
          bio: bio ?? null,
          height: height == null ? null : Math.round(height),
          ethnicity: ethnicity ?? null,
          photos
        }
      },
      interests: {
        create: foundInterests
          .filter((i) => uniqueInterests.includes(i.name))
          .map((i) => ({
            interestId: i.id
          }))
      }
    },
    include: {
      profile: true,
      interests: { include: { interest: true } }
    }
  });

  return res.status(201).json({
    status: 'success',
    data: {
      user,
      next: 'home'
    }
  });
});

exports.editProfile = catchAsync(async (req, res) => {
  const payload = parseBody(AUTH_VALIDATION.editProfile, req);
  if (!Object.keys(payload).length) throw new AppError(PROFILE_ERRORS.UPDATE_FIELDS_REQUIRED, 400);

  const userId = String(req.user.id);
  const existingProfile = await prisma.profile.findUnique({ where: { userId } });
  if (!existingProfile) throw new AppError(PROFILE_ERRORS.NOT_FOUND, 404);

  const profileUpdateData = {};
  if (payload.firstName !== undefined) profileUpdateData.firstName = payload.firstName;
  if (payload.lastName !== undefined) profileUpdateData.lastName = payload.lastName;
  if (payload.gender !== undefined) profileUpdateData.gender = payload.gender;
  if (payload.bio !== undefined) profileUpdateData.bio = payload.bio;
  if (payload.ethnicity !== undefined) profileUpdateData.ethnicity = payload.ethnicity;
  if (payload.photos !== undefined) profileUpdateData.photos = payload.photos;
  if (payload.height !== undefined) profileUpdateData.height = Math.round(payload.height);

  if (payload.dob !== undefined) {
    const dobDate = new Date(payload.dob);
    if (Number.isNaN(dobDate.getTime())) throw new AppError(PROFILE_ERRORS.INVALID_DOB, 400);
    profileUpdateData.dob = dobDate;
  }

  let nextInterestsData;
  if (payload.interests !== undefined) {
    const foundInterests = await prisma.interest.findMany({
      where: { name: { in: payload.interests } },
      select: { id: true, name: true }
    });
    const foundNames = new Set(foundInterests.map((i) => i.name));
    const invalid = payload.interests.filter((i) => !foundNames.has(i));
    if (invalid.length) throw new AppError(`${PROFILE_ERRORS.INVALID_INTERESTS_PREFIX} ${invalid.join(', ')}`, 400);

    const uniqueInterests = [...new Set(payload.interests)];
    if (uniqueInterests.length < 3 || uniqueInterests.length > 5) {
      throw new AppError(PROFILE_ERRORS.UNIQUE_INTERESTS_RANGE, 400);
    }

    nextInterestsData = foundInterests
      .filter((interest) => uniqueInterests.includes(interest.name))
      .map((interest) => ({ interestId: interest.id }));
  }

  const data = {};
  if (Object.keys(profileUpdateData).length > 0) {
    data.profile = { update: profileUpdateData };
  }
  if (nextInterestsData) {
    data.interests = {
      deleteMany: {},
      create: nextInterestsData
    };
  }

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    include: {
      profile: true,
      interests: { include: { interest: true } }
    }
  });

  return res.json({
    status: 'success',
    data: {
      user
    }
  });
});

