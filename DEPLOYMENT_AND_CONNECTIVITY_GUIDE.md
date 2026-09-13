# SASI Engineers' Day — Cloud Deployment & Local C Runner Connectivity Guide

This guide details the complete production architecture, cloud hosting steps (Supabase, Render, Netlify), and instructions for establishing the outbound WebSocket link between your local Linux C runner and the central cloud backend.

---

## 1. System Architecture

```
┌─────────────────────────┐          ┌─────────────────────────┐
│   Student Web Portal    │          │      Admin Portal       │
│  (Netlify / Port 5173)  │          │  (Netlify / Port 5174)  │
└────────────┬────────────┘          └────────────┬────────────┘
             │ HTTPS / WSS                        │ HTTPS / WSS
             ▼                                    ▼
┌──────────────────────────────────────────────────────────────┐
│                  Central Cloud Backend                       │
│             Render (Node.js / Express / Socket.IO)           │
│                                                              │
│  - REST API (/api/student, /api/admin, /api/auth)            │
│  - Real-Time Hub (Leaderboard & Timer Broadcasts)            │
│  - C Execution Queue & Outbound Runner Bridge (/runner)      │
└──────────────┬───────────────────────────────▲───────────────┘
               │ PostgreSQL                     │ Outbound WSS
               │ Connection Pool                │ (x-runner-token)
               ▼                                │
┌──────────────────────────────┐   ┌────────────┴──────────────┐
│    Supabase PostgreSQL       │   │    Local Linux C Runner   │
│   (Managed Cloud DB / SSL)   │   │     (Bare-Metal Linux)    │
│                              │   │                           │
│ - Users & Auth               │   │ - Strict 8-Worker Pool    │
│ - Quiz & Debugging Problems  │   │ - GCC 13+ (-O2, -std=c11) │
│ - Submissions & Leaderboard  │   │ - prlimit / Linux Sandbox │
│ - Benchmark Durable Queue    │   │ - Local GUI (Port 3005)   │
└──────────────────────────────┘   └───────────────────────────┘
```

### Key Security & Network Properties
1. **Outbound-Only WebSocket Link:** The Local C Runner establishes an **outbound** connection to Render (`wss://<render-url>/runner`). You do **NOT** need static IPs, port forwarding, or firewall opening on your local network.
2. **Zero Database Exposure:** The Local C Runner **never** receives `DATABASE_URL` or DB credentials. Untrusted C programs cannot access, read, or compromise database records.
3. **Durable Database Queue:** 120+ jobs exist in Supabase PostgreSQL (`status = 'QUEUED'`). The runner executes with a strict worker ceiling (e.g. 8 parallel workers). When a worker finishes, it atomically claims the next job via `FOR UPDATE SKIP LOCKED`.

---

## 2. Database Setup: Supabase PostgreSQL

