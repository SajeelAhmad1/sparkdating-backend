const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { parseBody } = require('../utils/validation');
const prisma = require('../utils/prisma');
const { DISCOVERY_VALIDATION } = require('../validations/discovery.validation');
const { DISCOVERY_PREFERENCES_VALIDATION } = require('../validations/discovery-preferences.validation');
const { DISCOVERY_ERRORS } = require('../errors/discovery.errors');
const { SOCIAL_ERRORS } = require('../errors/social.errors');
const { isBlockedEitherWay } = require('./social.controller');

function toObjectId(id) {
  return { $oid: String(id) };
}

function calculateAge(dob) {
  const birthDate = new Date(dob);
  const now = new Date();
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) age -= 1;
  return age;
}

function oppositeGender(gender) {
  if (gender === 'male') return 'female';
  if (gender === 'female') return 'male';
  return null;
}

function normalizePair(a, b) {
  return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)];
}

function discoveryPrefsFromUser(user) {
  const youngerAgeDelta = user.youngerAgeDelta ?? 5;
  const olderAgeDelta = user.olderAgeDelta ?? 5;
  const maxDistanceKm = user.maxDistanceKm ?? 50;
  return { youngerAgeDelta, olderAgeDelta, maxDistanceKm };
}

let indexInitPromise = null;
async function ensureGeoIndexes() {
  if (!indexInitPromise) {
    indexInitPromise = Promise.all([
      prisma.$runCommandRaw({
        createIndexes: 'UserLocation',
        indexes: [{ key: { point: '2dsphere' }, name: 'UserLocation_point_2dsphere' }]
      }),
      prisma.$runCommandRaw({
        createIndexes: 'ServiceArea',
        indexes: [{ key: { geometry: '2dsphere' }, name: 'ServiceArea_geometry_2dsphere' }]
      })
    ]);
  }
  await indexInitPromise;
}

async function isInServiceArea(lat, lng) {
  await ensureGeoIndexes();
  const areas = await prisma.serviceArea.findRaw({
    filter: {
      isActive: true,
      geometry: {
        $geoIntersects: {
          $geometry: {
            type: 'Point',
            coordinates: [lng, lat]
          }
        }
      }
    }
  });

  if (!areas.length) return { isSupported: false, area: null };
  return {
    isSupported: true,
    area: {
      id: areas[0]._id?.$oid ?? String(areas[0]._id),
      name: areas[0].name,
      countryCode: areas[0].countryCode
    }
  };
}

exports.checkAvailability = catchAsync(async (req, res) => {
  const { lat, lng } = parseBody(DISCOVERY_VALIDATION.areaAvailability, req);
  const result = await isInServiceArea(lat, lng);
  res.json({ status: 'success', data: result });
});

exports.updateLocation = catchAsync(async (req, res) => {
  const { lat, lng } = parseBody(DISCOVERY_VALIDATION.updateLocation, req);
  const userId = String(req.user.id);
  const area = await isInServiceArea(lat, lng);

  await prisma.userLocation.upsert({
    where: { userId },
    create: {
      userId,
      lat,
      lng,
      point: { type: 'Point', coordinates: [lng, lat] }
    },
    update: {
      lat,
      lng,
      point: { type: 'Point', coordinates: [lng, lat] }
    }
  });

  res.json({
    status: 'success',
    data: {
      locationUpdated: true,
      availability: area
    }
  });
});

