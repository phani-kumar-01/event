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
      status: { in: ['RUNNING', 'PAUSED', 'READY'] },
    },
    orderBy: { startTime: 'asc' },
  });

  return event;
}

/**
 * Get the event that is currently RUNNING (status = RUNNING).
 */
export async function getRunningEvent(): Promise<Event | null> {
  return prisma.event.findFirst({
    where: {
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
  FINISHED: ['READY', 'RUNNING'], // allow reset/rerun in admin
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

  // If this is Technical Quiz, start Round 1 by default
  const isQuiz = event.type === 'TECHNICAL_QUIZ';

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      startTime: now,
      endTime: endsAt,
      ...(isQuiz && {
        currentRound: 1,
        round1Status: 'RUNNING',
      }),
      version: { increment: 1 },
    },
  });
}

/**
 * Start Round 1 for Technical Quiz.
 */
export async function startRound1(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const now = new Date();
  const endsAt = new Date(now.getTime() + (event.round1Duration || 1800) * 1000);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      currentRound: 1,
      round1Status: 'RUNNING',
      startTime: now,
      endTime: endsAt,
      version: { increment: 1 },
    },
  });
}

/**
 * Pause Round 1 for Technical Quiz.
 */
export async function pauseRound1(eventId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'PAUSED',
      round1Status: 'PAUSED',
      version: { increment: 1 },
    },
  });
}

/**
 * Resume Round 1 for Technical Quiz.
 */
export async function resumeRound1(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const now = new Date();
  const remainingMs = Math.max(event.endTime.getTime() - event.updatedAt.getTime(), 60000);
  const newEndTime = new Date(now.getTime() + remainingMs);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      round1Status: 'RUNNING',
      endTime: newEndTime,
      version: { increment: 1 },
    },
  });
}

/**
 * End Round 1 for Technical Quiz.
 */
export async function endRound1(eventId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'FINISHED',
      round1Status: 'FINISHED',
      endTime: new Date(),
      version: { increment: 1 },
    },
  });
}

/**
 * Compute and qualify Top 10 participants from Round 1.
 */
export async function computeRound1Qualifiers(eventId: string, overrideTopCount?: number) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const topCount = overrideTopCount || event.qualifierCount || 10;

  // 1. Fetch all student answers for Round 1
  const answers = await prisma.answer.findMany({
    where: { eventId, round: 1 },
    include: { user: true },
  });

  // 2. Fetch puzzle submissions for Round 1
  const puzzleSubmissions = await prisma.puzzleSubmission.findMany({
    where: { eventId, round: 1 },
  });

  // 3. Aggregate score and time per student
  const studentScores: Record<
    string,
    { userId: string; score: number; totalTime: number; correctCount: number; answeredCount: number }
  > = {};

  // Initialize for all answers
  for (const ans of answers) {
    if (!studentScores[ans.userId]) {
      studentScores[ans.userId] = {
        userId: ans.userId,
        score: 0,
        totalTime: 0,
        correctCount: 0,
        answeredCount: 0,
      };
    }
    studentScores[ans.userId].score += ans.pointsAwarded;
    studentScores[ans.userId].totalTime += ans.timeTakenSeconds || 0;
    studentScores[ans.userId].answeredCount += 1;
    if (ans.isCorrect) studentScores[ans.userId].correctCount += 1;
  }

  // Add puzzle scores
  for (const pz of puzzleSubmissions) {
    if (!studentScores[pz.userId]) {
      studentScores[pz.userId] = {
        userId: pz.userId,
        score: 0,
        totalTime: 0,
        correctCount: 0,
        answeredCount: 0,
      };
    }
    studentScores[pz.userId].score += pz.pointsAwarded;
    studentScores[pz.userId].totalTime += pz.timeTakenSeconds || 0;
  }

  // Also include any students who joined or are registered
  const allStudents = await prisma.user.findMany({ where: { role: 'STUDENT' } });
  for (const s of allStudents) {
    if (!studentScores[s.id]) {
      studentScores[s.id] = {
        userId: s.id,
        score: 0,
        totalTime: 0,
        correctCount: 0,
        answeredCount: 0,
      };
    }
  }

  // Sort: highest score first, lowest total time tie-break
  const sorted = Object.values(studentScores).sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.totalTime - b.totalTime;
  });

  // Assign ranks & qualification
  const now = new Date();
  const qualifications = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const isQualified = i < topCount && item.score > 0;
    const rank = i + 1;

    const qual = await prisma.quizQualification.upsert({
      where: { eventId_userId: { eventId, userId: item.userId } },
      create: {
        eventId,
        userId: item.userId,
        round1Score: item.score,
        round1Rank: rank,
        round1Time: item.totalTime,
        isQualified,
        qualifiedAt: isQualified ? now : null,
      },
      update: {
        round1Score: item.score,
        round1Rank: rank,
        round1Time: item.totalTime,
        isQualified,
        qualifiedAt: isQualified ? now : null,
      },
      include: { user: { select: { id: true, rollNo: true, name: true } } },
    });

    qualifications.push(qual);
  }

  return {
    qualifications,
    topCount,
    qualifiedCount: qualifications.filter((q) => q.isQualified).length,
  };
}

