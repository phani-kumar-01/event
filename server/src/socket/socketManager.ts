import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import prisma from '../utils/prisma';
import { initRunnerBridge } from '../services/runnerBridge';

// In-memory cache of active running events for zero-DB-load timer broadcasts
interface RunningEventCache {
  id: string;
  endTimeMs: number;
  status: string;
}

let activeRunningEventsCache: RunningEventCache[] = [];
let lastCacheSyncTime = 0;
let cacheNeedsSync = true;

export function invalidateRunningEventsCache(): void {
  cacheNeedsSync = true;
}

export function updateEventInCache(event: { id: string; status: string; endTime?: Date }): void {
  if (event.status === 'RUNNING' && event.endTime) {
    const existingIndex = activeRunningEventsCache.findIndex((e) => e.id === event.id);
    const item: RunningEventCache = {
      id: event.id,
      endTimeMs: new Date(event.endTime).getTime(),
      status: event.status,
    };
    if (existingIndex >= 0) {
      activeRunningEventsCache[existingIndex] = item;
    } else {
      activeRunningEventsCache.push(item);
    }
  } else {
    activeRunningEventsCache = activeRunningEventsCache.filter((e) => e.id !== event.id);
  }
}

export function initSocket(io: Server): void {
  initRunnerBridge(io);

  io.use(async (socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (token) {
      try {
        const user = verifyToken(token);
        socket.data.user = user;
      } catch {
        // Token invalid
      }
    }
    next();
  });

  io.on('connection', async (socket: Socket) => {
    const user = socket.data.user;

    if (user) {
      if (user.role === 'ADMIN') {
        socket.join('admin');
        try {
          const events = await prisma.event.findMany({ select: { id: true } });
          events.forEach((e) => socket.join(`event:${e.id}`));
        } catch {
          // Non-critical fallback
        }
      }
    }

    socket.on('join:event', (eventId: string) => {
      if (typeof eventId === 'string' && eventId.trim()) {
        socket.join(`event:${eventId.trim()}`);
      }
    });

    socket.on('leave:event', (eventId: string) => {
      if (typeof eventId === 'string' && eventId.trim()) {
        socket.leave(`event:${eventId.trim()}`);
      }
    });
  });

  // Broadcast synchronized timer ticks every 1 second
  // Uses in-memory cache exclusively so the 1-second loop NEVER hammers PostgreSQL
  setInterval(async () => {
    try {
      const now = Date.now();

      // Only check DB if explicitly invalidated or after 60s background sync
      if (cacheNeedsSync || now - lastCacheSyncTime > 60000) {
        lastCacheSyncTime = now;
        cacheNeedsSync = false;
        try {
          const running = await prisma.event.findMany({
            where: { status: 'RUNNING' },
            select: { id: true, endTime: true, status: true },
          });
          activeRunningEventsCache = running.map((r) => ({
            id: r.id,
            endTimeMs: r.endTime.getTime(),
            status: r.status,
          }));
        } catch {
          // If DB is unreachable, retain existing memory cache without crashing
        }
      }

      if (activeRunningEventsCache.length === 0) return;

      for (const ev of activeRunningEventsCache) {
        const remainingSeconds = Math.max(0, Math.floor((ev.endTimeMs - now) / 1000));
        io.to(`event:${ev.id}`).emit('timer:tick', {
          eventId: ev.id,
          remainingSeconds,
          serverTime: new Date(now).toISOString(),
        });

        // If time expired, prune from running cache
        if (remainingSeconds <= 0) {
          activeRunningEventsCache = activeRunningEventsCache.filter((e) => e.id !== ev.id);
        }
      }
    } catch {
      // Ignore transient interval errors
    }
  }, 1000);
}

import { invalidateCurrentEventCache } from '../services/eventService';

/**
 * Emit event state change to the event room and admin.
 */
export function emitEventStateChanged(
  io: Server,
  event: {
    id: string;
    type: string;
    name: string;
    status: string;
    startTime: Date;
    endTime: Date;
    version: number;
    currentRound?: number;
    round1Status?: string;
    round2Status?: string;
  }
): void {
  invalidateCurrentEventCache();
  updateEventInCache(event);
  const payload = {
    eventId: event.id,
    type: event.type,
    name: event.name,
    status: event.status,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    version: event.version,
    currentRound: event.currentRound || 1,
    round1Status: event.round1Status || 'DRAFT',
    round2Status: event.round2Status || 'DRAFT',
    serverTime: new Date().toISOString(),
  };

  io.to(`event:${event.id}`).emit('event.state_changed', payload);
  io.to('admin').emit('event.state_changed', payload);
}

/**
 * Emit round state change specifically to event room and admin.
 */
export function emitEventRoundChanged(
  io: Server,
  event: {
    id: string;
    type: string;
    name: string;
    status: string;
    startTime: Date;
    endTime: Date;
    version: number;
    currentRound?: number;
    round1Status?: string;
    round2Status?: string;
  }
): void {
  invalidateCurrentEventCache();
  updateEventInCache(event);
  const payload = {
    eventId: event.id,
    type: event.type,
    name: event.name,
    status: event.status,
    currentRound: event.currentRound || 1,
    round1Status: event.round1Status || 'DRAFT',
    round2Status: event.round2Status || 'DRAFT',
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    version: event.version,
    serverTime: new Date().toISOString(),
  };

  io.to(`event:${event.id}`).emit('event.round_changed', payload);
  io.to(`event:${event.id}`).emit('event.state_changed', payload);
  io.to('admin').emit('event.round_changed', payload);
  io.to('admin').emit('event.state_changed', payload);
}
