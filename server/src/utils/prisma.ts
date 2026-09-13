import { PrismaClient } from '@prisma/client';

function normalizeDatabaseUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return rawUrl;
  try {
    const url = new URL(rawUrl);
    if (!url.searchParams.has('connection_limit')) {
      url.searchParams.set('connection_limit', '10');
    }
    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '30');
    }
    if (!url.searchParams.has('connect_timeout')) {
      url.searchParams.set('connect_timeout', '15');
    }
    return url.toString();
  } catch {
    return rawUrl;
  }
}

const rawUrl = process.env.DATABASE_URL;
const normalizedUrl = normalizeDatabaseUrl(rawUrl);

const prisma = new PrismaClient({
  datasources: normalizedUrl ? { db: { url: normalizedUrl } } : undefined,
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

export async function withDbRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  baseDelayMs = 200
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err: any) {
      attempt++;
      const isTransient =
        err?.code === 'P1001' ||
        err?.code === 'P1017' ||
        err?.code === 'P2024' ||
        err?.message?.includes("Can't reach database server") ||
        err?.message?.includes('closed the connection') ||
        err?.message?.includes('connection pool') ||
        err?.message?.includes('max clients reached') ||
        err?.message?.includes('EMAXCONNSESSION') ||
        err?.message?.includes('ECONNRESET') ||
        err?.message?.includes('ETIMEDOUT') ||
        err?.message?.includes('EPIPE');

      if (isTransient && attempt <= maxRetries) {
        const delay = baseDelayMs * attempt;
        console.warn(
          `[Prisma Retry] Transient database error (attempt ${attempt}/${maxRetries}): ${err.message}. Retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
}

export async function checkDatabaseHealth(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - start };
  } catch (err: any) {
    return { ok: false, latencyMs: Date.now() - start, error: err.message };
  }
}

export default prisma;
