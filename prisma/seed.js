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

  await prisma.interest.createMany({
    data: interests,
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

