import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('token');
    // If client runs on Vite dev port 5173 or 5174, point to backend on 3001
    const isDev =
      typeof window !== 'undefined' &&
      (window.location.port === '5173' || window.location.port === '5174');

    const serverUrl = isDev
      ? `${window.location.protocol}//${window.location.hostname}:3001`
      : '/';

    socket = io(serverUrl, {
      auth: { token },
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });
  }
  return socket;
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

export function resetSocket(): void {
  disconnectSocket();
}

