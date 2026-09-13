# SASI Engineers' Day — External C Execution Runner

This lightweight runner executes student C programs on an external machine (such as a local lab workstation or dedicated server) rather than running GCC directly on Render's web dyno.

## How It Works
- The worker creates an **outbound WebSocket connection** to your Render backend at `/runner`.
- **No inbound firewall ports, port-forwarding, or public IP needed** on the runner machine.
- When students submit code, the backend automatically routes the execution job to connected runner(s).
- If no runners are online, or if a runner disconnects during a test, the server **gracefully falls back to local execution**.

## Requirements
- Linux (Ubuntu/Debian recommended) with GCC and `prlimit` installed:
  ```bash
  sudo apt-get update && sudo apt-get install -y gcc util-linux nodejs npm
  ```
- Node.js 18+

## Quick Start

1. Install dependencies:
   ```bash
   cd runner
   npm install
   ```

2. Start the worker:
   ```bash
   SERVER_URL=https://sasi-engineers-day.onrender.com \
   RUNNER_TOKEN=your-runner-token \
   CONCURRENCY=8 \
   npm start
   ```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `SERVER_URL` | `http://localhost:3001` | Backend URL |
| `RUNNER_TOKEN` | `sasi-runner-secret-key-2026` | Shared secret with backend `RUNNER_TOKEN` |
| `WORKER_NAME` | Auto-generated | Friendly name shown on backend `/api/health` |
| `CONCURRENCY` | `8` | Maximum concurrent GCC executions per worker |

## Verification
You can check the health status and connected runners on the backend at:
```bash
curl https://your-server.onrender.com/api/health
```
Response:
```json
{
  "status": "ok",
  "runners": {
    "connectedWorkers": 1,
    "activeJobs": 0,
    "workers": [{ "name": "Lab-PC-1", "activeJobs": 0, "maxConcurrency": 8 }]
  }
}
```
