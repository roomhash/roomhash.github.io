import { defineConfig } from 'vite'

// RoomHash is deployed as the root user/organization Pages site.
export default defineConfig({
  base: '/',
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
