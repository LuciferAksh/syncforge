import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'web',
  plugins: [react()],
  server: {
    port: 5175,
    proxy: { '/api': 'http://127.0.0.1:4400', '/sync': { target: 'ws://127.0.0.1:4400', ws: true } },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
