const AppError = require('../utils/appError');
const catchAsync = require('../utils/catchAsync');
const { verifyAccessToken } = require('../utils/jwt');
const prisma = require('../utils/prisma');

module.exports = catchAsync(async (req, res, next) => {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    return next(new AppError('Missing Authorization Bearer token', 401));
  }

  const token = auth.split(' ')[1];
  let decoded;
  try {
    decoded = verifyAccessToken(token);
  } catch {
    return next(new AppError('Invalid access token', 401));
  }

  const user = await prisma.user.findUnique({
    where: { id: String(decoded.sub) },
    include: { interests: { include: { interest: true } } }
  });
  if (!user) return next(new AppError('User not found', 404));

  req.user = user;
  next();
});

