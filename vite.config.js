import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, mkdirSync } from 'node:fs'

const root = fileURLToPath(new URL('.', import.meta.url))
const demoAssets = [
  'demo/video/file_example_MP4_640_3MG.mp4',
  'demo/video/file_example_MP4_640_3MG.torrent',
  'demo/wasm/hello_world.wasm',
  'demo/wasm/pixel-garden/pixel_garden.wasm',
  'demo/wasm/pixel-garden/pixel_garden.torrent',
  'demo/wasm/pixel-garden/roomhash.json'
]

function copyDemoAssets() {
  return {
    name: 'roomhash-demo-assets',
    closeBundle() {
      for (const asset of demoAssets) {
        const destination = resolve(root, 'dist', asset)
        mkdirSync(resolve(destination, '..'), { recursive: true })
        copyFileSync(resolve(root, asset), destination)
      }
    }
  }
}

// RoomHash is deployed as the root user/organization Pages site.
export default defineConfig({
  base: '/',
  plugins: [copyDemoAssets()],
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
