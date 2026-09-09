# Platform Architecture & System Design

## 1. System Topology

The SASI Engineers' Day platform is designed as an ultra-reliable, low-latency live contest engine optimized for on-campus LAN / Lab PCs:

```
                  ┌──────────────────────────────────────────────┐
                  │                 Vite Client                  │
                  │   ┌──────────────────┐ ┌──────────────────┐  │
                  │   │  Student Portal  │ │   Admin Portal   │  │
                  │   │ (Port 5173 /lab) │ │ (Port 5174 /ctrl)│  │
                  │   └─────────┬────────┘ └────────┬─────────┘  │
                  └─────────────┼───────────────────┼────────────┘
                                │ HTTP/REST + WS    │ HTTP/REST + WS
                                ▼                   ▼
                  ┌──────────────────────────────────────────────┐
                  │             Express.js Server                │
                  │   ┌──────────────────────────────────────┐   │
                  │   │ Auth & JWT Middleware (Role-Based)   │   │
                  │   ├──────────────────────────────────────┤   │
                  │   │ Routes: /auth, /student, /admin      │   │
                  │   ├──────────────────────────────────────┤   │
                  │   │ Multer Image Storage & /uploads      │   │
                  │   ├──────────────────────────────────────┤   │
                  │   │ Socket.IO Real-Time Dispatcher       │   │
                  │   └──────────────────┬───────────────────┘   │
                  └──────────────────────┼───────────────────────┘
                                         │
                   ┌─────────────────────┴─────────────────────┐
                   ▼                                           ▼
       ┌────────────────────────┐                 ┌────────────────────────┐
       │   Prisma ORM + SQLite  │                 │ Isolated GCC Execution │
       │  (Authoritative State) │                 │  Sandbox (Temp Dirs)   │
       └────────────────────────┘                 └────────────────────────┘
```

---

## 2. Core Architectural Pillars

### A. SQLite Authoritative State
- All student submissions, event phases, timestamps, answers, and qualifications are stored authoritatively in SQLite via Prisma ORM.
- **Zero Socket-as-State**: Socket.IO is strictly an event notification bus (pushing state invalidation and live score updates). On page refresh or reconnection, clients always rehydrate authoritative state from the REST API.

### B. Isolated C Code Compilation
- Student debugging submissions are written to temporary scratch files in `os.tmpdir()`.
- Compiled using `gcc -O2 -Wall -std=c11`.
- Executed against problem test cases with strict execution timeouts (5s default) and buffer size caps to prevent infinite loops or memory bombs.

### C. Client-Side Absolute Timer
- Events specify an authoritative UTC `endTime` timestamp.
- The client `useTimer` hook calculates exact remaining seconds from local monotonic wall clock against `endTime`.
- Eliminates 1-second server tick broadcasting overhead and keeps the network pipe completely open for submissions.

### D. Multi-Stage Technical Quiz Engine
- Round 1 (Qualifiers): 4 challenge stages (`RAPID_FIRE`, `GUESS_THE_TECH`, `TECH_SHUFFLE`, `PUZZLE_GRID`).
- Round 2 (Championship): 4 advanced stages (`TECH_SHOWDOWN`, `TECH_TODAY`, `REAL_OR_FAKE`, `FINAL_CHALLENGE`).
- Elimination Guard: `QuizQualification` model tracks top 10 finalists. Non-qualifiers are gated with `locked: true` and routed to a completed spectator screen.

---

## 3. Database Schema Overview

- **`User`**: Student and administrator credentials, roll numbers, and role permissions.
- **`Event`**: Top-level competition container with status flags (`round1Status`, `round2Status`), timing configurations, weights (40% / 60%), and qualifier limits.
- **`QuizChallenge`**: Stage definitions within rounds (types, point allocations, configurations).
- **`QuizQuestion`**: Individual questions mapped to categories (`AI`, `GADGETS`, `CYBERSECURITY`, `SPACE`, `GAMING`, `FOUNDERS`), types, options, correct answers, and optional `imageUrl`.
- **`QuizQualification`**: Tracks student Round 1 score/time, Round 2 score/time, qualification status (`isQualified`), and final composite rank.
- **`Answer`**: Individual answer records per student with time-taken metrics and duplicate submission prevention (`@@unique([userId, questionId])`).
- **`DebuggingProblem`**: C coding problem statements, buggy source code, and JSON test cases.
- **`Submission`**: Student C code submissions with compilation results, testcase pass/fail diffs, and execution outputs.

