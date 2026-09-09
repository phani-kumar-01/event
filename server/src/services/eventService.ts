import prisma from '../utils/prisma';
import { Event } from '@prisma/client';

type EventStatus = 'DRAFT' | 'READY' | 'RUNNING' | 'PAUSED' | 'FINISHED';
type EventType = 'DEBUGGING' | 'TECHNICAL_QUIZ';

/**
 * Determine the currently active event based on server time.
 * Returns null if no event is currently scheduled to be running.
 */
export async function getCurrentEvent(): Promise<Event | null> {
  // 1. Prioritize currently RUNNING or PAUSED event
  let event = await prisma.event.findFirst({
    where: {
      status: { in: ['RUNNING', 'PAUSED'] },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (event) return event;

  // 2. Look for an event that is READY
  event = await prisma.event.findFirst({
    where: {
      status: 'READY',
    },
    orderBy: { startTime: 'asc' },
  });
  if (event) return event;

  // 3. Look for a Technical Quiz event in intermission (Round 1 finished, Round 2 not finished yet)
  event = await prisma.event.findFirst({
    where: {
      type: 'TECHNICAL_QUIZ',
      round1Status: 'FINISHED',
      round2Status: { not: 'FINISHED' },
    },
    orderBy: { updatedAt: 'desc' },
  });
  if (event) return event;

  // 4. Look for the most recent event (e.g. FINISHED or DRAFT)
  event = await prisma.event.findFirst({
    where: {
      status: { in: ['FINISHED', 'DRAFT'] },
    },
    orderBy: { updatedAt: 'desc' },
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

// ─── Deterministic Seeded Randomization & Question Ordering ──────────────────

/**
 * Simple 32-bit string hash (FNV-1a)
 */
export function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Seeded PRNG: Mulberry32
 * Returns deterministic pseudo-random float in [0, 1)
 */
export function createMulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seeded Fisher-Yates shuffle
 */
export function seededShuffle<T>(array: T[], prng: () => number): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(prng() * (i + 1));
    const temp = result[i];
    result[i] = result[j];
    result[j] = temp;
  }
  return result;
}

export interface OptionMapping {
  displayToOriginal: Record<string, string>; // e.g. { A: "C", B: "A", C: "D", D: "B" }
  originalToDisplay: Record<string, string>; // e.g. { C: "A", A: "B", D: "C", B: "D" }
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  shuffleInitialOrder?: string[];
}

/**
 * Fetch and return the deterministic, student-specific ordered question list for a challenge.
 * On first call for (userId, challengeId), computes a seeded shuffle of questions and MCQ options,
 * persists the order in StudentQuestionOrder table, and serves this exact order on all subsequent calls.
 */
export async function getOrderedQuestionsForStudent(
  userId: string,
  challengeId: string,
  options: { includeAnswers?: boolean } = {}
) {
  // 1. Check if order was already persisted for this student and challenge
  let orderRecord = await prisma.studentQuestionOrder.findUnique({
    where: {
      userId_challengeId: { userId, challengeId },
    },
  });

  // Fetch all active questions for this challenge
  const allQuestions = await prisma.quizQuestion.findMany({
    where: { challengeId },
    orderBy: { order: 'asc' },
  });

  if (allQuestions.length === 0) {
    return [];
  }

  let orderedQuestionIds: string[] = [];
  let optionMapPerQuestion: Record<string, OptionMapping> = {};

  if (orderRecord) {
    try {
      orderedQuestionIds = JSON.parse(orderRecord.orderedQuestionIds);
      optionMapPerQuestion = JSON.parse(orderRecord.optionMapPerQuestion);
    } catch {
      orderRecord = null;
    }
  }

  // 2. If first time, compute and persist the student's unique shuffle
  if (!orderRecord) {
    const seed = hashString(`${userId}_${challengeId}`);
    const prng = createMulberry32(seed);

    // (a) Permute question order
    const shuffledQuestions = seededShuffle(allQuestions, prng);
    orderedQuestionIds = shuffledQuestions.map((q) => q.id);

    // (b) Permute option order for each question
    for (const q of shuffledQuestions) {
      if (q.type === 'SHUFFLE_ORDER') {
        const rawItems = [q.optionA, q.optionB, q.optionC, q.optionD].filter(
          (opt) => opt && opt.trim() !== ''
        );
        let scrambled = seededShuffle(rawItems, prng);
        try {
          const correctSeq = JSON.parse(q.correctAnswer);
          if (
            Array.isArray(correctSeq) &&
            JSON.stringify(scrambled) === JSON.stringify(correctSeq) &&
            scrambled.length > 1
          ) {
            const first = scrambled[0];
            scrambled[0] = scrambled[1];
            scrambled[1] = first;
          }
        } catch {
          // ignore
        }

        optionMapPerQuestion[q.id] = {
          displayToOriginal: { A: 'A', B: 'B', C: 'C', D: 'D' },
          originalToDisplay: { A: 'A', B: 'B', C: 'C', D: 'D' },
          optionA: scrambled[0] || '',
          optionB: scrambled[1] || '',
          optionC: scrambled[2] || '',
          optionD: scrambled[3] || '',
          shuffleInitialOrder: scrambled,
        };
      } else if (q.type === 'REAL_OR_FAKE') {
        optionMapPerQuestion[q.id] = {
          displayToOriginal: { REAL: 'REAL', FAKE: 'FAKE' },
          originalToDisplay: { REAL: 'REAL', FAKE: 'FAKE' },
          optionA: q.optionA,
          optionB: q.optionB,
          optionC: q.optionC,
          optionD: q.optionD,
        };
      } else {
        const origOptions = [
          { key: 'A', text: q.optionA },
          { key: 'B', text: q.optionB },
          { key: 'C', text: q.optionC },
          { key: 'D', text: q.optionD },
        ].filter((opt) => opt.text && opt.text.trim() !== '');

        if (origOptions.length >= 2) {
          const shuffledOpts = seededShuffle(origOptions, prng);
          const displayKeys = ['A', 'B', 'C', 'D'].slice(0, shuffledOpts.length);
          const displayToOrig: Record<string, string> = {};
          const origToDisplay: Record<string, string> = {};
          const displayOpts: Record<string, string> = {
            optionA: '',
            optionB: '',
            optionC: '',
            optionD: '',
          };

          for (let k = 0; k < displayKeys.length; k++) {
            const dispKey = displayKeys[k];
            const orig = shuffledOpts[k];
            displayToOrig[dispKey] = orig.key;
            origToDisplay[orig.key] = dispKey;
            displayOpts[`option${dispKey}`] = orig.text;
          }

          optionMapPerQuestion[q.id] = {
            displayToOriginal: displayToOrig,
            originalToDisplay: origToDisplay,
            optionA: displayOpts.optionA || '',
            optionB: displayOpts.optionB || '',
            optionC: displayOpts.optionC || '',
            optionD: displayOpts.optionD || '',
          };
        } else {
          optionMapPerQuestion[q.id] = {
            displayToOriginal: { A: 'A', B: 'B', C: 'C', D: 'D' },
            originalToDisplay: { A: 'A', B: 'B', C: 'C', D: 'D' },
            optionA: q.optionA,
            optionB: q.optionB,
            optionC: q.optionC,
            optionD: q.optionD,
          };
        }
      }
    }

    // Save computed order in DB
    await prisma.studentQuestionOrder.upsert({
      where: { userId_challengeId: { userId, challengeId } },
      create: {
        userId,
        challengeId,
        orderedQuestionIds: JSON.stringify(orderedQuestionIds),
        optionMapPerQuestion: JSON.stringify(optionMapPerQuestion),
      },
      update: {
        orderedQuestionIds: JSON.stringify(orderedQuestionIds),
        optionMapPerQuestion: JSON.stringify(optionMapPerQuestion),
      },
    });
  }

  // 3. Construct questions matching the stored order and remapped options
  const qMap = new Map(allQuestions.map((q) => [q.id, q]));
  const result = [];

  for (const qId of orderedQuestionIds) {
    const rawQ = qMap.get(qId);
    if (!rawQ) continue;

    const optMap = optionMapPerQuestion[qId];
    const displayA = optMap ? optMap.optionA : rawQ.optionA;
    const displayB = optMap ? optMap.optionB : rawQ.optionB;
    const displayC = optMap ? optMap.optionC : rawQ.optionC;
    const displayD = optMap ? optMap.optionD : rawQ.optionD;

    result.push({
      id: rawQ.id,
      challengeId: rawQ.challengeId,
      round: rawQ.round,
      category: rawQ.category,
      type: rawQ.type,
      question: rawQ.question,
      imageUrl: rawQ.imageUrl,
      optionA: displayA,
      optionB: displayB,
      optionC: displayC,
      optionD: displayD,
      points: rawQ.points,
      order: rawQ.order,
      ...(options.includeAnswers && {
        correctAnswer: rawQ.correctAnswer,
        explanation: rawQ.explanation,
        optionMapping: optMap,
      }),
    });
  }

  return result;
}

/**
 * Validate a student answer taking option remapping into account.
 */
export async function validateStudentAnswer(
  userId: string,
  question: { id: string; challengeId: string | null; type: string; correctAnswer: string; points: number },
  selectedAnswer: string
): Promise<{ isCorrect: boolean; pointsAwarded: number }> {
  let isCorrect = false;

  if (question.type === 'SHUFFLE_ORDER') {
    try {
      const studentArr = JSON.parse(selectedAnswer);
      const correctArr = JSON.parse(question.correctAnswer);
      isCorrect = JSON.stringify(studentArr) === JSON.stringify(correctArr);
    } catch {
      isCorrect = selectedAnswer.trim() === question.correctAnswer.trim();
    }
  } else if (question.type === 'REAL_OR_FAKE') {
    isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
  } else {
    if (question.challengeId) {
      const orderRecord = await prisma.studentQuestionOrder.findUnique({
        where: { userId_challengeId: { userId, challengeId: question.challengeId } },
      });

      if (orderRecord) {
        try {
          const optionMap = JSON.parse(orderRecord.optionMapPerQuestion);
          const qMap: OptionMapping = optionMap[question.id];
          if (qMap && qMap.displayToOriginal) {
            const originalSelected = qMap.displayToOriginal[selectedAnswer.trim().toUpperCase()];
            if (originalSelected) {
              isCorrect = originalSelected.toUpperCase() === question.correctAnswer.trim().toUpperCase();
            } else {
              isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
            }
          } else {
            isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
          }
        } catch {
          isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
        }
      } else {
        isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
      }
    } else {
      isCorrect = selectedAnswer.trim().toUpperCase() === question.correctAnswer.trim().toUpperCase();
    }
  }

  const pointsAwarded = isCorrect ? question.points : 0;
  return { isCorrect, pointsAwarded };
}

// ─── Seeded 3x3 Sliding Puzzle Generator ─────────────────────────────────────
const SOLVED_PUZZLE_STATE = [1, 2, 3, 4, 5, 6, 7, 8, 0];

export function generateSeededPuzzleBoard(userId: string, challengeId: string, movesCount = 28): number[] {
  const seed = hashString(`${userId}_${challengeId}_puzzle`);
  const prng = createMulberry32(seed);

  const board = [...SOLVED_PUZZLE_STATE];
  let emptyIdx = 8;
  let lastMove = -1;

  for (let m = 0; m < movesCount; m++) {
    const row = Math.floor(emptyIdx / 3);
    const col = emptyIdx % 3;
    const neighbors: number[] = [];

    if (row > 0) neighbors.push(emptyIdx - 3); // Up
    if (row < 2) neighbors.push(emptyIdx + 3); // Down
    if (col > 0) neighbors.push(emptyIdx - 1); // Left
    if (col < 2) neighbors.push(emptyIdx + 1); // Right

    const validMoves = neighbors.filter((n) => n !== lastMove);
    const chosen = validMoves.length > 0
      ? validMoves[Math.floor(prng() * validMoves.length)]
      : neighbors[Math.floor(prng() * neighbors.length)];

    board[emptyIdx] = board[chosen];
    board[chosen] = 0;
    lastMove = emptyIdx;
    emptyIdx = chosen;
  }

  let isSolved = true;
  for (let i = 0; i < SOLVED_PUZZLE_STATE.length; i++) {
    if (board[i] !== SOLVED_PUZZLE_STATE[i]) {
      isSolved = false;
      break;
    }
  }

  if (isSolved) {
    const neighbors = [emptyIdx > 2 ? emptyIdx - 3 : emptyIdx + 3];
    const chosen = neighbors[0];
    board[emptyIdx] = board[chosen];
    board[chosen] = 0;
  }

  return board;
}

export type { EventType };

