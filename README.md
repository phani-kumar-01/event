# SASI Engineers' Day — Live Competition Platform

A high-performance, real-time competition platform built for **SASI Institute of Technology & Engineering** (Department of Information Technology & ELITE Club) to host live collegiate coding and technical quiz events:

1. **C Debugging Arena** — Real-time GCC compilation and testcase execution in isolated sandboxes with Monaco Editor.
2. **Technical Quiz Arena** — 2-round multi-stage competition engine featuring deterministic per-student question/option shuffling, interactive drag-and-drop workflows, dynamic image-slicing tile puzzles, live Socket.IO leaderboards, and administrative qualification controls.

---

## 🚀 Key Highlights & Architecture

### 1. 🏛️ SASI & ELITE Institutional Identity
- **Official Branding**: Integrated high-resolution **SASI Institute of Technology & Engineering** (Autonomous) and **ELITE Club** marks.
- **Color Palette**: Institutional Deep Red (`#8B0000` / `#ED1E26`), Midnight Navy (`#0A192F`), Tech Cyan (`#00E5FF`), and Gold Accents (`#FFD700`).

### 2. 🛡️ Deterministic Per-Student Shuffling & Anti-Cheating
- **Fair Testing Room Isolation**: With 60 students in the same lab, every student receives the exact same set of questions, but in a **unique, pseudo-random order**, with **MCQ options (A–D) shuffled independently per student**.
- **Deterministic PRNG**: Uses `mulberry32` PRNG seeded deterministically by `hashString(userId + challengeId)`.
- **Database Persistence (`StudentQuestionOrder`)**: The generated question sequence and option remapping (`displayToOriginal`) are saved to the database on first fetch. Page reloads, browser crashes, or reconnections return the identical display layout.
- **Server-Side Reverse Grading**: Student submissions are mapped from their localized display letter back to the author's original key before validation.

### 3. 🧩 8 Interactive Challenge Mechanics
- ⚡ **`RAPID_FIRE`**: High-tempo MCQs testing fundamental knowledge and speed.
- 🔍 **`GUESS_THE_TECH`**: Architecture and clue image identification with live dropzone uploads and thumbnail previews.
- 🔀 **`TECH_SHUFFLE`**: Interactive sequence arranging with HTML5 drag-and-drop cards and precision step arrows. Backend validates JSON array step sequences against `correctSequence`.
- 🧩 **`PUZZLE_GRID`**: 3x3 sliding tile neural processor matrix. Dynamically slices custom uploaded images into a 3x3 tile grid (`background-size: 300% 300%`). Persists `initialState` and `currentState` to the server so tile progress is preserved across refreshes.
- ⚔️ **`TECH_SHOWDOWN`**: High-stakes speed & accuracy championship questions.
- 📰 **`TECH_TODAY`**: Modern cloud, AI, and developer ecosystem developments.
- 🎭 **`REAL_OR_FAKE`**: High-contrast binary decision challenges separating real tech specs from AI hallucinations.
- 👑 **`FINAL_CHALLENGE`**: Deciding championship round problem.

### 4. ⏱️ Flexible Stage Controls & Stock Badging
- **Timer Modes**: Configurable `GLOBAL_STAGE` (shared countdown) or `PER_QUESTION` (fixed seconds per question).
- **Stock Recommendation Badges**: Admin dashboard dynamically audits question counts per challenge duration (e.g., `⚠️ 6 questions — recommend 10+ for a 5 min stage` / `✅ 12 questions (Ready)`).

### 5. 🏆 Two-Round Tournament Qualification
- **Round 1 (Qualifiers)**: Up to 60 students compete across 4 stages.
- **Top 10 Finalist Lock-In**: Admin reviews and confirms the top 10 finalists via a modal with instant tie-breaking verification.
- **Round 2 (Championship)**: Top 10 finalists compete across 4 advanced stages while eliminated students are respectfully locked and shown final standings.

---

