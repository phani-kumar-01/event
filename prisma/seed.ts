import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding SASI Engineers Day database...');

  // Clear existing data
  await prisma.answer.deleteMany();
  await prisma.submission.deleteMany();
  await prisma.quizQuestion.deleteMany();
  await prisma.debuggingProblem.deleteMany();
  await prisma.event.deleteMany();
  await prisma.themeSettings.deleteMany();
  await prisma.user.deleteMany();

  // ─── Admin ───────────────────────────────────────────────────────────
  const adminHash = await bcrypt.hash('admin123', 12);
  await prisma.user.create({
    data: {
      rollNo: 'ADMIN001',
      name: 'Administrator',
      passwordHash: adminHash,
      role: 'ADMIN',
    },
  });
  console.log('✅ Admin created: ADMIN001 / admin123');

  // ─── Students ────────────────────────────────────────────────────────
  const studentHash = await bcrypt.hash('student123', 12);
  const students = [
    'CS001', 'CS002', 'CS003', 'CS004', 'CS005',
    'ME001', 'ME002', 'EC001', 'EC002', 'IT001',
  ];
  const studentNames = [
    'Arjun Kumar', 'Priya Sharma', 'Rahul Verma', 'Neha Iyer', 'Vikram Das',
    'Sunita Patel', 'Karan Mehta', 'Ankit Singh', 'Divya Nair', 'Rohan Gupta',
  ];
  for (let i = 0; i < students.length; i++) {
    await prisma.user.create({
      data: {
        rollNo: students[i],
        name: studentNames[i],
        passwordHash: studentHash,
        role: 'STUDENT',
      },
    });
  }
  console.log('✅ 10 demo students created (password: student123)');

  // ─── Events ──────────────────────────────────────────────────────────
  // Use today's date for realistic timing
  const today = new Date();
  const debugStart = new Date(today);
  debugStart.setHours(10, 0, 0, 0);
  const debugEnd = new Date(today);
  debugEnd.setHours(11, 0, 0, 0);

  const quizStart = new Date(today);
  quizStart.setHours(11, 0, 0, 0);
  const quizEnd = new Date(today);
  quizEnd.setHours(12, 0, 0, 0);

  const debugEvent = await prisma.event.create({
    data: {
      type: 'DEBUGGING',
      name: 'C Debugging Competition',
      startTime: debugStart,
      endTime: debugEnd,
      status: 'READY',
      durationSeconds: 3600,
    },
  });

  const quizEvent = await prisma.event.create({
    data: {
      type: 'TECHNICAL_QUIZ',
      name: 'Technical Quiz',
      startTime: quizStart,
      endTime: quizEnd,
      status: 'READY',
      durationSeconds: 3600,
    },
  });
  console.log('✅ Events created');

  // ─── Debugging Problems ───────────────────────────────────────────────
  const debugProblems = [
    {
      title: 'Fix the Sum',
      description:
        'The following C program is supposed to print the sum of two numbers (10 + 20 = 30), but it prints the wrong result. Fix the bug.',
      buggyCode: `#include <stdio.h>

int main() {
    int a = 10;
    int b = 20;

    printf("%d\\n", a - b);

    return 0;
}`,
      expectedOutput: '30',
      testCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
      points: 100,
      timeLimit: 5,
      order: 1,
    },
    {
      title: 'Fix the Loop',
      description:
        'This program should print numbers 1 to 10, each on a new line. Find and fix the bug.',
      buggyCode: `#include <stdio.h>

int main() {
    int i;
    for (i = 0; i <= 10; i++) {
        printf("%d\\n", i);
    }
    return 0;
}`,
      expectedOutput: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10',
      testCases: JSON.stringify([{ input: '', expectedOutput: '1\n2\n3\n4\n5\n6\n7\n8\n9\n10' }]),
      points: 100,
      timeLimit: 5,
      order: 2,
    },
    {
      title: 'Fix the Factorial',
      description:
        'This program should compute the factorial of 5 (which is 120). Fix the bug in the factorial function.',
      buggyCode: `#include <stdio.h>

int factorial(int n) {
    if (n == 0) return 0;
    return n * factorial(n - 1);
}

int main() {
    printf("%d\\n", factorial(5));
    return 0;
}`,
      expectedOutput: '120',
      testCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
      points: 150,
      timeLimit: 5,
      order: 3,
    },
    {
      title: 'Fix the Array Reverse',
      description:
        'The program should print the array [5, 4, 3, 2, 1] (reversed from [1,2,3,4,5]). Find and fix the bug.',
      buggyCode: `#include <stdio.h>

int main() {
    int arr[] = {1, 2, 3, 4, 5};
    int n = 5;
    int i, j, temp;

    for (i = 0, j = n - 1; i < j; i++, j--) {
        temp = arr[i];
        arr[i] = arr[j];
        arr[i] = temp;
    }

    for (i = 0; i < n; i++) {
        printf("%d ", arr[i]);
    }
    printf("\\n");
    return 0;
}`,
      expectedOutput: '5 4 3 2 1 ',
      testCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1 ' }]),
      points: 150,
      timeLimit: 5,
      order: 4,
    },
    {
      title: 'Fix the String Length',
      description:
        'This program should print the length of the string "SASI" which is 4. Fix the bug in the string length calculation.',
      buggyCode: `#include <stdio.h>

int strLen(char *s) {
    int count = 0;
    while (*s != '\\0') {
        count++;
        s++;
    }
    return count + 1;
}

int main() {
    char str[] = "SASI";
    printf("%d\\n", strLen(str));
    return 0;
}`,
      expectedOutput: '4',
      testCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
      points: 200,
      timeLimit: 5,
      order: 5,
    },
  ];

  for (const p of debugProblems) {
    await prisma.debuggingProblem.create({
      data: { ...p, eventId: debugEvent.id },
    });
  }
  console.log('✅ 5 Debugging problems created');

  // ─── Quiz Questions ───────────────────────────────────────────────────
  const quizQuestions = [
    {
      question: 'What does CPU stand for?',
      optionA: 'Central Processing Unit',
      optionB: 'Computer Processing Unit',
      optionC: 'Central Program Unit',
      optionD: 'Core Processing Unit',
      correctAnswer: 'A',
      explanation: 'CPU stands for Central Processing Unit, the primary component of a computer that executes instructions.',
      points: 10,
      order: 1,
    },
    {
      question: 'Which of the following is NOT a programming language?',
      optionA: 'Python',
      optionB: 'HTML',
      optionC: 'Java',
      optionD: 'C++',
      correctAnswer: 'B',
      explanation: 'HTML (HyperText Markup Language) is a markup language, not a programming language.',
      points: 10,
      order: 2,
    },
    {
      question: 'What is the time complexity of binary search?',
      optionA: 'O(n)',
      optionB: 'O(n²)',
      optionC: 'O(log n)',
      optionD: 'O(1)',
      correctAnswer: 'C',
      explanation: 'Binary search has O(log n) time complexity as it halves the search space each iteration.',
      points: 15,
      order: 3,
    },
    {
      question: 'Which data structure uses LIFO (Last In, First Out) order?',
      optionA: 'Queue',
      optionB: 'Stack',
      optionC: 'Array',
      optionD: 'Linked List',
      correctAnswer: 'B',
      explanation: 'A Stack follows LIFO order — the last element pushed is the first one popped.',
      points: 10,
      order: 4,
    },
    {
      question: 'In C, what does the keyword "static" mean when applied to a local variable?',
      optionA: 'The variable cannot be changed',
      optionB: 'The variable is shared across all functions',
      optionC: 'The variable retains its value between function calls',
      optionD: 'The variable is stored in heap memory',
      correctAnswer: 'C',
      explanation: 'A static local variable retains its value between function calls instead of being reset.',
      points: 15,
      order: 5,
    },
    {
      question: 'What is the output of: printf("%d", 5 & 3); in C?',
      optionA: '8',
      optionB: '1',
      optionC: '15',
      optionD: '5',
      correctAnswer: 'B',
      explanation: '5 in binary is 101, 3 is 011. Bitwise AND gives 001 which equals 1.',
      points: 20,
      order: 6,
    },
    {
      question: 'Which OSI layer handles routing of packets?',
      optionA: 'Data Link Layer',
      optionB: 'Transport Layer',
      optionC: 'Network Layer',
      optionD: 'Session Layer',
      correctAnswer: 'C',
      explanation: 'The Network Layer (Layer 3) handles logical addressing and routing of packets between networks.',
      points: 15,
      order: 7,
    },
    {
      question: 'What does RAM stand for?',
      optionA: 'Read Access Memory',
      optionB: 'Random Access Memory',
      optionC: 'Rapid Application Memory',
      optionD: 'Read-only Application Memory',
      correctAnswer: 'B',
      explanation: 'RAM stands for Random Access Memory, the primary volatile memory in a computer.',
      points: 10,
      order: 8,
    },
    {
      question: 'In SQL, which command is used to retrieve data from a table?',
      optionA: 'GET',
      optionB: 'FETCH',
      optionC: 'SELECT',
      optionD: 'RETRIEVE',
      correctAnswer: 'C',
      explanation: 'The SELECT statement is used to retrieve data from one or more tables in SQL.',
      points: 10,
      order: 9,
    },
    {
      question: 'Which sorting algorithm has the best average-case time complexity?',
      optionA: 'Bubble Sort',
      optionB: 'Selection Sort',
      optionC: 'Merge Sort',
      optionD: 'Insertion Sort',
      correctAnswer: 'C',
      explanation: 'Merge Sort has O(n log n) average-case complexity, making it one of the most efficient comparison sorts.',
      points: 20,
      order: 10,
    },
  ];

  for (const q of quizQuestions) {
    await prisma.quizQuestion.create({
      data: { ...q, eventId: quizEvent.id },
    });
  }
  console.log('✅ 10 Quiz questions created');

  // ─── Theme ────────────────────────────────────────────────────────────
  await prisma.themeSettings.create({
    data: {
      name: 'SASI Institutional',
      primaryColor: '#8B0000',
      secondaryColor: '#650000',
      accentColor: '#F5A623',
      backgroundColor: '#F7F7F7',
      surfaceColor: '#FFFFFF',
      textColor: '#222222',
      isActive: true,
      version: 1,
    },
  });
  console.log('✅ Default theme created');

  console.log('\n🎉 Database seeded successfully!');
  console.log('\nAdmin login: ADMIN001 / admin123');
  console.log('Student login: CS001 / student123  (or CS002, CS003, ME001, EC001)');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
