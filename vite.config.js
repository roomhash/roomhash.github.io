import { defineConfig } from 'vite'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, cpSync, mkdirSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import parseTorrent, { toTorrentFile } from 'parse-torrent'

const root = fileURLToPath(new URL('.', import.meta.url))
const demoAssets = [
  'demo/video/file_example_MP4_640_3MG.mp4',
  'demo/video/file_example_MP4_640_3MG.torrent'
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
      cpSync(resolve(root, 'roomlets'), resolve(root, 'dist', 'roomlets'), { recursive: true })
    }
  }
}

function localRoomletTorrentMirror() {
  const install = (server, directory) => {
    server.middlewares.use(async (request, response, next) => {
      if (request.method !== 'GET') return next()
      const host = request.headers.host
      if (!host) return next()
      const protocol = request.socket.encrypted ? 'https' : 'http'
      const url = new URL(request.url || '/', `${protocol}://${host}`)
      const match = url.pathname.match(
        /^\/roomlets\/([a-z0-9-]+\/[a-f0-9]{64}\/[a-z0-9][a-z0-9._-]{0,127}\.torrent)$/i
      )
      if (!match) return next()
      try {
        const parsed = await parseTorrent(await readFile(resolve(directory, match[1])))
        const releasePath = url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1)
        parsed.urlList = [`${url.origin}${releasePath}${encodeURIComponent(parsed.name)}`]
        const bytes = Buffer.from(toTorrentFile(parsed))
        response.statusCode = 200
        response.setHeader('Content-Type', 'application/x-bittorrent')
        response.setHeader('Content-Length', String(bytes.length))
        response.setHeader('Cache-Control', 'no-store')
        response.end(bytes)
      } catch {
        next()
      }
    })
  }
  return {
    name: 'roomhash-local-roomlet-torrents',
    configureServer(server) {
      install(server, resolve(root, 'roomlets'))
    },
    configurePreviewServer(server) {
      install(server, resolve(root, 'dist', 'roomlets'))
    }
  }
}

// RoomHash is deployed as the root user/organization Pages site.
export default defineConfig({
  base: '/',
  plugins: [localRoomletTorrentMirror(), copyPublishedAssets()],
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