## 🛠️ Technology Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 18, TypeScript, Vite, CSS Modules, Monaco Editor, Lucide Icons |
| **Backend** | Node.js, Express, TypeScript, Socket.IO, Multer, Zod |
| **Database & ORM** | SQLite / PostgreSQL, Prisma ORM |
| **Execution Engine** | GCC (GNU C Compiler) sandbox with runtime isolation and memory/time limit controls |
| **Authentication** | JWT (JSON Web Tokens) with HTTP Bearer authorization |

---

## 📋 Prerequisites

- **Node.js**: v18.0.0 or higher (v20+ / v24 recommended)
- **npm**: v9.0.0 or higher
- **GCC**: GNU Compiler Collection (required for compiling student C debugging submissions)

Verify installed versions:
```bash
node -v
npm -v
gcc --version
```

---

## ⚡ Quickstart Setup

### 1. Clone the repository
```bash
git clone https://github.com/phani-kumar-01/event.git
cd event
```

### 2. Configure Environment Variables
Create `.env` in `server/`:
```bash
cp .env.example server/.env
```

Ensure `server/.env` contains:
```env
PORT=3001
JWT_SECRET="sasi-engineers-day-super-secret-key-2026"
DATABASE_URL="file:/home/candy/deb/prisma/sasi-engineers-day.db"
CLIENT_ORIGIN="http://localhost:5173"
ADMIN_ORIGIN="http://localhost:5174"
```

### 3. Install Dependencies
```bash
# Install root, server, and client dependencies
npm install
cd server && npm install
cd ../client && npm install
cd ..
```

### 4. Initialize Database & Seed Sample Data
```bash
cd server
# Push Prisma schema to SQLite
npx prisma db push

# Seed default admin, student accounts, sample events, problems & questions
npm run db:seed
```

### 5. Run Development Servers
Open two terminal windows:

