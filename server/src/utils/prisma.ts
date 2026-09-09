import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function initPrismaSqlite(): Promise<void> {
  try {
    await prisma.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await prisma.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
    await prisma.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
  } catch (err) {
    // Non-critical logging in case db is during initial creation
    console.warn('SQLite PRAGMA WAL init:', (err as Error).message);
  }
}

// Automatically configure WAL mode on startup
initPrismaSqlite();

export default prisma;

