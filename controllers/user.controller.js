const catchAsync = require('../utils/catchAsync');
const prisma = require('../utils/prisma');
const { parseBody } = require('../utils/validation');
const { NOTIFICATIONS_VALIDATION } = require('../validations/notifications.validation');

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

