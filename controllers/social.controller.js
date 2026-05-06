const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { parseBody, parseQuery, parsePaginationQuery } = require('../utils/validation');
const prisma = require('../utils/prisma');
const { SOCIAL_VALIDATION } = require('../validations/social.validation');
const { SOCIAL_ERRORS } = require('../errors/social.errors');

const { photoUrls } = require('../utils/photos');

function normalizePair(a, b) {
  return String(a) < String(b) ? [String(a), String(b)] : [String(b), String(a)];
}

async function isBlockedEitherWay(userIdA, userIdB) {
  const row = await prisma.userBlock.findFirst({
    where: {
      OR: [
        { blockerId: userIdA, blockedUserId: userIdB },
        { blockerId: userIdB, blockedUserId: userIdA }
      ]
    },
    select: { id: true }
  });
  return !!row;
}

exports.blockUser = catchAsync(async (req, res) => {
  const { blockedUserId: targetId } = parseBody(SOCIAL_VALIDATION.blockUser, req);
  const myId = String(req.user.id);
  if (targetId === myId) throw new AppError(SOCIAL_ERRORS.CANNOT_BLOCK_SELF, 400);

  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true } });
  if (!target) throw new AppError(SOCIAL_ERRORS.USER_NOT_FOUND, 404);

  await prisma.$transaction([
    prisma.userBlock.upsert({
      where: { blockerId_blockedUserId: { blockerId: myId, blockedUserId: targetId } },
      create: { blockerId: myId, blockedUserId: targetId },
      update: {}
    }),
    prisma.connectionRequest.deleteMany({
      where: {
        OR: [
          { fromUserId: myId, toUserId: targetId },
          { fromUserId: targetId, toUserId: myId }
        ]
      }
    })
  ]);

  res.status(201).json({ status: 'success', data: { blocked: true } });
});

exports.listBlockedUsers = catchAsync(async (req, res) => {
  const { page: pageFromQuery } = parseQuery(SOCIAL_VALIDATION.listBlocked, req);
  const { page, skip, take, pageSize } = parsePaginationQuery(
    { page: pageFromQuery },
    { pageSize: 10 }
  );
  const myId = String(req.user.id);
  const where = { blockerId: myId };

  const [total, blocks] = await Promise.all([
    prisma.userBlock.count({ where }),
    prisma.userBlock.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include: {
        blockedUser: {
          select: {
            id: true,
            profile: { select: { firstName: true, lastName: true, photos: true } }
          }
        }
      }
    })
  ]);

  const users = blocks.map((b) => ({
    blockedAt: b.createdAt,
    user: {
      id: String(b.blockedUser.id),
      firstName: b.blockedUser.profile?.firstName ?? null,
      lastName: b.blockedUser.profile?.lastName ?? null,
      photos: photoUrls(b.blockedUser.profile?.photos ?? [])
    }
  }));

  res.json({
    status: 'success',
    data: {
      users,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0
    }
  });
});

exports.sendConnectionRequest = catchAsync(async (req, res) => {
  const { toUserId } = parseBody(SOCIAL_VALIDATION.sendConnectionRequest, req);
  const fromUserId = String(req.user.id);
  if (toUserId === fromUserId) throw new AppError(SOCIAL_ERRORS.CANNOT_REQUEST_SELF, 400);

  if (await isBlockedEitherWay(fromUserId, toUserId)) {
    throw new AppError(SOCIAL_ERRORS.CANNOT_REQUEST_BLOCKED_USER, 403);
  }

  const target = await prisma.user.findUnique({
    where: { id: toUserId },
    select: { id: true, profile: { select: { id: true } } }
  });
  if (!target?.profile) throw new AppError(SOCIAL_ERRORS.TARGET_PROFILE_REQUIRED, 404);

  const [user1Id, user2Id] = normalizePair(fromUserId, toUserId);
  const existingMatch = await prisma.match.findUnique({
    where: { user1Id_user2Id: { user1Id, user2Id } },
    select: { id: true }
  });
  if (existingMatch) {
    throw new AppError('You are already matched with this user', 409);
  }

  const existingRequest = await prisma.connectionRequest.findUnique({
    where: { fromUserId_toUserId: { fromUserId, toUserId } }
  });
  if (existingRequest?.status === 'accepted') {
    throw new AppError(SOCIAL_ERRORS.CONNECTION_REQUEST_ALREADY_ACCEPTED, 409);
  }

  let request;
  let created = false;
  if (!existingRequest) {
    request = await prisma.connectionRequest.create({
      data: { fromUserId, toUserId, status: 'pending' }
    });
    created = true;
  } else if (existingRequest.status === 'pending') {
    request = existingRequest;
  } else {
    request = await prisma.connectionRequest.update({
      where: { id: existingRequest.id },
      data: { status: 'pending' }
    });
  }

  res.status(created ? 201 : 200).json({
    status: 'success',
    data: {
      request: {
        id: String(request.id),
        fromUserId: String(request.fromUserId),
        toUserId: String(request.toUserId),
        status: request.status,
        createdAt: request.createdAt
      }
    }
  });
});

