import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))
const demoAssets = [
  'demo/video/file_example_MP4_640_3MG.mp4',
  'demo/video/file_example_MP4_640_3MG.torrent',
  'demo/wasm/hello_world.wasm'
]

function copyPublishedAssets() {
  return {
    name: 'roomhash-published-assets',
    closeBundle() {
      for (const asset of demoAssets) {
        const destination = resolve(root, 'dist', asset)
        mkdirSync(resolve(destination, '..'), { recursive: true })
        copyFileSync(resolve(root, asset), destination)
      }
      cpSync(resolve(root, 'appstore'), resolve(root, 'dist', 'appstore'), { recursive: true })
    }
  }
}

// RoomHash is deployed as the root user/organization Pages site.
export default defineConfig({
  base: '/',
  plugins: [copyPublishedAssets()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    target: 'es2022',
    emptyOutDir: true,
    rollupOptions: { input: resolve(root, 'index.html') }
  },
  server: {
    port: 5173,
    strictPort: false
  }
})
