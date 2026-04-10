const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { parseBody } = require('../utils/validation');
const prisma = require('../utils/prisma');
const { DISCOVERY_FILTER_VALIDATION } = require('../validations/discovery-filter.validation');

async function getOrCreateDefaultFilter() {
  const existing = await prisma.discoveryFilter.findUnique({
    where: { key: 'default' }
  });
  if (existing) return existing;
  return prisma.discoveryFilter.create({
    data: {
      key: 'default',
      youngerAgeDelta: 5,
      olderAgeDelta: 5,
      maxDistanceKm: 50,
      isActive: true
    }
  });
}

exports.getDefault = catchAsync(async (req, res) => {
  const filter = await getOrCreateDefaultFilter();
  res.json({ status: 'success', data: { filter } });
});

exports.updateDefault = catchAsync(async (req, res) => {
  const payload = parseBody(DISCOVERY_FILTER_VALIDATION.update, req);
  if (!Object.keys(payload).length) throw new AppError('Provide at least one field to update', 400);
  await getOrCreateDefaultFilter();
  const filter = await prisma.discoveryFilter.update({
    where: { key: 'default' },
    data: payload
  });
  res.json({ status: 'success', data: { filter } });
});
