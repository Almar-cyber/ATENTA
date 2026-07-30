import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The built SPA lands in ../dist, which the Cloudflare Worker serves via its [assets] binding
// (see wrangler.toml). The Worker owns /api/*, /oauth/* and /privacy; everything else is this app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    outDir: path.resolve(__dirname, '../dist'),
    emptyOutDir: true,
  },
  server: {
    // `npm run dev` inside web/ proxies API calls to the local Worker (wrangler dev on 8787),
    // so the React dev server and the Worker can run side by side.
    proxy: {
      '/api': 'http://localhost:8787',
      '/oauth': 'http://localhost:8787',
      '/privacy': 'http://localhost:8787',
    },
  },
});
