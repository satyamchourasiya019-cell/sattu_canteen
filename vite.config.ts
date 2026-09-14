import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Demo API server (used only when Firebase env vars are absent).
// Started here so `npm run dev` gives a fully working app with realtime.
const demoServer = path.join(__dirname, 'server', 'demo-server.mjs');
let demoProc: ReturnType<typeof spawn> | null = null;

function startDemoApi(): void {
  if (demoProc) return;
  demoProc = spawn(process.execPath, [demoServer], {
    stdio: 'inherit',
    env: { ...process.env, DEMO_API_PORT: '8787' },
  });
  demoProc.on('exit', (code) => {
    console.log(`[vite] demo API exited (${code})`);
    demoProc = null;
  });
}

function stopDemoApi(): void {
  demoProc?.kill();
  demoProc = null;
}

const pluginDemoApi = {
  name: 'demo-api',
  configureServer() {
    startDemoApi();
  },
  buildStart() {
    if (process.env.BUILD_SKIP_DEMO_API !== '1') startDemoApi();
  },
  closeBundle() {
    // Vite build process: shut the helper down after the build completes.
    stopDemoApi();
  },
};

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), pluginDemoApi],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
          vendor: ['react', 'react-dom', 'react-router-dom'],
        },
      },
    },
  },
});
