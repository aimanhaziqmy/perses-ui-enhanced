import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

import { rewriteFederationChunk } from './src/app/perses/federation-chunk';

const backendTarget = process.env.PERSES_BACKEND_URL || 'http://localhost:8080';

function persesWebpackFederationInterop(): Plugin {
  return {
    name: 'perses-webpack-federation-interop',
    renderChunk(code) {
      const transformed = rewriteFederationChunk(code);
      if (!transformed) {
        return null;
      }
      return { code: transformed, map: null };
    },
  };
}

export default defineConfig({
  plugins: [react(), persesWebpackFederationInterop()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  define: {
    global: 'globalThis',
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/proxy': {
        target: backendTarget,
        changeOrigin: true,
      },
      '/plugins': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/react-router-dom/')) {
            return 'vendor-react';
          }
          if (id.includes('node_modules/@mui/') || id.includes('node_modules/@emotion/')) {
            return 'vendor-mui';
          }
          if (id.includes('node_modules/echarts/') || id.includes('node_modules/zrender/')) {
            return 'vendor-echarts';
          }
          if (id.includes('node_modules/@perses-dev/')) {
            return 'vendor-perses';
          }
        },
      },
    },
  },
});

