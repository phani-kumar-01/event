import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  root: resolve(__dirname, 'admin'),
  plugins: [react()],
  server: {
    port: 5174,
    fs: {
      allow: [resolve(__dirname, '..')],
    },
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3001', changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: resolve(__dirname, 'dist-admin'),
    emptyOutDir: true,
  },
});
