const { v2: cloudinary } = require('cloudinary');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

exports.deleteImage = catchAsync(async (req, res) => {
  const { public_id } = req.body;
  if (!public_id || typeof public_id !== 'string' || !public_id.trim()) {
    throw new AppError('public_id is required', 400);
  }

  const result = await cloudinary.uploader.destroy(public_id.trim());

  if (result.result !== 'ok' && result.result !== 'not found') {
    throw new AppError(`Cloudinary delete failed: ${result.result}`, 500);
  }

  res.json({ status: 'success', data: { deleted: true, result: result.result } });
});
