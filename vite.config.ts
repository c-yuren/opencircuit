import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
// Only the version reaches the browser bundle, not the rest of package.json.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
export default defineConfig({
  root: fileURLToPath(new URL('./apps/web', import.meta.url)),
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  base: './',
  build: { outDir: '../../dist/web', emptyOutDir: true, rollupOptions: { treeshake: false } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT ?? 4318}` },
  },
});
