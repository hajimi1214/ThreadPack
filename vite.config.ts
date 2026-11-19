import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  build: { target: 'es2022', assetsInlineLimit: 1000000, chunkSizeWarningLimit: 900 },
  server: { host: '127.0.0.1', port: 4317, strictPort: true },
  preview: { host: '127.0.0.1', port: 4317, strictPort: true },
});
