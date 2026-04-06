const catchAsync = require('../utils/catchAsync');

exports.me = catchAsync(async (req, res) => {
  res.json({ status: 'success', data: { user: req.user } });
});

