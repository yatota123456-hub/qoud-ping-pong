import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: process.env.BASE_PATH || "/",
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(import.meta.dirname, 'attached_assets'),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port: 5001,
    strictPort: false,
    host: '0.0.0.0',
    proxy: {
      '/matchmake': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        ws: true,
      },
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});