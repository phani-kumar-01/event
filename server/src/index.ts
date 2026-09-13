import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { initSocket } from './socket/socketManager';
import authRoutes from './routes/auth';
import studentRoutes from './routes/student';
import adminRoutes from './routes/admin';
import debuggingRoutes from './routes/debugging';
import path from 'path';
import fs from 'fs';
import { errorHandler } from './middleware/errorHandler';

const app = express();
const httpServer = createServer(app);

// Ensure uploads directories exist
const uploadsDir = path.join(__dirname, '../uploads');
const questionsUploadDir = path.join(uploadsDir, 'questions');
if (!fs.existsSync(questionsUploadDir)) {
  fs.mkdirSync(questionsUploadDir, { recursive: true });
}

// Serve uploads statically
app.use('/uploads', express.static(uploadsDir));

const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174',
  process.env.CLIENT_URL,
].filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(null, true); // Permissive in local development
    }
  },
  credentials: true,
};

const io = new Server(httpServer, {
  cors: {
    origin: (origin, callback) => callback(null, true),
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io accessible in route handlers
app.set('io', io);

import { checkDatabaseHealth } from './utils/prisma';

app.use(cors(corsOptions));
app.use(express.json({ limit: '512kb' }));
app.use(express.urlencoded({ extended: true, limit: '512kb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/admin', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin', studentRoutes);
app.use('/api/student', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api', authRoutes);
app.use('/api', studentRoutes);
app.use('/api', adminRoutes);
app.use('/api/debugging', debuggingRoutes);
import benchmarkRoutes from './routes/benchmark';
import { setBenchmarkIo } from './services/benchmarkService';
app.use('/api/admin/benchmark', benchmarkRoutes);

import { getRunnerStats } from './services/runnerBridge';
import { cExecutionQueue } from './services/cRunner';

// Health check with database connectivity probe and runner worker status
app.get('/api/health', async (_req, res) => {
  const dbHealth = await checkDatabaseHealth();
  const runnerStats = getRunnerStats();
  const queueStats = {
    configuredMaxConcurrency: cExecutionQueue.getMaxConcurrency ? cExecutionQueue.getMaxConcurrency() : 8,
    activeWorkers: cExecutionQueue.getActiveCount ? cExecutionQueue.getActiveCount() : 0,
    queueDepth: cExecutionQueue.getQueueDepth ? cExecutionQueue.getQueueDepth() : 0,
    peakActive: cExecutionQueue.getPeakActive ? cExecutionQueue.getPeakActive() : 0,
  };
  const statusCode = dbHealth.ok ? 200 : 503;
  res.status(statusCode).json({
    status: dbHealth.ok ? 'ok' : 'degraded',
    database: dbHealth,
    runners: runnerStats,
    queue: queueStats,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize Socket.IO
initSocket(io);
setBenchmarkIo(io);

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 SASI Engineers Day server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready`);
});

export { io };
