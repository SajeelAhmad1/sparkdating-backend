const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const prisma = require('../utils/prisma');
const { parseBody } = require('../utils/validation');
const { FCM_VALIDATION } = require('../validations/fcm.validation');

exports.registerToken = catchAsync(async (req, res) => {
  const { token } = parseBody(FCM_VALIDATION.tokenBody, req);
  const me = String(req.user.id);

  await prisma.fcmToken.deleteMany({ where: { token } });

  await prisma.fcmToken.create({
    data: { userId: me, token }
  });

  res.status(201).json({ status: 'success', data: { registered: true } });
});

exports.removeToken = catchAsync(async (req, res) => {
  const { token } = parseBody(FCM_VALIDATION.tokenBody, req);
  const me = String(req.user.id);

  const result = await prisma.fcmToken.deleteMany({
    where: { userId: me, token }
  });

  if (result.count === 0) {
    throw new AppError('Token not found', 404);
  }

  res.json({ status: 'success', data: { removed: true } });
});
