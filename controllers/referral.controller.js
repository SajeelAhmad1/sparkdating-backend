const catchAsync = require('../utils/catchAsync');
const prisma = require('../utils/prisma');
const {
  ensureReferralCode,
  getLaunchConfig,
  buildReferralLink,
} = require('../utils/referral');

async function buildReferralStats(userId) {
  const config = await getLaunchConfig();
  const referralCode = await ensureReferralCode(userId);

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: { invitesSent: true },
  });

  const signupsCount = await prisma.user.count({
    where: { referredByUserId: String(userId) },
  });

  const invitesSent = user?.invitesSent ?? 0;
  const premiumInviteTarget = config.premiumInviteTarget;
  const premiumUnlocked = invitesSent >= premiumInviteTarget;

  return {
    referralCode,
    referralLink: buildReferralLink(config.referralBaseUrl, referralCode),
    invitesSent,
    signupsCount,
    premiumInviteTarget,
    premiumUnlocked,
  };
}

exports.getMyStats = catchAsync(async (req, res) => {
  const stats = await buildReferralStats(String(req.user.id));

  res.json({
    status: 'success',
    data: stats,
  });
});

exports.recordShare = catchAsync(async (req, res) => {
  const userId = String(req.user.id);
  await ensureReferralCode(userId);

  await prisma.user.update({
    where: { id: userId },
    data: { invitesSent: { increment: 1 } },
  });

  const stats = await buildReferralStats(userId);

  res.json({
    status: 'success',
    data: stats,
  });
});

exports.getLaunchProgress = catchAsync(async (req, res) => {
  const config = await getLaunchConfig();
  const current = await prisma.profile.count();
  const target = config.launchTargetUsers;
  const remaining = Math.max(target - current, 0);
  const progressPercent = target > 0 ? Math.min((current / target) * 100, 100) : 0;

  res.json({
    status: 'success',
    data: {
      current,
      target,
      remaining,
      progressPercent,
    },
  });
});
