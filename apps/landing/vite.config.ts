import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL('../..', import.meta.url)),
  server: {
    port: 5174,
  },
});
