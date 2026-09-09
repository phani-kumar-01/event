const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const debuggingProblems = [
  {
    order: 1,
    title: 'Fix the Sum',
    description: 'The following C program is supposed to print the sum of two numbers (10 + 20 = 30), but it prints the wrong result. Fix the bug.',
    buggyCode: `#include <stdio.h>\n\nint main() {\n    int a = 10;\n    int b = 20;\n    printf("%d\\n", a - b);\n    return 0;\n}`,
    expectedOutput: '30',
    sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
    hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
    testCases: JSON.stringify([{ input: '', expectedOutput: '30' }]),
    points: 100,
    timeLimit: 2,
  },
  {
    order: 2,
    title: 'Fix the Loop Count',
    description: 'This program should print numbers 1 to 5 separated by spaces (1 2 3 4 5). Fix the loop termination condition.',
    buggyCode: `#include <stdio.h>\n\nint main() {\n    for (int i = 1; i <= 10; i++) {\n        printf("%d ", i);\n    }\n    printf("\\n");\n    return 0;\n}`,
    expectedOutput: '1 2 3 4 5',
    sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
    hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
    testCases: JSON.stringify([{ input: '', expectedOutput: '1 2 3 4 5' }]),
    points: 100,
    timeLimit: 2,
  },
  {
    order: 3,
    title: 'Fix the Factorial',
    description: 'This program should compute the factorial of 5 (which is 120). Fix the accumulator and multiplication bug.',
    buggyCode: `#include <stdio.h>\n\nint main() {\n    int n = 5, fact = 0;\n    for(int i = 1; i <= n; i++) fact += i;\n    printf("%d\\n", fact);\n    return 0;\n}`,
    expectedOutput: '120',
    sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
    hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
    testCases: JSON.stringify([{ input: '', expectedOutput: '120' }]),
    points: 150,
    timeLimit: 2,
  },
  {
    order: 4,
    title: 'Reverse an Array in Place',
    description: 'The program should reverse the array elements in-place and output: 5 4 3 2 1. Fix the loop termination and swap offset bug.',
    buggyCode: `#include <stdio.h>\n\nvoid reverseArray(int arr[], int size) {\n    for (int i = 0; i < size; i++) {\n        int temp = arr[i];\n        arr[i] = arr[size - 1];\n        arr[size - 1] = temp;\n    }\n}\n\nint main() {\n    int arr[] = {1, 2, 3, 4, 5};\n    reverseArray(arr, 5);\n    for(int i=0; i<5; i++) printf("%d ", arr[i]);\n    printf("\\n");\n    return 0;\n}`,
    expectedOutput: '5 4 3 2 1',
    sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
    hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
    testCases: JSON.stringify([{ input: '', expectedOutput: '5 4 3 2 1' }]),
    points: 150,
    timeLimit: 2,
  },
  {
    order: 5,
    title: 'Fix String Length Calculation',
    description: 'This program should calculate and output the length of string "SASI" which is 4. Fix the length offset bug.',
    buggyCode: `#include <stdio.h>\n\nint main() {\n    char str[] = "SASI";\n    int len = 0;\n    while(str[len] != '\\0') len++;\n    printf("%d\\n", len + 1);\n    return 0;\n}`,
    expectedOutput: '4',
    sampleTestCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
    hiddenTestCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
    testCases: JSON.stringify([{ input: '', expectedOutput: '4' }]),
    points: 200,
    timeLimit: 2,
  },
];

async function seedDebugging() {
  console.log('⚡ Populating C Debugging Arena initial problems...');

  // Find or create the active DEBUGGING event
  let debugEvent = await prisma.event.findFirst({
    where: { type: 'DEBUGGING' },
  });

  if (!debugEvent) {
    const now = new Date();
    debugEvent = await prisma.event.create({
      data: {
        type: 'DEBUGGING',
        name: 'Live C Debugging Arena',
        startTime: new Date(now.getTime() - 10 * 60 * 1000),
        endTime: new Date(now.getTime() + 50 * 60 * 1000),
        status: 'READY',
        durationSeconds: 3600,
      },
    });
  }

  for (const prob of debuggingProblems) {
    const existing = await prisma.debuggingProblem.findFirst({
      where: {
        eventId: debugEvent.id,
        order: prob.order,
      },
    });

    if (existing) {
      await prisma.debuggingProblem.update({
        where: { id: existing.id },
        data: {
          title: prob.title,
          description: prob.description,
          buggyCode: prob.buggyCode,
          expectedOutput: prob.expectedOutput,
          sampleTestCases: prob.sampleTestCases,
          hiddenTestCases: prob.hiddenTestCases,
          testCases: prob.testCases,
          points: prob.points,
          timeLimit: prob.timeLimit,
        },
      });
      console.log(`  ✓ Updated Problem #${prob.order}: ${prob.title}`);
    } else {
      await prisma.debuggingProblem.create({
        data: {
          ...prob,
          eventId: debugEvent.id,
        },
      });
      console.log(`  + Created Problem #${prob.order}: ${prob.title}`);
    }
  }

  console.log('✅ C Debugging Arena problems seeded successfully without overwriting user scores!');
}

seedDebugging()
  .catch((err) => {
    console.error('❌ Error seeding debugging problems:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
