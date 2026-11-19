import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { createOfflinePlugin } from './scripts/pwa-plugin';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), createOfflinePlugin()],
  build: { target: 'es2022', assetsInlineLimit: 1000000, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
  preview: { host: '127.0.0.1', port: 4317, strictPort: true },
});