### Step 1: Create Supabase Project
1. Log in to [Supabase](https://supabase.com) and click **New Project**.
2. Select your Organization, name the project (e.g. `sasi-engineers-day`), choose a strong Database Password, and select your nearest AWS region (e.g., `ap-south-1` Mumbai or `ap-northeast-1` Tokyo).

### Step 2: Obtain Connection String
1. Go to **Project Settings** ➔ **Database**.
2. Under **Connection String**, select **URI**.
3. Choose the **Connection Pooler** (recommended for serverless/Render) on port `6543` (transaction mode) or port `5432` (session mode):
   ```
   postgresql://postgres.[ref]:[PASSWORD]@aws-0-[region].pooler.supabase.com:5432/postgres?sslmode=require
   ```

### Step 3: Run Migrations & Seed Problems
From your terminal:
```bash
cd server
cp .env.example .env
# Edit .env and paste your Supabase DATABASE_URL

# Push schema directly to Supabase
npx prisma db push --schema=../prisma/schema.prisma

# Seed questions, test cases, and student accounts
npx ts-node --project tsconfig.json --transpile-only ../prisma/seed.ts
```

---

## 3. Central Backend Deployment: Render

### Step 1: Create a Web Service on Render
1. Log in to [Render Dashboard](https://dashboard.render.com).
2. Click **New +** ➔ **Web Service**.
3. Connect your GitHub repository (`https://github.com/phani-kumar-01/event.git`).
4. Configure service settings:
   - **Name:** `sasi-engineers-day-server`
   - **Region:** Choose region closest to your Supabase instance (e.g. Oregon / Frankfurt / Singapore).
   - **Branch:** `main`
   - **Root Directory:** `server`
   - **Runtime:** `Node`
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
   - **Instance Type:** Starter (or standard 1-2 vCPU)

### Step 2: Configure Environment Variables
In the Render service **Environment** tab, add:

| Key | Example Value | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://postgres...` | Your Supabase connection string |
| `JWT_SECRET` | `a-secure-random-64-character-secret-string` | JWT auth secret |
| `PORT` | `10000` | Port assigned by Render |
| `CLIENT_URL` | `https://sasi-arena.netlify.app` | Netlify production student URL |
| `RUNNER_TOKEN` | `sasi-runner-secret-key-2026` | Shared secret token for runner handshake |

Click **Save Changes**. Render will automatically build and deploy the backend.

### Step 3: Verify Backend Health
Once deployed, check health in browser or terminal:
```bash
curl -s https://<your-service>.onrender.com/api/health
```
Expected response:
```json
{
  "status": "ok",
  "database": { "ok": true, "latencyMs": 42 },
  "runners": { "connectedWorkers": 0, "activeJobs": 0, "workers": [] },
  "uptimeSeconds": 15
}
```

---

## 4. Frontend Deployment: Netlify

The frontend contains two Vite SPAs:
- **Student Portal:** `client/` (Root build)
- **Admin Portal:** `client/` (`npm run build:admin`)

### Student Portal Setup (Netlify)
1. Go to [Netlify](https://netlify.com) ➔ **Add new site** ➔ **Import an existing project**.
2. Select GitHub repo `event`.
3. Configure build settings:
   - **Base directory:** `client`
   - **Build command:** `npm run build`
   - **Publish directory:** `client/dist`
4. Add Environment Variables in Netlify:
   - `VITE_API_URL`: `https://<your-render-service>.onrender.com/api`
   - `VITE_SOCKET_URL`: `https://<your-render-service>.onrender.com`
5. Click **Deploy Site**.

### Admin Portal Setup (Optional Separate Netlify Site)
If you wish to host the Admin Control Room on a separate domain:
1. Create another site from the same repository.
2. Configure build settings:
   - **Base directory:** `client`
   - **Build command:** `npm run build:admin`
   - **Publish directory:** `client/dist-admin`
3. Set identical `VITE_API_URL` and `VITE_SOCKET_URL` environment variables.

> **Note:** The repository already includes `client/public/_redirects` (`/* /index.html 200`) so React Router paths (`/login`, `/waiting`, `/debugging`, `/admin`) refresh properly.

---

## 5. Local Linux C Runner: Setup & Connecting to Render

The runner executes student C code natively on your Linux host machine with GCC and resource sandboxing.

### Step 1: Install Host Prerequisites
On Ubuntu / Debian Linux:
```bash
sudo apt-get update
sudo apt-get install -y build-essential gcc util-linux nodejs npm
```
Verify tools:
```bash
gcc --version     # GCC 11+ or 13+
/usr/bin/prlimit --version # Resource limiter
node -v           # Node v18+ or v20+
```

### Step 2: Install Runner Dependencies
```bash
cd runner
npm install
npm run build     # compiles runner.ts to runner.js via tsc
```

### Step 3: Connect to Cloud Render Backend
Run the runner with the environment variables pointing to your Render backend:

```bash
SERVER_URL=https://<your-render-service>.onrender.com \
RUNNER_TOKEN=sasi-runner-secret-key-2026 \
CONCURRENCY=8 \
GUI_PORT=3005 \
node runner.js
```

### What Happens On Startup:
1. **WebSocket Handshake:** Runner connects to `wss://<your-render-service>.onrender.com/runner`.
2. **Authentication:** Passes `RUNNER_TOKEN`. Render verifies and confirms:
   ```
   [✓] Connected to Central Backend as worker "Local-Runner-Linux-8W"
   [✓] Handshake Confirmed by Backend: capacity=8 workers
   ```
3. **Local GUI Server:** Starts a live web dashboard at `http://localhost:3005`.
4. **Terminal Dashboard:** Displays live worker pool telemetry every 500ms:
   ```
   [Runner Pool] Status: CONNECTED | Workers: 0/8 Busy | Running: 0 | Queued: 0 | RAM: 8.4GB | Temp: 45°C
   ```

---

## 6. How the Execution Pipeline Works in Real Time

1. **Student submits code** on Netlify:
   - Code is posted to `POST /api/debugging/submit` on Render.
2. **Render dispatches job** to the connected Local Runner:
   - Socket event `BENCHMARK_EXECUTE_JOB` or `EXECUTE_JOB` is emitted over the active WebSocket.
3. **Local Runner processes job** in one of its 8 worker slots:
   - `COMPILING`: Writes temporary source file to `/tmp/sasi-runner-sandbox` and compiles with:
     ```bash
     gcc source.c -o exec.out -O2 -std=c11 -pipe -lm -w
     ```
   - `COMPILED`: Emits compilation time.
   - `EXECUTING`: Runs binary under `/usr/bin/prlimit` with strict limits (128 MB RAM, 2s CPU, 10 processes max).
   - Deletes temporary binary and source code immediately.
4. **Result returned to Render:**
   - Emits `JOB_RESULT` or `BENCHMARK_JOB_RESULT`.
   - Render updates Supabase DB atomically.
   - Render broadcasts stage events to Admin Portal and Student screen over Socket.IO.
5. **Next job claimed:**
   - If jobs remain in queue, the worker immediately claims the next one via `FOR UPDATE SKIP LOCKED`.

---

## 7. Dual Real-Time Monitoring GUIs

### 1. Local Runner Web GUI (`http://localhost:3005`)
Open `http://localhost:3005` in your browser to view:
- Connection status badge.
- 8 live worker cards (Worker 1 to Worker 8) displaying their current stage (`IDLE`, `COMPILING`, `EXECUTING`, `COMPLETED`), elapsed time, and CPU.
- Real-time database queue counter and queued participant chips.
- System RAM usage, CPU temperature, and active process count.

### 2. Cloud Admin Portal (`https://<admin-url>/admin`)
Log in as Admin and open the **C Runner Test** tab:
- Live status pill (`LOCAL RUNNER CONNECTED (8 Workers)`).
- Queued / Executing / Completed / Failed summary cards.
- Real-time Stage Timeline stream (`WORKER_JOB_ASSIGNED`, `COMPILING`, `COMPILED`, `EXECUTING`, `COMPLETED`, `RESULT_SAVED`).
- One-click **Start Integration Test** and non-destructive **Cleanup Test Data** buttons.

---

## 8. Non-Destructive Benchmark Cleanup

To clean up temporary benchmark tables and test accounts (`BENCH001`–`BENCH120`) from Supabase without affecting real students:

```bash
cd server
npm run benchmark:cleanup
```

Or click **Cleanup Test Data** inside the Admin Portal **C Runner Test** tab.
