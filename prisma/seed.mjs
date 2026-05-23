import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const hashedPassword = await bcrypt.hash('admin123', 12);
  
  const admin = await prisma.user.upsert({
    where: { email: 'admin@prometheus.local' },
    update: {},
    create: {
      email: 'admin@prometheus.local',
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      status: 'approved',
    },
  });

  console.log('Seeded admin user:', admin.email);
  console.log('Default password: admin123 (GANTI SEGERA!)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
