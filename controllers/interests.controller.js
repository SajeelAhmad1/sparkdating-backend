const catchAsync = require('../utils/catchAsync');
const prisma = require('../utils/prisma');

exports.getCatalog = catchAsync(async (req, res) => {
  const interests = await prisma.interest.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }]
  });

  res.json({ status: 'success', data: { interests } });
});