exports.discoverProfiles = catchAsync(async (req, res) => {
  const { lat, lng, limit } = parseBody(DISCOVERY_VALIDATION.discoverProfiles, req);
  const me = req.user;
  const myUserId = String(me.id);
  const myGender = me.profile?.gender;

  if (!me.profile) throw new AppError(DISCOVERY_ERRORS.PROFILE_REQUIRED, 403);
  const discoveryFilter = discoveryPrefsFromUser(me);
  const myAge = calculateAge(me.profile.dob);
  const minAge = Math.max(18, myAge - discoveryFilter.youngerAgeDelta);
  const maxAge = Math.max(minAge, myAge + discoveryFilter.olderAgeDelta);
  const now = new Date();
  const youngestDob = new Date(Date.UTC(now.getUTCFullYear() - minAge, now.getUTCMonth(), now.getUTCDate()));
  const oldestDob = new Date(Date.UTC(now.getUTCFullYear() - maxAge, now.getUTCMonth(), now.getUTCDate()));

  const area = await isInServiceArea(lat, lng);
  if (!area.isSupported) throw new AppError(DISCOVERY_ERRORS.LOCATION_OUTSIDE_SERVICE_AREA, 403);

  await prisma.userLocation.upsert({
    where: { userId: myUserId },
    create: { userId: myUserId, lat, lng, point: { type: 'Point', coordinates: [lng, lat] } },
    update: { lat, lng, point: { type: 'Point', coordinates: [lng, lat] } }
  });

  const nearbyLocations = await prisma.userLocation.findRaw({
    filter: {
      point: {
        $near: {
          $geometry: { type: 'Point', coordinates: [lng, lat] },
          $maxDistance: Math.round(discoveryFilter.maxDistanceKm * 1000)
        }
      },
      userId: { $ne: toObjectId(myUserId) }
    },
    options: { limit: 200 }
  });

  const nearbyUserIds = nearbyLocations.map((loc) => String(loc.userId?.$oid ?? loc.userId)).filter(Boolean);
  if (!nearbyUserIds.length) {
    return res.json({ status: 'success', data: { area, profiles: [] } });
  }

  const blockRows = await prisma.userBlock.findMany({
    where: {
      OR: [{ blockerId: myUserId }, { blockedUserId: myUserId }]
    },
    select: { blockerId: true, blockedUserId: true }
  });
  const blockedUserIds = new Set();
  blockRows.forEach((b) => {
    blockedUserIds.add(String(b.blockerId));
    blockedUserIds.add(String(b.blockedUserId));
  });
  blockedUserIds.delete(myUserId);

  const [mySwipes, myMatches, candidates] = await Promise.all([
    prisma.swipe.findMany({ where: { fromUserId: myUserId }, select: { toUserId: true } }),
    prisma.match.findMany({
      where: { OR: [{ user1Id: myUserId }, { user2Id: myUserId }] },
      select: { user1Id: true, user2Id: true }
    }),
    prisma.user.findMany({
      where: {
        id: { in: nearbyUserIds },
        profile: {
          is: {
            gender: oppositeGender(myGender) ?? undefined,
            dob: {
              lte: youngestDob,
              gte: oldestDob
            }
          }
        }
      },
      include: {
        profile: true,
        interests: { include: { interest: true } }
      }
    })
  ]);

  const excluded = new Set([myUserId]);
  mySwipes.forEach((s) => excluded.add(String(s.toUserId)));
  myMatches.forEach((m) => {
    excluded.add(String(m.user1Id));
    excluded.add(String(m.user2Id));
  });

  const myInterestIds = new Set(me.interests.map((ui) => String(ui.interestId)));
  const distanceByUserId = new Map(
    nearbyLocations.map((loc) => [String(loc.userId?.$oid ?? loc.userId), { lat: loc.lat, lng: loc.lng }])
  );

  const profiles = candidates
    .filter((user) => !excluded.has(String(user.id)))
    .filter((user) => !blockedUserIds.has(String(user.id)))
    .filter((user) => user.interests.some((ui) => myInterestIds.has(String(ui.interestId))))
    .slice(0, limit)
    .map((user) => {
      const age = calculateAge(user.profile.dob);
      const loc = distanceByUserId.get(String(user.id));
      return {
        id: String(user.id),
        firstName: user.profile.firstName,
        lastName: user.profile.lastName,
        age,
        gender: user.profile.gender,
        bio: user.profile.bio,
        photos: user.profile.photos,
        interests: user.interests.map((ui) => ui.interest.name),
        location: loc ?? null
      };
    });

  res.json({
    status: 'success',
    data: {
      area,
      appliedFilter: {
        maxDistanceKm: discoveryFilter.maxDistanceKm,
        minAge,
        maxAge,
        basedOnMyAge: myAge
      },
      profiles
    }
  });
});

exports.getDiscoveryPreferences = catchAsync(async (req, res) => {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: String(req.user.id) },
    select: { youngerAgeDelta: true, olderAgeDelta: true, maxDistanceKm: true }
  });
  res.json({
    status: 'success',
    data: { preferences: discoveryPrefsFromUser(user) }
  });
});

exports.patchDiscoveryPreferences = catchAsync(async (req, res) => {
  const payload = parseBody(DISCOVERY_PREFERENCES_VALIDATION.update, req);
  if (!Object.keys(payload).length) throw new AppError('Provide at least one field to update', 400);
  const user = await prisma.user.update({
    where: { id: String(req.user.id) },
    data: payload,
    select: { youngerAgeDelta: true, olderAgeDelta: true, maxDistanceKm: true }
  });
  res.json({
    status: 'success',
    data: { preferences: discoveryPrefsFromUser(user) }
  });
});

exports.swipe = catchAsync(async (req, res) => {
  const { toUserId, action } = parseBody(DISCOVERY_VALIDATION.swipe, req);
  const fromUserId = String(req.user.id);
  if (!['like', 'swipe'].includes(action)) throw new AppError(DISCOVERY_ERRORS.SWIPE_ACTION_INVALID, 400);
  if (toUserId === fromUserId) throw new AppError(DISCOVERY_ERRORS.SELF_SWIPE_NOT_ALLOWED, 400);

  if (await isBlockedEitherWay(fromUserId, String(toUserId))) {
    throw new AppError(SOCIAL_ERRORS.CANNOT_SWIPE_BLOCKED_USER, 403);
  }

  const target = await prisma.user.findUnique({
    where: { id: String(toUserId) },
    select: { id: true, profile: true }
  });
  if (!target?.profile) throw new AppError(DISCOVERY_ERRORS.SWIPE_TARGET_NOT_FOUND, 404);

  const swipeRecord = await prisma.swipe.upsert({
    where: {
      fromUserId_toUserId: {
        fromUserId,
        toUserId: String(toUserId)
      }
    },
    create: {
      fromUserId,
      toUserId: String(toUserId),
      action
    },
    update: {
      action
    }
  });

  let match = null;
  const isPositive = action === 'like';
  if (isPositive) {
    const reverseSwipe = await prisma.swipe.findUnique({
      where: {
        fromUserId_toUserId: {
          fromUserId: String(toUserId),
          toUserId: fromUserId
        }
      }
    });

    if (reverseSwipe && reverseSwipe.action === 'like') {
      const [user1Id, user2Id] = normalizePair(fromUserId, String(toUserId));
      match = await prisma.match.upsert({
        where: { user1Id_user2Id: { user1Id, user2Id } },
        create: { user1Id, user2Id },
        update: {}
      });
    }
  }

  res.status(201).json({
    status: 'success',
    data: {
      swipe: swipeRecord,
      matched: !!match,
      matchId: match ? String(match.id) : null
    }
  });
});
