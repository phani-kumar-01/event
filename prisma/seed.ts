import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SASI Engineers Day database...');

  // Clear existing data in correct dependency order
  await prisma.answer.deleteMany();
  await prisma.puzzleSubmission.deleteMany();
  await prisma.quizQualification.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.quizQuestion.deleteMany();
  await prisma.quizChallenge.deleteMany();
  await prisma.debuggingProblem.deleteMany();
  await prisma.event.deleteMany();
  await prisma.themeSettings.deleteMany();
  await prisma.user.deleteMany();

  // ─── 1. Admin ───────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('admin123', 12);
  await prisma.user.create({
    data: {
      rollNo: 'ADMIN001',
      name: 'Competition Admin',
      passwordHash: adminHash,
      role: 'ADMIN',
    },
  });
  console.log('✅ Admin created: ADMIN001 / admin123');

  // ─── 2. 60 Students (CS001 .. CS060) ──────────────────────────────────
  const studentHash = await bcrypt.hash('student123', 12);
  const firstNames = [
    'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan',
    'Shaurya', 'Atharv', 'Advait', 'Pranav', 'Advaith', 'Kabir', 'Ananya', 'Diya', 'Gauri', 'Isha',
    'Kavya', 'Khushi', 'Mira', 'Navya', 'Pooja', 'Priya', 'Riya', 'Saanvi', 'Tanvi', 'Veda',
    'Rohan', 'Vikram', 'Ankit', 'Rahul', 'Nikhil', 'Karthik', 'Suresh', 'Manish', 'Deepak', 'Gautam',
    'Akash', 'Harish', 'Tarun', 'Abhishek', 'Varun', 'Yash', 'Siddharth', 'Neeraj', 'Sameer', 'Alok',
    'Sneha', 'Shreya', 'Divya', 'Meera', 'Roshni', 'Swati', 'Preeti', 'Swetha', 'Bhavna', 'Kritika',
  ];
  const lastNames = [
    'Kumar', 'Sharma', 'Verma', 'Iyer', 'Reddy', 'Rao', 'Patel', 'Mehta', 'Nair', 'Gupta',
    'Singh', 'Chowdary', 'Das', 'Joshi', 'Bhat', 'Menon', 'Kulkarni', 'Deshmukh', 'Saxena', 'Pillai',
  ];

  const studentRecords = [];
  for (let i = 1; i <= 60; i++) {
    const pad = String(i).padStart(3, '0');
    const rollNo = `CS${pad}`;
    const name = `${firstNames[(i - 1) % firstNames.length]} ${lastNames[(i - 1) % lastNames.length]}`;
    studentRecords.push({
      rollNo,
      name,
      passwordHash: studentHash,
      role: 'STUDENT',
    });
  }

  for (const s of studentRecords) {
    await prisma.user.create({ data: s });
  }
  console.log('✅ 60 Participants created: CS001 to CS060 (password: student123)');

  // ─── 3. Events (DEBUGGING & TECHNICAL_QUIZ) ───────────────────────────
  const now = new Date();
  const debugStart = new Date(now.getTime() - 10 * 60 * 1000);
  const debugEnd = new Date(now.getTime() + 50 * 60 * 1000);

  const quizStart = new Date(now.getTime());
  const quizEnd = new Date(now.getTime() + 60 * 60 * 1000);

  const debugEvent = await prisma.event.create({
    data: {
      type: 'DEBUGGING',
      name: 'Live C Debugging Arena',
      startTime: debugStart,
      endTime: debugEnd,
      status: 'READY',
      durationSeconds: 3600,
    },
  });

  const quizEvent = await prisma.event.create({
    data: {
      type: 'TECHNICAL_QUIZ',
      name: 'Technical Quiz Showdown',
      startTime: quizStart,
      endTime: quizEnd,
      status: 'READY',
      durationSeconds: 3600,
      currentRound: 1,
      round1Status: 'READY',
      round2Status: 'DRAFT',
      round1Duration: 1800, // 30 mins
      round2Duration: 1200, // 20 mins
      round1Weight: 0.4,
      round2Weight: 0.6,
      qualifierCount: 10,
      maxParticipants: 60,
    },
  });
  console.log('✅ Events created: DEBUGGING and TECHNICAL_QUIZ');

  // ─── 4. Debugging Problems ────────────────────────────────────────────
  const debugProblems = [
    {
      title: 'Fix the Sum',
      description: 'The following C program is supposed to print the sum of two numbers (10 + 20 = 30), but it prints the wrong result. Fix the bug.',
      buggyCode: `#include <stdio.h>\n\nint main() {\n    int a = 10;\n    int b = 20;\n\n    printf("%d\\n", a - b);\n    return 0;\n}`,
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
      buggyCode: `#include <stdio.h>\n\nint main() {\n    for (int i = 1; i <= 10; i++) {\n        printf("%d ", i);\n    }\n    printf("\\n");\n    return 0;\n}`,
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
      buggyCode: `#include <stdio.h>\n\nint main() {\n    int n = 5, fact = 0;\n    for(int i = 1; i <= n; i++) fact += i;\n    printf("%d\\n", fact);\n    return 0;\n}`,
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
      buggyCode: `#include <stdio.h>\n\nvoid reverseArray(int arr[], int size) {\n    for (int i = 0; i < size; i++) {\n        int temp = arr[i];\n        arr[i] = arr[size - 1];\n        arr[size - 1] = temp;\n    }\n}\n\nint main() {\n    int arr[] = {1, 2, 3, 4, 5};\n    reverseArray(arr, 5);\n    for(int i=0; i<5; i++) printf("%d ", arr[i]);\n    printf("\\n");\n    return 0;\n}`,
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
      buggyCode: `#include <stdio.h>\n\nint main() {\n    char str[] = "SASI";\n    int len = 0;\n    while(str[len] != '\\0') len++;\n    printf("%d\\n", len + 1);\n    return 0;\n}`,
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
    await prisma.debuggingProblem.create({
      data: { ...p, eventId: debugEvent.id },
    });
  }
  console.log('✅ 5 Debugging problems created');

  // ─── 5. Technical Quiz Challenges & Questions ────────────────────────

  // ───────── ROUND 1 CHALLENGES ─────────
  // Challenge 1.1: Rapid Fire
  const r1c1 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 1,
      type: 'RAPID_FIRE',
      title: '⚡ Rapid Fire',
      subtitle: 'Fast-paced Technology Trivia',
      description: 'Answer fast! Test your knowledge on AI, internet trends, gaming, and consumer tech.',
      order: 1,
      points: 100,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Trivia' }),
    },
  });

  // Challenge 1.2: Guess the Tech
  const r1c2 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 1,
      type: 'GUESS_THE_TECH',
      title: '🔍 Guess the Tech',
      subtitle: 'Visual & Clue Identification',
      description: 'Identify iconic hardware, legendary founders, breakthrough AI models, and hidden tech easter eggs.',
      order: 2,
      points: 100,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Visual Identification' }),
    },
  });

  // Challenge 1.3: Tech Shuffle
  const r1c3 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 1,
      type: 'TECH_SHUFFLE',
      title: '🔀 Tech Shuffle',
      subtitle: 'Order & Sequence Challenge',
      description: 'Arrange technology milestones, product evolutions, and architecture flows in the correct sequence.',
      order: 3,
      points: 100,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Sequencing' }),
    },
  });

  // Challenge 1.4: Puzzle Grid (3x3 Sliding Puzzle)
  const r1c4 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 1,
      type: 'PUZZLE_GRID',
      title: '🧩 Puzzle Grid',
      subtitle: '3×3 Sliding Tech Grid',
      description: 'Slide the tiles to assemble the high-tech processor image! Solvable within 1-2 minutes.',
      order: 4,
      points: 150,
      timeLimit: 180,
      config: JSON.stringify({
        puzzleType: 'sliding-3x3',
        image: 'cyber-chip',
        title: 'Neural Quantum Processor',
        shuffleMoves: 28,
      }),
    },
  });

  // ───────── ROUND 2 CHALLENGES (Top 10 Qualifiers) ─────────
  // Challenge 2.1: Tech Showdown
  const r2c1 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 2,
      type: 'TECH_SHOWDOWN',
      title: '⚔️ Tech Showdown',
      subtitle: 'Championship Speed Round',
      description: 'High-stakes technology faceoff. Only the sharpest minds will conquer this round.',
      order: 1,
      points: 150,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Advanced Tech' }),
    },
  });

  // Challenge 2.2: Tech Today
  const r2c2 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 2,
      type: 'TECH_TODAY',
      title: '📰 Tech Today',
      subtitle: 'Current Affairs & Breakthroughs',
      description: 'Questions from the latest 2024-2026 tech breakthroughs, space missions, and AI revolutions.',
      order: 2,
      points: 150,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Current Affairs' }),
    },
  });

  // Challenge 2.3: Real or Fake
  const r2c3 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 2,
      type: 'REAL_OR_FAKE',
      title: '🎭 Real or Fake',
      subtitle: 'Tech Truths vs AI Hallucinations',
      description: 'Can you spot true engineering marvels from cleverly disguised tech myths?',
      order: 3,
      points: 150,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Fact or Fiction' }),
    },
  });

  // Challenge 2.4: Final Challenge
  const r2c4 = await prisma.quizChallenge.create({
    data: {
      eventId: quizEvent.id,
      round: 2,
      type: 'FINAL_CHALLENGE',
      title: '👑 Final Championship Challenge',
      subtitle: 'The Ultimate Tech Decider',
      description: 'The highest-value challenge that determines the SASI Engineers Day Tech Champion!',
      order: 4,
      points: 200,
      timeLimit: 0,
      config: JSON.stringify({ category: 'Grand Finale' }),
    },
  });

  console.log('✅ 8 Challenges created across Round 1 & Round 2');

  // ─── 6. Questions for Round 1 & Round 2 ───────────────────────────────
  const questionsData: Array<{
    eventId: string;
    challengeId: string;
    round: number;
    category: string;
    type: string;
    question: string;
    imageUrl?: string;
    optionA: string;
    optionB: string;
    optionC: string;
    optionD: string;
    correctAnswer: string;
    explanation: string;
    points: number;
    order: number;
  }> = [
    // ─── ROUND 1: RAPID FIRE ───
    {
      eventId: quizEvent.id,
      challengeId: r1c1.id,
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
      challengeId: r1c1.id,
      round: 1,
      category: 'GADGETS',
      type: 'MCQ',
      question: 'In 2007, Steve Jobs unveiled the original iPhone by describing it as three revolutionary devices in one. Which was NOT one of them?',
      optionA: 'A widescreen iPod with touch controls',
      optionB: 'A revolutionary mobile phone',
      optionC: 'A breakthrough internet communicator',
      optionD: 'A handheld video gaming console',
      correctAnswer: 'D',
      explanation: 'Steve Jobs stated: "an iPod, a phone, and an internet communicator... these are not three separate devices, this is one device, and we are calling it iPhone."',
      points: 15,
      order: 2,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c1.id,
      round: 1,
      category: 'CYBERSECURITY',
      type: 'MCQ',
      question: 'What is the term for a cyber attack where attackers inject malicious commands into a website database via web input forms?',
      optionA: 'DDoS Attack',
      optionB: 'SQL Injection',
      optionC: 'Man-in-the-Middle',
      optionD: 'Zero-day Exploit',
      correctAnswer: 'B',
      explanation: 'SQL Injection (SQLi) manipulates SQL queries by inserting untrusted input directly into database commands.',
      points: 15,
      order: 3,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c1.id,
      round: 1,
      category: 'GAMING',
      type: 'MCQ',
      question: 'Which game engine, created by Epic Games, powers Fortnite, The Matrix Awakens demo, and numerous Hollywood film sets via virtual production?',
      optionA: 'Unity 3D',
      optionB: 'Unreal Engine 5',
      optionC: 'Godot Engine',
      optionD: 'CryEngine',
      correctAnswer: 'B',
      explanation: 'Unreal Engine 5 features Nanite and Lumen, and is widely adopted across gaming and cinematic production.',
      points: 15,
      order: 4,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c1.id,
      round: 1,
      category: 'SPACE',
      type: 'MCQ',
      question: 'What is the name of SpaceX’s massive satellite constellation designed to provide high-speed, low-latency global broadband internet?',
      optionA: 'Kuiper',
      optionB: 'Starlink',
      optionC: 'OneWeb',
      optionD: 'Oneworld',
      correctAnswer: 'B',
      explanation: 'Starlink operates thousands of low-Earth orbit (LEO) satellites to beam broadband internet worldwide.',
      points: 15,
      order: 5,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c1.id,
      round: 1,
      category: 'FOUNDERS',
      type: 'MCQ',
      question: 'Who created the Linux operating system kernel while studying at the University of Helsinki in 1991?',
      optionA: 'Linus Torvalds',
      optionB: 'Richard Stallman',
      optionC: 'Ken Thompson',
      optionD: 'Dennis Ritchie',
      correctAnswer: 'A',
      explanation: 'Linus Torvalds posted his famous "just a hobby, won\'t be big and professional" message introducing Linux in August 1991.',
      points: 15,
      order: 6,
    },

    // ─── ROUND 1: GUESS THE TECH ───
    {
      eventId: quizEvent.id,
      challengeId: r1c2.id,
      round: 1,
      category: 'FOUNDERS',
      type: 'MCQ',
      question: 'Clue: Founded in 1993 by Jensen Huang, Chris Malachowsky, and Curtis Priem. Its CUDA architecture powers modern AI training worldwide. Which company is it?',
      optionA: 'Intel Corporation',
      optionB: 'NVIDIA',
      optionC: 'Qualcomm',
      optionD: 'Advanced Micro Devices (AMD)',
      correctAnswer: 'B',
      explanation: 'NVIDIA started with gaming GPUs (RIVA 128, GeForce) and pioneered general-purpose GPU computing with CUDA in 2006.',
      points: 20,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c2.id,
      round: 1,
      category: 'FOUNDERS',
      type: 'MCQ',
      question: 'Clue: First launched in 2008 on the HTC Dream (T-Mobile G1), its versions were historically named after desserts (Cupcake, Donut, Froyo, KitKat). What is this OS?',
      optionA: 'Symbian OS',
      optionB: 'Android OS',
      optionC: 'BlackBerry OS',
      optionD: 'Windows Phone',
      correctAnswer: 'B',
      explanation: 'Android was founded by Andy Rubin, acquired by Google in 2005, and debuted commercially on the HTC Dream in 2008.',
      points: 20,
      order: 2,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c2.id,
      round: 1,
      category: 'GADGETS',
      type: 'MCQ',
      question: 'Clue: A single-board computer originally designed in the UK to teach basic computer science in schools, selling over 40 million units. What is it?',
      optionA: 'Arduino Uno',
      optionB: 'Raspberry Pi',
      optionC: 'ESP32',
      optionD: 'BeagleBone Black',
      correctAnswer: 'B',
      explanation: 'The Raspberry Pi was released in 2012 by the Raspberry Pi Foundation and sparked a revolution in DIY electronics.',
      points: 20,
      order: 3,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c2.id,
      round: 1,
      category: 'FOUNDERS',
      type: 'MCQ',
      question: 'Clue: Created by Brendan Eich at Netscape in just 10 days in May 1995 under the initial code name "Mocha". What language is this?',
      optionA: 'Java',
      optionB: 'JavaScript',
      optionC: 'PHP',
      optionD: 'Python',
      correctAnswer: 'B',
      explanation: 'JavaScript was created by Brendan Eich in 10 days for Netscape Navigator 2.0 and became the foundation of the modern web.',
      points: 20,
      order: 4,
    },

    // ─── ROUND 1: TECH SHUFFLE ───
    {
      eventId: quizEvent.id,
      challengeId: r1c3.id,
      round: 1,
      category: 'FOUNDERS',
      type: 'SHUFFLE_ORDER',
      question: 'Arrange these historic computing milestones from EARLIEST to MOST RECENT:',
      optionA: '1. Launch of the World Wide Web (CERN)',
      optionB: '2. Introduction of the original Apple iPhone',
      optionC: '3. Release of ChatGPT (Generative AI boom)',
      optionD: '4. First message sent over ARPANET',
      correctAnswer: '["4. First message sent over ARPANET","1. Launch of the World Wide Web (CERN)","2. Introduction of the original Apple iPhone","3. Release of ChatGPT (Generative AI boom)"]',
      explanation: 'ARPANET (1969) → World Wide Web (1991) → iPhone (2007) → ChatGPT (2022).',
      points: 30,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r1c3.id,
      round: 1,
      category: 'CYBERSECURITY',
      type: 'SHUFFLE_ORDER',
      question: 'Arrange the sequence of a standard TLS/HTTPS Handshake connection from START to FINISH:',
      optionA: '1. Client Hello (supported ciphers & random number)',
      optionB: '2. Server Hello & Digital Certificate with Public Key',
      optionC: '3. Key Exchange & Premaster Secret generation',
      optionD: '4. Encrypted Symmetric Session established',
      correctAnswer: '["1. Client Hello (supported ciphers & random number)","2. Server Hello & Digital Certificate with Public Key","3. Key Exchange & Premaster Secret generation","4. Encrypted Symmetric Session established"]',
      explanation: 'Client Hello → Server Hello & Certificate → Premaster Key Exchange → Encrypted Symmetric Session.',
      points: 30,
      order: 2,
    },

    // ─── ROUND 2: TECH SHOWDOWN ───
    {
      eventId: quizEvent.id,
      challengeId: r2c1.id,
      round: 2,
      category: 'AI',
      type: 'MCQ',
      question: 'What revolutionary deep learning architecture, introduced in Google’s 2017 paper "Attention Is All You Need", replaced RNNs and powers all modern LLMs?',
      optionA: 'Convolutional Neural Network (CNN)',
      optionB: 'Transformer',
      optionC: 'Generative Adversarial Network (GAN)',
      optionD: 'Capsule Network',
      correctAnswer: 'B',
      explanation: 'The Transformer architecture with multi-head self-attention mechanisms became the cornerstone of modern large language models.',
      points: 25,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c1.id,
      round: 2,
      category: 'AI',
      type: 'MCQ',
      question: 'In quantum computing, what property allows qubits to be in a linear combination of both |0⟩ and |1⟩ states simultaneously?',
      optionA: 'Quantum Tunneling',
      optionB: 'Superposition',
      optionC: 'Entanglement',
      optionD: 'Decoherence',
      correctAnswer: 'B',
      explanation: 'Superposition allows a qubit to exist in a state that is a probabilistic combination of basis states |0⟩ and |1⟩ until measured.',
      points: 25,
      order: 2,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c1.id,
      round: 2,
      category: 'GADGETS',
      type: 'MCQ',
      question: 'Which semiconductor manufacturing company based in Hsinchu, Taiwan produces over 90% of the world\'s most advanced sub-5nm microchips?',
      optionA: 'GlobalFoundries',
      optionB: 'TSMC (Taiwan Semiconductor Manufacturing Co.)',
      optionC: 'Samsung Foundry',
      optionD: 'Semiconductor Manufacturing International Corp (SMIC)',
      correctAnswer: 'B',
      explanation: 'TSMC manufactures chips for Apple, NVIDIA, AMD, Qualcomm, and MediaTek using cutting-edge EUV lithography.',
      points: 25,
      order: 3,
    },

    // ─── ROUND 2: TECH TODAY ───
    {
      eventId: quizEvent.id,
      challengeId: r2c2.id,
      round: 2,
      category: 'SPACE',
      type: 'MCQ',
      question: 'In October 2024, SpaceX achieved a historic aerospace milestone with Starship Flight 5 by doing what unprecedented maneuver?',
      optionA: 'Landing Starship on the surface of Mars autonomously',
      optionB: 'Catching the Super Heavy booster mid-air with launch tower mechanical arms ("chopsticks")',
      optionC: 'Refueling Starship in low-Earth orbit with cryogenic propellant transfer',
      optionD: 'Deploying 100 satellites in a single suborbital burn',
      correctAnswer: 'B',
      explanation: 'SpaceX successfully returned the 71-meter Super Heavy booster and caught it out of the air using the launch tower\'s mechanical "chopsticks".',
      points: 30,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c2.id,
      round: 2,
      category: 'AI',
      type: 'MCQ',
      question: 'What is the benchmark technique called where reasoning models generate hidden "Chain-of-Thought" tokens before generating their final answer to solve complex logic?',
      optionA: 'Inference-time Compute / System 2 Reasoning',
      optionB: 'Zero-shot Prompting',
      optionC: 'Data Distillation',
      optionD: 'Vector Embedding Search',
      correctAnswer: 'A',
      explanation: 'Reasoning models allocate extra computation at inference time to deliberate and plan their answers step-by-step.',
      points: 30,
      order: 2,
    },

    // ─── ROUND 2: REAL OR FAKE ───
    {
      eventId: quizEvent.id,
      challengeId: r2c3.id,
      round: 2,
      category: 'FOUNDERS',
      type: 'REAL_OR_FAKE',
      question: 'In 1986, Apple released a full fashion clothing line including pastel sweatshirts, windbreakers, and graphic t-shirts called "The Apple Collection".',
      optionA: 'REAL',
      optionB: 'FAKE',
      optionC: '',
      optionD: '',
      correctAnswer: 'REAL',
      explanation: 'REAL! Following Steve Jobs’s temporary departure in 1985, Apple launched a 1986 clothing catalog featuring Apple-branded apparel, watches, and surfboards.',
      points: 20,
      order: 1,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c3.id,
      round: 2,
      category: 'GADGETS',
      type: 'REAL_OR_FAKE',
      question: 'The first computer mouse invented by Douglas Engelbart in 1964 was carved out of solid titanium and used an optical laser.',
      optionA: 'REAL',
      optionB: 'FAKE',
      optionC: '',
      optionD: '',
      correctAnswer: 'FAKE',
      explanation: 'FAKE! The first computer mouse was made of a hollowed-out block of wood with two perpendicular metal wheels inside.',
      points: 20,
      order: 2,
    },
    {
      eventId: quizEvent.id,
      challengeId: r2c3.id,
      round: 2,
      category: 'CYBERSECURITY',
      type: 'REAL_OR_FAKE',
      question: 'Over 99% of all international internet data traffic travels through undersea fiber-optic submarine cables rather than satellites.',
      optionA: 'REAL',
      optionB: 'FAKE',
      optionC: '',
      optionD: '',
      correctAnswer: 'REAL',
      explanation: 'REAL! Submarine fiber-optic cables crisscross ocean floors carrying virtually all transoceanic internet communications with massive bandwidth.',
      points: 20,
      order: 3,
    },

    // ─── ROUND 2: FINAL CHAMPIONSHIP CHALLENGE ───
    {
      eventId: quizEvent.id,
      challengeId: r2c4.id,
      round: 2,
      category: 'AI',
      type: 'MCQ',
      question: 'In 1997, IBM’s Deep Blue defeated Garry Kasparov in chess. In 2016, DeepMind’s AlphaGo defeated 18-time world champion Lee Sedol in Go. What famous move in Game 2 shocked Go masters as a display of superhuman creativity?',
      optionA: 'Move 37',
      optionB: 'Move 78',
      optionC: 'Move 101',
      optionD: 'Move 42',
      correctAnswer: 'A',
      explanation: 'Move 37 was calculated as having a 1-in-10,000 chance of being played by a human master, proving the AI had developed original strategic intuition.',
      points: 50,
      order: 1,
    },
  ];

  for (const q of questionsData) {
    await prisma.quizQuestion.create({ data: q });
  }
  console.log(`✅ ${questionsData.length} questions created across all challenges`);

  console.log('🏁 Seeding finished successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
