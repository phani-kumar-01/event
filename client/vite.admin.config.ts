import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'admin'),
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5174,
    fs: {
      allow: [resolve(__dirname, '..')],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-admin'),
    emptyOutDir: true,
    target: 'esnext',
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes('node_modules/react') ||
            id.includes('node_modules/react-dom') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/@remix-run')
          ) {
            return 'react-vendor';
          }
          if (id.includes('socket.io-client') || id.includes('engine.io-client')) {
            return 'socket-vendor';
          }
        },
      },
    },
  },
});
