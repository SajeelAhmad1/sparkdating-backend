const prisma = require('../utils/prisma');

async function main() {
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

