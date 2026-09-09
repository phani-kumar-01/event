import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt';
import prisma from '../utils/prisma';

export function initSocket(io: Server): void {
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
        // Admin joins all event rooms and admin room
        socket.join('admin');
        const events = await prisma.event.findMany();
        events.forEach((e) => socket.join(`event:${e.id}`));
        console.log(`🔑 Admin connected: ${user.rollNo}`);
      } else {
        console.log(`👤 Student connected: ${user.rollNo}`);
      }
    }

    // Student joins a specific event room (sent from client after determining current event)
    socket.on('join:event', (eventId: string) => {
      socket.join(`event:${eventId}`);
    });

    socket.on('leave:event', (eventId: string) => {
      socket.leave(`event:${eventId}`);
    });

    socket.on('disconnect', () => {
      // Cleanup handled automatically by Socket.IO
    });
  });
}

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
