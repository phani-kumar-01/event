import prisma from '../utils/prisma';
import { Event } from '@prisma/client';

type EventStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'FINISHED';
type EventType = 'DEBUGGING' | 'TECHNICAL_QUIZ';

/**
 * Determine the currently active event based on server time.
 * Returns null if no event is currently scheduled to be running.
 */
export async function getCurrentEvent(): Promise<Event | null> {
  const now = new Date();

  // Find the event whose time window includes now and is in a runnable state
  const event = await prisma.event.findFirst({
    where: {
      startTime: { lte: now },
      endTime: { gte: now },
      status: { in: ['RUNNING', 'PAUSED', 'READY'] },
    },
    orderBy: { startTime: 'asc' },
  });

  return event;
}

/**
 * Get the event that is currently RUNNING (status = RUNNING and within time window).
 */
export async function getRunningEvent(): Promise<Event | null> {
  const now = new Date();
  return prisma.event.findFirst({
    where: {
      startTime: { lte: now },
      endTime: { gte: now },
      status: 'RUNNING',
    },
  });
}

/**
 * Validate and apply an event status transition.
 * Throws if transition is invalid.
 */
const VALID_TRANSITIONS: Partial<Record<EventStatus, EventStatus[]>> = {
  DRAFT: ['READY'],
  READY: ['RUNNING'],
  RUNNING: ['PAUSED', 'FINISHED'],
  PAUSED: ['RUNNING', 'FINISHED'],
};

export function validateTransition(current: EventStatus, next: EventStatus): void {
  const allowed = VALID_TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Cannot transition from ${current} to ${next}`);
  }
}

/**
 * Start an event: set status RUNNING, record startTime, increment version.
 */
export async function startEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'RUNNING');

  const now = new Date();
  const endsAt = new Date(now.getTime() + event.durationSeconds * 1000);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      startTime: now,
      endTime: endsAt,
      version: { increment: 1 },
    },
  });
}

/**
 * Pause an event: calculate remaining seconds, store them for resume.
 */
export async function pauseEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'PAUSED');

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'PAUSED',
      version: { increment: 1 },
    },
  });
}

/**
 * Resume an event: calculate new endTime from remaining time.
 * Remaining = original endTime - pausedAt (paused at last update time).
 */
export async function resumeEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'RUNNING');

  // Calculate remaining time: endTime was set when last running
  const now = new Date();
  const remainingMs = event.endTime.getTime() - event.updatedAt.getTime();
  // Protect against negative remaining time
  const newEndTime = new Date(now.getTime() + Math.max(remainingMs, 0));

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      endTime: newEndTime,
      version: { increment: 1 },
    },
  });
}

/**
 * End an event: set status FINISHED.
 */
export async function endEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'FINISHED');

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'FINISHED',
      endTime: new Date(), // mark end at now
      version: { increment: 1 },
    },
  });
}

/**
 * Mark an event READY (from DRAFT).
 */
export async function readyEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'READY');

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'READY',
      version: { increment: 1 },
    },
  });
}

export type { EventType };
