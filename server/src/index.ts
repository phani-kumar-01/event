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

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', studentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/debugging', debuggingRoutes);

// Health check
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handler (must be last)
app.use(errorHandler);

// Initialize Socket.IO
initSocket(io);

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`🚀 SASI Engineers Day server running on port ${PORT}`);
  console.log(`📡 Socket.IO ready`);
});

export { io };
