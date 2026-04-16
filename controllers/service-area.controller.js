const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const prisma = require('../utils/prisma');
const { parseBody } = require('../utils/validation');
const { SERVICE_AREA_VALIDATION } = require('../validations/service-area.validation');

exports.list = catchAsync(async (req, res) => {
  const areas = await prisma.serviceArea.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ status: 'success', data: { areas } });
});

exports.create = catchAsync(async (req, res) => {
  const payload = parseBody(SERVICE_AREA_VALIDATION.create, req);
  const area = await prisma.serviceArea.create({
    data: {
      name: payload.name.trim(),
      countryCode: payload.countryCode.trim().toUpperCase(),
      geometry: payload.geometry,
      isActive: payload.isActive ?? true
    }
  });
  res.status(201).json({ status: 'success', data: { area } });
});

exports.update = catchAsync(async (req, res) => {
  const areaId = String(req.params.areaId || '');
  if (!areaId) throw new AppError('areaId is required', 400);
  const payload = parseBody(SERVICE_AREA_VALIDATION.update, req);
  if (!Object.keys(payload).length) throw new AppError('Provide at least one field to update', 400);

  const data = {};
  if (payload.name !== undefined) data.name = payload.name.trim();
  if (payload.countryCode !== undefined) data.countryCode = payload.countryCode.trim().toUpperCase();
  if (payload.geometry !== undefined) data.geometry = payload.geometry;
  if (payload.isActive !== undefined) data.isActive = payload.isActive;

  const area = await prisma.serviceArea.update({
    where: { id: areaId },
    data
  });

  res.json({ status: 'success', data: { area } });
});
