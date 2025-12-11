import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  server: {
    port: 3000,
    open: true
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  },
  publicDir: 'public',
  optimizeDeps: {
    exclude: ['@mediapipe/hands', '@mediapipe/camera_utils', '@mediapipe/drawing_utils']
  },
  // 解析别名
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});
