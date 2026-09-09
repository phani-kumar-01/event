# SASI Engineers' Day — V1

Competition platform for live C debugging and MCQ Technical Quiz.

## Prerequisites

- Node.js v18+ (available at `~/.nvm/versions/node/v24.19.0/bin/`)
- GCC (for C code execution)

## Setup

### 1. Configure environment

```bash
cp .env.example server/.env
# Edit server/.env and set JWT_SECRET, PORT if needed
# The default DATABASE_URL creates a local SQLite file at prisma/sasi-engineers-day.db
```

### 2. Install server dependencies

```bash
cd server
npm install
```

### 3. Create the local database

```bash
cd server
npm run db:push
```

### 4. Seed the database

```bash
cd server
npm run db:seed
```

### 5. Install client dependencies

```bash
cd client
npm install
```

### 6. Start the backend

```bash
cd server
npm run dev
```

### 7. Start the frontend (in a new terminal)

```bash
cd client
npm run dev
```

### Access

- **Frontend**: http://localhost:5173
- **Admin portal**: http://localhost:5174
- **Backend API**: http://localhost:3001/api
- **Admin login**: `ADMIN001` / `admin123`
- **Student login**: `CS001` / `student123`

## Architecture

- **SQLite** is the local authoritative state store for this prototype
- **Socket.IO** is used only for real-time notifications (never as state store)
- **GCC** compiles and executes submitted C code in isolated temp directories
- **JWT** authenticates all API requests
- Events (Debugging / Technical Quiz) are completely independent
- Timer is calculated client-side from `endTime` — no server tick broadcast

## Event State Machine

```
DRAFT → READY → RUNNING ⇆ PAUSED → FINISHED
                RUNNING → FINISHED
```

## API Overview

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/auth/login | Login with rollNo + password |
| GET | /api/current-event | Get current active event |
| GET | /api/events/:id/debugging-problems | Get debugging problems |
| GET | /api/events/:id/quiz-questions | Get quiz questions |
| POST | /api/events/:id/run-code | Run C code preview |
| POST | /api/events/:id/submit-code | Submit debugging solution |
| POST | /api/events/:id/answers | Submit quiz answer |
| GET | /api/admin/events | Admin: list all events |
| POST | /api/admin/events/:id/start | Admin: start event |
| POST | /api/admin/events/:id/pause | Admin: pause event |
| POST | /api/admin/events/:id/resume | Admin: resume event |
| POST | /api/admin/events/:id/end | Admin: end event |
| POST | /api/admin/quiz-questions/import | Admin: import quiz from Excel |

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `event.state_changed` | Server → Client | Event status update |
| `theme.updated` | Server → Client | Active theme changed |
| `join:event` | Client → Server | Join event room |
# event