**Terminal 1 (Backend API & Socket.IO):**
```bash
cd server
npm run dev
```
*Server runs on [http://localhost:3001](http://localhost:3001)*

**Terminal 2 (Student & Admin Client):**
```bash
cd client
npm run dev
```
*Student portal runs on [http://localhost:5173](http://localhost:5173)*  
*Admin portal runs on [http://localhost:5174](http://localhost:5174)* (via `npm run dev:admin`)

---

## 👥 Default Credentials

| Portal | URL | Roll No / Username | Password | Role |
|---|---|---|---|---|
| **Admin Portal** | `http://localhost:5174` | `ADMIN001` | `admin123` | Administrator |
| **Student Portal** | `http://localhost:5173` | `CS001` to `CS060` | `student123` | Student Participant |

---

## 📡 REST API Reference

### Authentication (`/api/auth`)
- `POST /api/auth/login` — Authenticate user via `rollNo` and `password`. Returns JWT token and user profile.

### Student Endpoints (`/api`)
- `GET /api/me` — Fetch current user profile.
- `GET /api/current-event` — Fetch active event state, round timers, and qualification lock status.
- `GET /api/events/:id/quiz-challenges` — Get available challenge stages with `timerMode` and progress.
- `GET /api/events/:id/quiz-questions` — Fetch questions ordered deterministically for the requesting student.
- `GET /api/events/:id/my-answers` — Fetch student's submitted answers mapped to their display options.
- `GET /api/events/:id/my-puzzle` — Get or initialize student's seeded 3x3 puzzle board state.
- `POST /api/events/:id/puzzle-state` — Sync in-progress puzzle tile moves and `currentState`.
- `POST /api/events/:id/puzzle-submit` — Submit solved 3x3 puzzle for score and time bonus calculation.
- `POST /api/events/:id/answers` — Submit student response with option/sequence remapping validation.
- `GET /api/events/:id/debugging-problems` — Fetch C debugging problems and test cases.
- `POST /api/events/:id/run-code` — Compile and execute C code preview against sample test cases.
- `POST /api/events/:id/submit-code` — Submit final C code for official scoring.

### Admin Endpoints (`/api/admin`)
- `GET /api/admin/events` — List all events and configurations.
- `POST /api/admin/events/:id/start-round1` — Begin Round 1 for qualifiers.
- `POST /api/admin/events/:id/pause` — Pause current running round.
- `POST /api/admin/events/:id/resume` — Resume paused round.
- `POST /api/admin/events/:id/end-round1` — Conclude Round 1 and calculate rankings.
- `POST /api/admin/events/:id/qualify-round1` — Confirm and promote top 10 finalists to Round 2.
- `POST /api/admin/events/:id/start-round2` — Begin Round 2 Championship.
- `POST /api/admin/events/:id/end-round2` — Finalize Championship and calculate final winners.
- `GET /api/admin/events/:id/round1-leaderboard` — Get Round 1 qualification leaderboard.
- `GET /api/admin/events/:id/final-leaderboard` — Get Final Championship rankings.
- `GET /api/admin/quiz-challenges` — List challenges with stage controls.
- `POST /api/admin/quiz-challenges` — Create new challenge stage (with `timerMode`, `timePerQuestionSec`, and puzzle config).
- `PATCH /api/admin/quiz-challenges/:id` — Update challenge stage.
- `DELETE /api/admin/quiz-challenges/:id` — Delete challenge stage.
- `POST /api/admin/quiz-questions` — Create new question (with category, sequence, and image validation).
- `PATCH /api/admin/quiz-questions/:id` — Update existing question.
- `DELETE /api/admin/quiz-questions/:id` — Delete question.
- `POST /api/admin/quiz-questions/upload-image` — Upload question image (`multipart/form-data`, max 5MB, JPG/PNG/WEBP).
- `POST /api/admin/quiz-questions/import` — Bulk import questions via Excel/CSV spreadsheet.
- `GET /api/admin/students` — List all registered student accounts.
- `POST /api/admin/students` — Register a new student account.

---

## ⚡ Socket.IO Real-Time Protocol

| Event Channel | Direction | Payload Description |
|---|---|---|
| `join:event` | Client → Server | `{ eventId: string }` joins room for real-time updates. |
| `leave:event` | Client → Server | `{ eventId: string }` leaves event room. |
| `event.state_changed` | Server → Client | Emitted when event status or round transitions occur. |
| `event.round_changed` | Server → Client | Emitted when active round changes (Round 1 → Round 2). |
| `leaderboard.update` | Server → Client | Emitted on new score submissions to refresh standings. |

---

## 📁 Project Structure

```
event/
├── client/                     # React + Vite Frontend Application
│   ├── public/                 # Favicons & static branding assets
│   ├── src/
│   │   ├── assets/branding/    # SASI & ELITE logo assets
│   │   ├── components/         # TechShuffle, SlidingPuzzle, ConnectionBadge, etc.
│   │   ├── hooks/              # useTimer, useConnectionStatus
│   │   ├── pages/              # AdminPage, QuizPage, DebuggingPage, WaitingPage, LoginPage
│   │   ├── services/           # Axios API instance and Socket.IO client
│   │   ├── state/              # AuthContext & state providers
│   │   └── styles/             # Global CSS variables & design tokens
│   ├── vite.config.ts          # Student portal Vite configuration (Port 5173)
│   └── vite.admin.config.ts    # Admin portal Vite configuration (Port 5174)
├── server/                     # Node.js + Express Backend
│   ├── src/
│   │   ├── routes/             # REST Route handlers (admin.ts, student.ts, auth.ts)
│   │   ├── services/           # eventService.ts (PRNG shuffle, puzzle generator, grading)
│   │   ├── socket/             # Socket.IO connection and broadcast managers
│   │   ├── utils/              # C compilation sandbox, Excel parser, JWT helpers, prisma.ts
│   │   └── index.ts            # Server entrypoint and static upload serving
│   └── uploads/questions/      # Static image uploads directory
├── prisma/                     # Database layer
│   ├── schema.prisma           # Prisma data models & relations
│   └── seed.ts                 # Database seeding script with realistic competition data
└── package.json                # Monorepo root configuration
```

---

## 📦 Production Build

```bash
# 1. Build backend TypeScript
cd server
npm run build

# 2. Build student frontend & admin bundle
cd ../client
npm run build
npm run build:admin
```

Production artifacts will be generated in `server/dist/`, `client/dist/`, and `client/dist-admin/`.

---

## 🛡️ License

Developed for SASI Institute of Technology & Engineering — Engineers' Day Competition.  
All rights reserved.
