const crypto = require('crypto');
const prisma = require('./prisma');

function generateReferralCode() {
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return `SPARK-${suffix}`;
}

async function ensureReferralCode(userId) {
  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { referralCode: true },
  });
  if (user?.referralCode) return user.referralCode;

  let code;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    code = generateReferralCode();
    // eslint-disable-next-line no-await-in-loop
    const exists = await prisma.user.findFirst({
      where: { referralCode: code },
      select: { id: true },
    });
    if (!exists) break;
  }

  const updated = await prisma.user.update({
    where: { id: String(userId) },
    data: { referralCode: code },
    select: { referralCode: true },
  });

  return updated.referralCode;
}

async function getLaunchConfig() {
  const config = await prisma.appLaunchConfig.upsert({
    where: { key: 'default' },
    create: {
      key: 'default',
      launchTargetUsers: 1000,
      premiumInviteTarget: 2,
      referralBaseUrl: process.env.REFERRAL_BASE_URL || 'https://spark.app/invite',
    },
    update: {},
  });

  return config;
}

async function resolveReferrerId(referralCode) {
  if (!referralCode) return null;

  const code = String(referralCode).trim().toUpperCase();
  const referrer = await prisma.user.findFirst({
    where: { referralCode: code },
    select: { id: true },
  });

  return referrer ? String(referrer.id) : null;
}

function buildReferralLink(baseUrl, referralCode) {
  const normalized = String(baseUrl || 'https://spark.app/invite').replace(/\/$/, '');
  return `${normalized}/${referralCode}`;
}

module.exports = {
  generateReferralCode,
  ensureReferralCode,
  getLaunchConfig,
  resolveReferrerId,
  buildReferralLink,
};
