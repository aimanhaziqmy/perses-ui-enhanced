import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

const backendTarget = process.env.PERSES_BACKEND_URL || 'http://localhost:8080';

function persesWebpackFederationInterop(): Plugin {
  return {
    name: 'perses-webpack-federation-interop',
    renderChunk(code) {
      const pattern =
        /return\s+async\s*\(\)\s*=>\s*\{\s*const\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+([A-Za-z_$][\w$]*)\(\)\s*;?\s*return\s*\(\)\s*=>\s*\1\s*;?\s*\}/g;
      if (!pattern.test(code)) {
        return null;
      }
      pattern.lastIndex = 0;
      const transformed = code.replace(pattern, (_match, modVar: string, fnVar: string) => {
        return `return async () => { const ${modVar} = await ${fnVar}(); const wrapped = ${modVar} && typeof ${modVar} === 'object' && !Object.prototype.hasOwnProperty.call(${modVar}, '__esModule') ? (() => { const o = Object.create(null); Object.defineProperty(o, '__esModule', { value: true }); for (const k of Object.keys(${modVar})) { Object.defineProperty(o, k, { enumerable: true, get: () => ${modVar}[k] }); } if ('default' in ${modVar} && !Object.prototype.hasOwnProperty.call(o, 'default')) { Object.defineProperty(o, 'default', { enumerable: true, get: () => ${modVar}.default }); } return o; })() : ${modVar}; return () => wrapped; }`;
      });
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
    sourcemap: false,
  },
});

