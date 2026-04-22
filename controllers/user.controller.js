const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const prisma = require('../utils/prisma');
const { parseBody } = require('../utils/validation');
const { NOTIFICATIONS_VALIDATION } = require('../validations/notifications.validation');
const { USER_VALIDATION } = require('../validations/user.validation');

exports.me = catchAsync(async (req, res) => {
  res.json({ status: 'success', data: { user: req.user } });
});

exports.updateNotificationPreferences = catchAsync(async (req, res) => {
  const { fcmEnabled } = parseBody(NOTIFICATIONS_VALIDATION.updatePreferences, req);
  const me = String(req.user.id);

  const user = await prisma.user.update({
    where: { id: me },
    data: { fcmNotificationsEnabled: Boolean(fcmEnabled) }
  });

  res.json({
    status: 'success',
    data: { fcmNotificationsEnabled: Boolean(user.fcmNotificationsEnabled) }
  });
});

exports.getUserById = catchAsync(async (req, res) => {
  const { userId } = parseBody(USER_VALIDATION.getUserById, req);

  const user = await prisma.user.findUnique({
    where: { id: String(userId) },
    select: {
      id: true,
      phone: true,
      email: true,
      googleSub: true,
      youngerAgeDelta: true,
      olderAgeDelta: true,
      maxDistanceKm: true,
      fcmNotificationsEnabled: true,
      createdAt: true,
      updatedAt: true,
      profile: true,
      location: true,
      interests: { include: { interest: true } }
    }
  });

  if (!user) throw new AppError('User not found', 404);

  res.json({ status: 'success', data: { user } });
});

