import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';

const prisma = new PrismaClient();

async function main() {
  // Check if any admin user already exists. We use existence-in-DB as our
  // idempotency guard rather than a flag file - flag files break across
  // volume migrations, and re-seeding would reset the admin password.
  const existingAdmin = await prisma.user.findFirst({
    where: { role: 'admin' },
  });

  if (existingAdmin) {
    console.log('[seed] Admin already exists, skipping.');
    console.log(`[seed] Admin email: ${existingAdmin.email}`);
    return;
  }

  // Generate a random initial admin password rather than hardcoding one.
  // The plain value is printed once to stdout - the admin grabs it from
  // container logs on first start, then changes it on first login because
  // we set mustChangePassword=true.
  const initialPassword = process.env.ADMIN_INITIAL_PASSWORD ||
    randomBytes(12).toString('base64url');

  const hashedPassword = await bcrypt.hash(initialPassword, 12);

  const adminEmail = process.env.ADMIN_EMAIL || 'admin@prometheus.local';

  const admin = await prisma.user.create({
    data: {
      email: adminEmail,
      username: 'admin',
      password: hashedPassword,
      role: 'admin',
      status: 'approved',
      mustChangePassword: true,
    },
  });

  console.log('═══════════════════════════════════════════════════');
  console.log('  ADMIN ACCOUNT CREATED');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Email:    ${admin.email}`);
  console.log(`  Password: ${initialPassword}`);
  console.log('');
  console.log('  ⚠  This password is shown ONCE. Save it now.');
  console.log('  ⚠  You MUST change it on first login.');
  console.log('═══════════════════════════════════════════════════');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
