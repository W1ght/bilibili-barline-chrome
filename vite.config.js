import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue2'
import { fileURLToPath } from 'node:url'
export default defineConfig({
  plugins: [vue()],
  resolve: { alias: [{ find: /^@\/.*$/, replacement: fileURLToPath(new URL('./src/chrome-adapter.ts', import.meta.url)) }] },
  build: { target: 'chrome111', lib: { entry: 'src/chrome-entry.ts', name: 'BarLineChrome', formats: ['iife'], fileName: () => 'content.js' }, rollupOptions: { output: { inlineDynamicImports: true } } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') }
})