/**
 * Start Round 2 for Technical Quiz (Top 10 Qualifiers only).
 */
export async function startRound2(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const now = new Date();
  const endsAt = new Date(now.getTime() + (event.round2Duration || 1200) * 1000);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      currentRound: 2,
      round2Status: 'RUNNING',
      startTime: now,
      endTime: endsAt,
      version: { increment: 1 },
    },
  });
}

/**
 * Pause Round 2 for Technical Quiz.
 */
export async function pauseRound2(eventId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'PAUSED',
      round2Status: 'PAUSED',
      version: { increment: 1 },
    },
  });
}

/**
 * Resume Round 2 for Technical Quiz.
 */
export async function resumeRound2(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const now = new Date();
  const remainingMs = Math.max(event.endTime.getTime() - event.updatedAt.getTime(), 60000);
  const newEndTime = new Date(now.getTime() + remainingMs);

  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'RUNNING',
      round2Status: 'RUNNING',
      endTime: newEndTime,
      version: { increment: 1 },
    },
  });
}

/**
 * End Round 2 for Technical Quiz.
 */
export async function endRound2(eventId: string) {
  return prisma.event.update({
    where: { id: eventId },
    data: {
      status: 'FINISHED',
      round2Status: 'FINISHED',
      endTime: new Date(),
      version: { increment: 1 },
    },
  });
}

/**
 * Compute final rankings based on configurable weights (e.g. 40% R1 + 60% R2).
 */
export async function computeFinalRankings(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const r1Weight = event.round1Weight || 0.4;
  const r2Weight = event.round2Weight || 0.6;

  // 1. Fetch Round 2 answers
  const r2Answers = await prisma.answer.findMany({
    where: { eventId, round: 2 },
  });

  const r2Puzzle = await prisma.puzzleSubmission.findMany({
    where: { eventId, round: 2 },
  });

  // Calculate Round 2 scores
  const r2Scores: Record<string, { score: number; totalTime: number }> = {};
  for (const ans of r2Answers) {
    if (!r2Scores[ans.userId]) r2Scores[ans.userId] = { score: 0, totalTime: 0 };
    r2Scores[ans.userId].score += ans.pointsAwarded;
    r2Scores[ans.userId].totalTime += ans.timeTakenSeconds || 0;
  }
  for (const pz of r2Puzzle) {
    if (!r2Scores[pz.userId]) r2Scores[pz.userId] = { score: 0, totalTime: 0 };
    r2Scores[pz.userId].score += pz.pointsAwarded;
    r2Scores[pz.userId].totalTime += pz.timeTakenSeconds || 0;
  }

  // 2. Fetch all qualifications
  const quals = await prisma.quizQualification.findMany({
    where: { eventId },
    include: { user: { select: { id: true, rollNo: true, name: true } } },
  });

  // Update R2 scores and compute final weighted scores
  const calculated = quals.map((q) => {
    const r2Data = r2Scores[q.userId] || { score: 0, totalTime: 0 };
    const r2Score = q.isQualified ? r2Data.score : 0;
    const r2Time = q.isQualified ? r2Data.totalTime : 0;
    // Final weighted score calculation
    const finalScore = Number((q.round1Score * r1Weight + r2Score * r2Weight).toFixed(2));
    const totalTime = q.round1Time + r2Time;

    return {
      id: q.id,
      userId: q.userId,
      user: q.user,
      isQualified: q.isQualified,
      round1Score: q.round1Score,
      round1Rank: q.round1Rank,
      round1Time: q.round1Time,
      round2Score: r2Score,
      round2Time: r2Time,
      finalScore,
      totalTime,
    };
  });

  // Sort qualified participants first by final score, then non-qualified by Round 1 score
  calculated.sort((a, b) => {
    if (a.isQualified && !b.isQualified) return -1;
    if (!a.isQualified && b.isQualified) return 1;
    if (b.finalScore !== a.finalScore) return b.finalScore - a.finalScore;
    return a.totalTime - b.totalTime;
  });

  // Save ranks to database
  const updatedQuals = [];
  for (let i = 0; i < calculated.length; i++) {
    const item = calculated[i];
    const finalRank = i + 1;

    const saved = await prisma.quizQualification.update({
      where: { id: item.id },
      data: {
        round2Score: item.round2Score,
        round2Time: item.round2Time,
        finalScore: item.finalScore,
        finalRank,
      },
      include: { user: { select: { id: true, rollNo: true, name: true } } },
    });

    updatedQuals.push(saved);
  }

  return {
    rankings: updatedQuals,
    r1Weight,
    r2Weight,
  };
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
 */
export async function resumeEvent(eventId: string) {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  validateTransition(event.status as EventStatus, 'RUNNING');

  const now = new Date();
  const remainingMs = event.endTime.getTime() - event.updatedAt.getTime();
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
      endTime: new Date(),
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
