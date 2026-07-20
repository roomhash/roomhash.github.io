import { defineConfig } from 'vite'

// Relative base so project pages (user.github.io/repo/) and file:// previews work.
export default defineConfig({
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    target: 'es2022',
    emptyOutDir: true
  },
  server: {
    port: 5173,
    strictPort: false
  }
})