exports.acceptConnectionRequest = catchAsync(async (req, res) => {
  const requestId = String(req.params.requestId ?? '').trim();
  if (!requestId) throw new AppError('Request id is required', 400);
  const myId = String(req.user.id);

  const request = await prisma.connectionRequest.findUnique({
    where: { id: requestId }
  });
  if (!request) throw new AppError(SOCIAL_ERRORS.CONNECTION_REQUEST_NOT_FOUND, 404);
  if (String(request.toUserId) !== myId) {
    throw new AppError(SOCIAL_ERRORS.NOT_CONNECTION_REQUEST_RECIPIENT, 403);
  }
  if (request.status !== 'pending') {
    throw new AppError(SOCIAL_ERRORS.CONNECTION_REQUEST_NOT_PENDING, 400);
  }

  if (await isBlockedEitherWay(String(request.fromUserId), myId)) {
    throw new AppError(SOCIAL_ERRORS.CANNOT_REQUEST_BLOCKED_USER, 403);
  }

  const [user1Id, user2Id] = normalizePair(String(request.fromUserId), String(request.toUserId));

  const { match } = await prisma.$transaction(async (tx) => {
    await tx.connectionRequest.update({
      where: { id: requestId },
      data: { status: 'accepted' }
    });
    const m = await tx.match.upsert({
      where: { user1Id_user2Id: { user1Id, user2Id } },
      create: { user1Id, user2Id },
      update: {}
    });
    return { match: m };
  });

  res.json({
    status: 'success',
    data: {
      request: {
        id: requestId,
        status: 'accepted',
        fromUserId: String(request.fromUserId),
        toUserId: String(request.toUserId)
      },
      matchId: String(match.id)
    }
  });
});

exports.rejectConnectionRequest = catchAsync(async (req, res) => {
  const requestId = String(req.params.requestId ?? '').trim();
  if (!requestId) throw new AppError('Request id is required', 400);
  const myId = String(req.user.id);

  const request = await prisma.connectionRequest.findUnique({
    where: { id: requestId }
  });
  if (!request) throw new AppError(SOCIAL_ERRORS.CONNECTION_REQUEST_NOT_FOUND, 404);
  if (String(request.toUserId) !== myId) {
    throw new AppError(SOCIAL_ERRORS.NOT_CONNECTION_REQUEST_RECIPIENT, 403);
  }
  if (request.status !== 'pending') {
    throw new AppError(SOCIAL_ERRORS.CONNECTION_REQUEST_NOT_PENDING, 400);
  }

  await prisma.connectionRequest.update({
    where: { id: requestId },
    data: { status: 'declined' }
  });

  res.json({
    status: 'success',
    data: {
      request: {
        id: requestId,
        status: 'declined',
        fromUserId: String(request.fromUserId),
        toUserId: String(request.toUserId)
      }
    }
  });
});

exports.listConnectionRequests = catchAsync(async (req, res) => {
  const { page: pageFromQuery, direction } = parseQuery(SOCIAL_VALIDATION.listConnectionRequests, req);
  const { page, skip, take, pageSize } = parsePaginationQuery(
    { page: pageFromQuery },
    { pageSize: 10 }
  );
  const myId = String(req.user.id);
  const where =
    direction === 'sent' ? { fromUserId: myId } : { toUserId: myId };

  const peerInclude = {
    select: {
      id: true,
      profile: { select: { firstName: true, lastName: true, photos: true } }
    }
  };

  const [total, rows] = await Promise.all([
    prisma.connectionRequest.count({ where }),
    prisma.connectionRequest.findMany({
      where,
      skip,
      take,
      orderBy: { createdAt: 'desc' },
      include:
        direction === 'sent'
          ? { toUser: peerInclude }
          : { fromUser: peerInclude }
    })
  ]);

  const requests = rows.map((r) => {
    const peer = direction === 'sent' ? r.toUser : r.fromUser;
    return {
      id: String(r.id),
      status: r.status,
      direction,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      peer: {
        id: String(peer.id),
        firstName: peer.profile?.firstName ?? null,
        lastName: peer.profile?.lastName ?? null,
        photos: photoUrls(peer.profile?.photos ?? [])
      }
    };
  });

  res.json({
    status: 'success',
    data: {
      requests,
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize) || 0
    }
  });
});

exports.isBlockedEitherWay = isBlockedEitherWay;
