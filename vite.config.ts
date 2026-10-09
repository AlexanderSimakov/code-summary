import { defineConfig } from 'vite';
export default defineConfig({
  server: { host: '127.0.0.1', port: Number(process.env.E2E_PORT ?? 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 4310}` } },
});
