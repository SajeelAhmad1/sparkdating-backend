const prisma = require('../utils/prisma');

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function sample(arr, count) {
  const copy = [...arr];
  const out = [];
  while (copy.length && out.length < count) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]);
  }
  return out;
}

function makeMedia(seed) {
  const w = pick([720, 900, 1080]);
  const h = pick([960, 1200, 1440]);
  return {
    url: `https://picsum.photos/seed/${encodeURIComponent(seed)}/${w}/${h}`,
    width: w,
    height: h,
    mime: 'image/jpeg',
    size: pick([180000, 220000, 260000, 310000])
  };
}

async function main() {
  // Ensure geo indexes exist (Prisma Mongo schema cannot reliably express 2dsphere indexes).
  // If they already exist, Mongo will error; we ignore those cases.
  try {
    await prisma.$runCommandRaw({
      createIndexes: 'UserLocation',
      indexes: [
        {
          key: { point: '2dsphere' },
          name: 'UserLocation_point_2dsphere'
        }
      ]
    });
  } catch {}

  try {
    await prisma.$runCommandRaw({
      createIndexes: 'ServiceArea',
      indexes: [
        {
          key: { geometry: '2dsphere' },
          name: 'ServiceArea_geometry_2dsphere'
        }
      ]
    });
  } catch {}

  const interests = [
    // Content and lifestyle
    { name: 'Content Creation', category: 'Content and lifestyle' },
    { name: 'Privacy Focused Lifestyle', category: 'Content and lifestyle' },
    { name: 'Online Entrepreneurship', category: 'Content and lifestyle' },
    { name: 'Traveling for Work', category: 'Content and lifestyle' },

    // Wellness and growth
    { name: 'Fitness / Body Maintenance', category: 'Wellness and growth' },
    { name: 'Fame-Aware Dating', category: 'Wellness and growth' },
    { name: 'Mental Health & Self-Care', category: 'Wellness and growth' },

    // Creative & Hobbies
    { name: 'Photography', category: 'Creative & Hobbies' },
    { name: 'Music', category: 'Creative & Hobbies' },
    { name: 'Gaming', category: 'Creative & Hobbies' },
    { name: 'Art', category: 'Creative & Hobbies' },
    { name: 'Books', category: 'Creative & Hobbies' },
    { name: 'Movies', category: 'Creative & Hobbies' },

    // Lifestyle
    { name: 'Travel', category: 'Lifestyle' },
    { name: 'Food', category: 'Lifestyle' },
    { name: 'Cooking', category: 'Lifestyle' },
    { name: 'Dancing', category: 'Lifestyle' },
    { name: 'Sports', category: 'Lifestyle' }
  ];

  for (const interest of interests) {
    await prisma.interest.upsert({
      where: { name: interest.name },
      create: interest,
      update: { category: interest.category }
    });
  }

  const serviceAreas = [
    {
      name: 'Netherlands',
      countryCode: 'NL',
      // Rough country bounding box polygon.
      geometry: {
        type: 'Polygon',
        coordinates: [[[3.2, 50.7], [7.4, 50.7], [7.4, 53.7], [3.2, 53.7], [3.2, 50.7]]]
      }
    },
    {
      name: 'Pakistan',
      countryCode: 'PK',
      // Rough country bounding box polygon.
      geometry: {
        type: 'Polygon',
        coordinates: [[[60.8, 23.5], [77.9, 23.5], [77.9, 37.2], [60.8, 37.2], [60.8, 23.5]]]
      }
    }
  ];

  for (const area of serviceAreas) {
    await prisma.serviceArea.upsert({
      where: { name: area.name },
      create: { ...area, isActive: true },
      update: {
        countryCode: area.countryCode,
        geometry: area.geometry,
        isActive: true
      }
    });
  }

  await prisma.discoveryFilter.upsert({
    where: { key: 'default' },
    create: {
      key: 'default',
      youngerAgeDelta: 5,
      olderAgeDelta: 5,
      maxDistanceKm: 50,
      isActive: true
    },
    update: {
      youngerAgeDelta: 5,
      olderAgeDelta: 5,
      maxDistanceKm: 50,
      isActive: true
    }
  });

  // --- Chat seed (conversations + messages + read/unread + streak expiry mixes) ---
  const users = await prisma.user.findMany({
    select: { id: true }
  });

  if (users.length < 2) return;

  // Create direct conversations so every user has at least one.
  // Pair neighbors + add a few random extra conversations.
  const userIds = users.map((u) => String(u.id));
  const pairs = [];
  for (let i = 0; i < userIds.length - 1; i++) {
    pairs.push([userIds[i], userIds[i + 1]]);
  }
  for (let i = 0; i < Math.min(10, userIds.length); i++) {
    const [a, b] = sample(userIds, 2);
    pairs.push([a, b]);
  }

  const now = Date.now();
  const createdConversationIds = [];

  for (const [a, b] of pairs) {
    if (!a || !b || a === b) continue;

    // Avoid duplicating: check if a conversation already exists with exactly these members.
    // Mongo scalar-list matching is limited; we approximate by searching for both members and type direct.
    const existing = await prisma.conversation.findFirst({
      where: { type: 'direct', memberIds: { hasEvery: [a, b] } },
      select: { id: true }
    });
    const conversation =
      existing ??
      (await prisma.conversation.create({
        data: {
          type: 'direct',
          memberIds: [a, b]
        },
        select: { id: true }
      }));

    createdConversationIds.push(String(conversation.id));

    const messageCount = pick([6, 8, 10, 12]);
    const messages = [];

    for (let i = 0; i < messageCount; i++) {
      const senderId = pick([a, b]);
      const kindRoll = Math.random();

      if (kindRoll < 0.65) {
        messages.push({
          conversationId: String(conversation.id),
          senderId,
          type: 'text',
          text: pick([
            'Hey!',
            'How was your day?',
            'Sent a photo',
            'What are you up to?',
            'Nice to meet you',
            'Let’s chat later'
          ]),
          createdAt: new Date(now - (messageCount - i) * 60 * 60 * 1000)
        });
      } else if (kindRoll < 0.85) {
        messages.push({
          conversationId: String(conversation.id),
          senderId,
          type: 'image',
          media: makeMedia(`${conversation.id}-img-${i}`),
          createdAt: new Date(now - (messageCount - i) * 55 * 60 * 1000)
        });
      } else {
        // streak: create a mix of expiring soon vs expired
        const expMode = pick(['soon', 'expired']);
        const expiresAt =
          expMode === 'soon'
            ? new Date(now + pick([2, 5, 10, 20]) * 60 * 1000)
            : new Date(now - pick([20, 60, 180]) * 60 * 1000);

        messages.push({
          conversationId: String(conversation.id),
          senderId,
          type: 'streak',
          media: makeMedia(`${conversation.id}-streak-${i}`),
          streakExpiresAt: expiresAt,
          streakViewedBy: pick([[], [a], [b], [a, b]]),
          createdAt: new Date(now - (messageCount - i) * 50 * 60 * 1000)
        });
      }
    }

    // Bulk insert messages sequentially to retain deterministic createdAt ordering.
    let lastMessage = null;
    for (const msg of messages) {
      // eslint-disable-next-line no-await-in-loop
      lastMessage = await prisma.message.create({ data: msg });
    }

    await prisma.conversation.update({
      where: { id: String(conversation.id) },
      data: { lastMessageAt: lastMessage ? lastMessage.createdAt : null }
    });

    // Read/unread states:
    // - For user A, mark as read up to a message near the end
    // - For user B, sometimes unread (older lastRead) to create unread badges
    const allMsgs = await prisma.message.findMany({
      where: { conversationId: String(conversation.id) },
      orderBy: { createdAt: 'asc' },
      select: { id: true, createdAt: true }
    });

    if (allMsgs.length) {
      const aReadIdx = Math.max(0, allMsgs.length - pick([1, 2, 3]));
      const bReadIdx = Math.max(0, allMsgs.length - pick([1, 4, 6, 8]));

      const aLast = allMsgs[aReadIdx] ?? allMsgs[allMsgs.length - 1];
      const bLast = allMsgs[bReadIdx] ?? allMsgs[0];

      await prisma.conversationReadState.upsert({
        where: { conversationId_userId: { conversationId: String(conversation.id), userId: a } },
        create: {
          conversationId: String(conversation.id),
          userId: a,
          lastReadMessageId: String(aLast.id),
          lastReadAt: aLast.createdAt
        },
        update: {
          lastReadMessageId: String(aLast.id),
          lastReadAt: aLast.createdAt
        }
      });

      await prisma.conversationReadState.upsert({
        where: { conversationId_userId: { conversationId: String(conversation.id), userId: b } },
        create: {
          conversationId: String(conversation.id),
          userId: b,
          lastReadMessageId: String(bLast.id),
          lastReadAt: bLast.createdAt
        },
        update: {
          lastReadMessageId: String(bLast.id),
          lastReadAt: bLast.createdAt
        }
      });
    }
  }
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });

