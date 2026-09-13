import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting SASI Engineers Day idempotent database seed...');

  // 1. Safety Guard: Only reset competition data if explicit flag is passed
  if (process.env.RESET_COMPETITION_DATA === 'true') {
    console.warn('⚠️ RESET_COMPETITION_DATA=true detected. Purging previous test submissions and answers...');
    await prisma.answer.deleteMany();
    await prisma.puzzleSubmission.deleteMany();
    await prisma.quizQualification.deleteMany();
    await prisma.submission.deleteMany();
    await prisma.studentQuestionOrder.deleteMany();
    await prisma.quizQuestion.deleteMany();
    await prisma.quizChallenge.deleteMany();
    await prisma.debuggingProblem.deleteMany();
    await prisma.event.deleteMany();
    await prisma.themeSettings.deleteMany();
    console.log('✓ Cleaned previous competition activity.');
  } else {
    console.log('🔒 Production Safety Mode: Preserving all student accounts, submissions, and scores.');
  }

  // 2. Admin Account (Upsert)
  const adminHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { rollNo: 'ADMIN' },
    create: {
      rollNo: 'ADMIN',
      name: 'Administrator',
      passwordHash: adminHash,
      role: 'ADMIN',
    },
    update: {
      passwordHash: adminHash,
      role: 'ADMIN',
    },
  });
  console.log('✓ Admin verified: ADMIN / admin123');

  const studentCount = await prisma.user.count({ where: { role: 'STUDENT' } });
  console.log(`✓ Preserving ${studentCount} enrolled student accounts.`);

  // 3. Events (DEBUGGING & TECHNICAL_QUIZ)
  const now = new Date();
  const debugStart = new Date(now.getTime() - 10 * 60 * 1000);
  const debugEnd = new Date(now.getTime() + 110 * 60 * 1000);
  const quizStart = new Date(now.getTime());
  const quizEnd = new Date(now.getTime() + 120 * 60 * 1000);

  const debugEvent = await prisma.event.upsert({
    where: { type: 'DEBUGGING' },
    create: {
      type: 'DEBUGGING',
      name: 'Live C Debugging Arena',
      startTime: debugStart,
      endTime: debugEnd,
      status: 'READY',
      durationSeconds: 3600,
    },
    update: {
      name: 'Live C Debugging Arena',
      durationSeconds: 3600,
    },
  });
  console.log(`✓ Debugging Event: ${debugEvent.name} [${debugEvent.status}]`);

  const quizEvent = await prisma.event.upsert({
    where: { type: 'TECHNICAL_QUIZ' },
    create: {
      type: 'TECHNICAL_QUIZ',
      name: 'Technical Quiz Showdown',
      startTime: quizStart,
      endTime: quizEnd,
      status: 'READY',
      durationSeconds: 3600,
      currentRound: 1,
      round1Status: 'READY',
      round2Status: 'DRAFT',
      round1Duration: 1800,
      round2Duration: 1200,
      round1Weight: 0.4,
      round2Weight: 0.6,
      qualifierCount: 10,
      maxParticipants: 60,
    },
    update: {
      name: 'Technical Quiz Showdown',
      durationSeconds: 3600,
      round1Duration: 1800,
      round2Duration: 1200,
      qualifierCount: 10,
    },
  });
  console.log(`✓ Quiz Event: ${quizEvent.name} [${quizEvent.status}]`);

  // 4. Debugging Problems (Upsert by order)
  const debugProblems = [
    {
      title: 'Fix the Sum',
      description: 'The following C program is supposed to print the sum of two numbers (10 + 20 = 30), but it prints the wrong result. Fix the bug.',
      buggyCode: '#include <stdio.h>\\n\\nint main() {\\n    int a = 10;\\n    int b = 20;\\n    printf("%d\\\\n", a - b);\\n    return 0;\\n}',
      expectedOutput: '30',
      sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
      hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
      testCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
      points: 100,
      timeLimit: 2,
      order: 1,
    },
    {
      title: 'Fix the Loop Count',
      description: 'This program should print numbers 1 to 5 separated by spaces (1 2 3 4 5). Fix the loop termination condition.',
      buggyCode: '#include <stdio.h>\\n\\nint main() {\\n    for (int i = 1; i <= 10; i++) {\\n        printf("%d ", i);\\n    }\\n    printf("\\\\n");\\n    return 0;\\n}',
      expectedOutput: '1 2 3 4 5',
      sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
      hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
      testCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
      points: 100,
      timeLimit: 2,
      order: 2,
    },
    {
      title: 'Fix the Factorial',
      description: 'This program should compute the factorial of 5 (which is 120). Fix the accumulator and multiplication bug.',
      buggyCode: '#include <stdio.h>\\n\\nint main() {\\n    int n = 5, fact = 0;\\n    for(int i = 1; i <= n; i++) fact += i;\\n    printf("%d\\\\n", fact);\\n    return 0;\\n}',
      expectedOutput: '120',
      sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
      hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
      testCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
      points: 150,
      timeLimit: 2,
      order: 3,
    },
    {
      title: 'Reverse an Array in Place',
      description: 'The program should reverse the array elements in-place and output: 5 4 3 2 1. Fix the loop termination and swap offset bug.',
      buggyCode: '#include <stdio.h>\\n\\nvoid reverseArray(int arr[], int size) {\\n    for (int i = 0; i < size; i++) {\\n        int temp = arr[i];\\n        arr[i] = arr[size - 1];\\n        arr[size - 1] = temp;\\n    }\\n}\\n\\nint main() {\\n    int arr[] = {1, 2, 3, 4, 5};\\n    reverseArray(arr, 5);\\n    for(int i=0; i<5; i++) printf("%d ", arr[i]);\\n    printf("\\\\n");\\n    return 0;\\n}',
      expectedOutput: '5 4 3 2 1',
      sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
      hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
      testCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
      points: 150,
      timeLimit: 2,
      order: 4,
    },
    {
      title: 'Fix String Length Calculation',
      description: 'This program should calculate and output the length of string "SASI" which is 4. Fix the length offset bug.',
      buggyCode: '#include <stdio.h>\\n\\nint main() {\\n    char str[] = "SASI";\\n    int len = 0;\\n    while(str[len] != \'\\\\0\') len++;\\n    printf("%d\\\\n", len + 1);\\n    return 0;\\n}',
      expectedOutput: '4',
      sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
      hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
      testCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
      points: 200,
      timeLimit: 2,
      order: 5,
    },
  ];

  for (const p of debugProblems) {
    const existing = await prisma.debuggingProblem.findFirst({
      where: { eventId: debugEvent.id, order: p.order },
    });
    if (existing) {
      await prisma.debuggingProblem.update({
        where: { id: existing.id },
        data: p,
      });
    } else {
      await prisma.debuggingProblem.create({
        data: { ...p, eventId: debugEvent.id },
      });
    }
  }
  console.log('✓ 5 C Debugging problems seeded/updated');

  // 5. Quiz Challenges & Questions
  const challengesConfig = [
    { round: 1, type: 'RAPID_FIRE', title: '⚡ Rapid Fire', subtitle: 'Fast-paced Technology Trivia', description: 'Answer fast! Test your knowledge on AI, internet trends, gaming, and consumer tech.', order: 1, points: 100, timeLimit: 0, config: JSON.stringify({ category: 'Trivia' }) },
    { round: 1, type: 'GUESS_THE_TECH', title: '🔍 Guess the Tech', subtitle: 'Visual & Clue Identification', description: 'Identify iconic hardware, legendary founders, breakthrough AI models, and hidden tech easter eggs.', order: 2, points: 100, timeLimit: 0, config: JSON.stringify({ category: 'Visual Identification' }) },
    { round: 1, type: 'TECH_SHUFFLE', title: '🔀 Tech Shuffle', subtitle: 'Order & Sequence Challenge', description: 'Arrange technology milestones, product evolutions, and architecture flows in the correct sequence.', order: 3, points: 100, timeLimit: 0, config: JSON.stringify({ category: 'Sequencing' }) },
    { round: 1, type: 'PUZZLE_GRID', title: '🧩 Puzzle Grid', subtitle: '3×3 Sliding Tech Grid', description: 'Slide the tiles to assemble the high-tech processor image! Solvable within 1-2 minutes.', order: 4, points: 150, timeLimit: 180, config: JSON.stringify({ puzzleType: 'sliding-3x3', image: 'cyber-chip', title: 'Neural Quantum Processor', shuffleMoves: 28 }) },
    { round: 2, type: 'TECH_SHOWDOWN', title: '⚔️ Tech Showdown', subtitle: 'Championship Speed Round', description: 'High-stakes technology faceoff. Only the sharpest minds will conquer this round.', order: 1, points: 150, timeLimit: 0, config: JSON.stringify({ category: 'Advanced Tech' }) },
    { round: 2, type: 'TECH_TODAY', title: '📰 Tech Today', subtitle: 'Current Affairs & Breakthroughs', description: 'Questions from the latest 2024-2026 tech breakthroughs, space missions, and AI revolutions.', order: 2, points: 150, timeLimit: 0, config: JSON.stringify({ category: 'Current Affairs' }) },
    { round: 2, type: 'REAL_OR_FAKE', title: '🎭 Real or Fake', subtitle: 'Tech Truths vs AI Hallucinations', description: 'Can you spot true engineering marvels from cleverly disguised tech myths?', order: 3, points: 150, timeLimit: 0, config: JSON.stringify({ category: 'Fact or Fiction' }) },
    { round: 2, type: 'FINAL_CHALLENGE', title: '👑 Final Championship Challenge', subtitle: 'The Ultimate Tech Decider', description: 'The highest-value challenge that determines the SASI Engineers Day Tech Champion!', order: 4, points: 200, timeLimit: 0, config: JSON.stringify({ category: 'Grand Finale' }) },
  ];

  const challengeMap = new Map<string, string>();
  for (const c of challengesConfig) {
    let challenge = await prisma.quizChallenge.findFirst({
      where: { eventId: quizEvent.id, round: c.round, type: c.type },
    });
    if (challenge) {
      challenge = await prisma.quizChallenge.update({
        where: { id: challenge.id },
        data: c,
      });
    } else {
      challenge = await prisma.quizChallenge.create({
        data: { ...c, eventId: quizEvent.id },
      });
    }
    challengeMap.set(`${c.round}_${c.type}`, challenge.id);
  }
  console.log('✓ 8 Quiz Challenges seeded/updated across Round 1 & Round 2');

  // Sample questions seed
  const r1c1Id = challengeMap.get('1_RAPID_FIRE')!;
  const r2c4Id = challengeMap.get('2_FINAL_CHALLENGE')!;

  const sampleQuestions = [
    {
      eventId: quizEvent.id,
      challengeId: r1c1Id,
      round: 1,
      category: 'AI',
      type: 'MCQ',
      question: 'Which company developed the Gemini multimodal AI model and the Tensor Processing Unit (TPU)?',
      optionA: 'OpenAI',
      optionB: 'Google DeepMind',
      optionC: 'Meta AI',
      optionD: 'Anthropic',
      correctAnswer: 'B',
      explanation: 'Google DeepMind developed Gemini and designed the Tensor Processing Unit (TPU) custom ASICs for neural networks.',
      points: 15,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c1Id,
      round: 1,
      category: 'CYBERSECURITY',
      type: 'MCQ',
      question: 'What is the term for a cyber attack where attackers inject malicious commands into a website database via web input forms?',
      optionA: 'DDoS Attack',
      optionB: 'SQL Injection',
      optionC: 'Man-in-the-Middle',
      optionD: 'Phishing',
      correctAnswer: 'B',
      explanation: 'SQL Injection occurs when untrusted user input is directly concatenated into dynamic SQL statements.',
      points: 15,
      order: 2,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c4Id,
      round: 2,
      category: 'AI',
      type: 'MCQ',
      question: 'In 2016, DeepMind’s AlphaGo defeated 18-time world champion Lee Sedol in Go. What famous move in Game 2 shocked Go masters as a display of superhuman creativity?',
      optionA: 'Move 37',
      optionB: 'Move 78',
      optionC: 'Move 101',
      optionD: 'Move 42',
      correctAnswer: 'A',
      explanation: 'Move 37 was calculated as having a 1-in-10,000 chance of being played by a human master.',
      points: 50,
      order: 1,
    },
  ];

  for (const q of sampleQuestions) {
    const existing = await prisma.quizQuestion.findFirst({
      where: { eventId: quizEvent.id, challengeId: q.challengeId, order: q.order },
    });
    if (existing) {
      await prisma.quizQuestion.update({ where: { id: existing.id }, data: q });
    } else {
      await prisma.quizQuestion.create({ data: q });
    }
  }
  console.log('✓ Quiz Questions seeded/updated.');

  console.log('🎉 Seeding completed safely and idempotently.');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
