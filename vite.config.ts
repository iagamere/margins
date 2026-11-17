import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'esnext',
    sourcemap: false,
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        // Keep every emitted asset on a .js/.css/... extension the Android WebView server knows.
        assetFileNames: (info) => {
          const n = (info as { names?: string[]; name?: string }).names?.[0] ?? (info as { name?: string }).name ?? '';
          if (n.endsWith('.mjs')) return 'assets/[name]-[hash].js';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
  worker: { format: 'es' },
});
