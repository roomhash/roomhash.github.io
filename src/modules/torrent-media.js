import { DEFAULT_TORRENT_TRACKERS } from '../config.js'

export const TORRENT_MEDIA_MODULE = 'torrent.media'
const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024

export function isMagnetUri(value) {
  if (typeof value !== 'string' || !value.trim().toLowerCase().startsWith('magnet:?')) {
    return false
  }
  try {
    const url = new URL(value.trim())
    return url.protocol === 'magnet:' && url.searchParams.getAll('xt').some((xt) =>
      xt.toLowerCase().startsWith('urn:btih:')
    )
  } catch {
    return false
  }
}

export function classifyTorrentFile(file) {
  const name = String(file?.name || '').toLowerCase()
  const mime = String(file?.type || '').toLowerCase()
  if (mime.startsWith('video/') || /\.(mp4|m4v|webm|ogv|mov)$/.test(name)) return 'video'
  if (mime === 'text/markdown' || /\.(md|markdown)$/.test(name)) return 'markdown'
  if (mime.startsWith('text/') || /\.(txt|log|csv|json)$/.test(name)) return 'text'
  return 'download'
}

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function getBlob(file) {
  return new Promise((resolve, reject) => {
    file.getBlob((error, blob) => (error ? reject(error) : resolve(blob)))
  })
}

function getBlobUrl(file) {
  return new Promise((resolve, reject) => {
    file.getBlobURL((error, url) => (error ? reject(error) : resolve(url)))
  })
}

export class TorrentMediaController {
  constructor({ trackers = DEFAULT_TORRENT_TRACKERS, autoPreload = false } = {}) {
    this.trackers = [...new Set(trackers)]
    this.autoPreload = Boolean(autoPreload)
    this.client = null
    this.server = null
    this.startPromise = null
  }

  setAutoPreload(value) {
    this.autoPreload = Boolean(value)
  }

  async start() {
    if (this.startPromise) return this.startPromise
    this.startPromise = this._createClient()
    return this.startPromise
  }

  async _createClient() {
    const { default: WebTorrent } = await import('webtorrent')
    this.client = new WebTorrent()
    this.client.on('error', (error) => console.error('WebTorrent client error', error))

    if ('serviceWorker' in navigator && window.isSecureContext) {
      try {
        const registration = await navigator.serviceWorker.register('./sw.min.js', {
          scope: './'
        })
        await navigator.serviceWorker.ready
        this.server = this.client.createServer({ controller: registration })
      } catch (error) {
        console.warn('WebTorrent streaming service worker unavailable', error)
      }
    }
    return this.client
  }

  async add(magnet) {
    if (!isMagnetUri(magnet)) throw new Error('invalid magnet link')
    const client = await this.start()
    const existing = client.get(magnet)
    if (existing) return this._waitForMetadata(existing)
    const torrent = client.add(magnet, {
      announce: this.trackers,
      deselect: true
    })
    return this._waitForMetadata(torrent)
  }

  async seed(files) {
    const input = Array.from(files || [])
    if (!input.length) throw new Error('select at least one file')
    const client = await this.start()
    return new Promise((resolve, reject) => {
      const torrent = client.seed(input, { announce: this.trackers }, resolve)
      torrent.once('error', reject)
    })
  }

  async _waitForMetadata(torrent) {
    if (torrent.ready || torrent.metadata) return torrent
    return new Promise((resolve, reject) => {
      torrent.once('metadata', () => resolve(torrent))
      torrent.once('error', reject)
    })
  }

  preload(torrent) {
    for (const file of torrent.files) file.select?.()
  }
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy
  if (label) button.textContent = label
}

async function renderTextFile(doc, file, host, markdown) {
  if (file.length > TEXT_PREVIEW_LIMIT) {
    host.textContent = 'Preview disabled for text files larger than 5 MB.'
    return
  }
  const blob = await getBlob(file)
  const raw = await blob.text()
  host.replaceChildren()

  if (!markdown) {
    const pre = doc.createElement('pre')
    pre.className = 'torrent-raw'
    pre.textContent = raw
    host.appendChild(pre)
    return
  }

  const tabs = doc.createElement('div')
  tabs.className = 'torrent-tabs'
  const renderedButton = doc.createElement('button')
  renderedButton.textContent = 'Rendered'
  const rawButton = doc.createElement('button')
  rawButton.textContent = 'Raw'
  const content = doc.createElement('div')
  content.className = 'torrent-markdown'
  tabs.append(renderedButton, rawButton)
  host.append(tabs, content)

  const showRaw = () => {
    content.className = 'torrent-raw'
    content.textContent = raw
  }
  const showRendered = async () => {
    const [{ marked }, { default: DOMPurify }] = await Promise.all([
      import('marked'),
      import('dompurify')
    ])
    content.className = 'torrent-markdown'
    content.innerHTML = DOMPurify.sanitize(marked.parse(raw))
  }
  rawButton.addEventListener('click', showRaw)
  renderedButton.addEventListener('click', () => showRendered().catch((error) => {
    content.textContent = `Markdown render failed: ${error.message}`
  }))
  await showRendered()
}

async function openTorrentFile(doc, file, host) {
  host.replaceChildren()
  const kind = classifyTorrentFile(file)
  if (kind === 'video') {
    const video = doc.createElement('video')
    video.className = 'torrent-video'
    video.controls = true
    video.preload = 'metadata'
    video.playsInline = true
    host.appendChild(video)
    await file.streamTo(video)
    return
  }
  if (kind === 'text' || kind === 'markdown') {
    await renderTextFile(doc, file, host, kind === 'markdown')
    return
  }
  const link = doc.createElement('a')
  link.className = 'msg-file-link'
  link.textContent = `Download ${file.name}`
  link.download = file.name
  host.appendChild(link)
  link.href = await getBlobUrl(file)
}

export function createTorrentMediaModule(controller) {
  return {
    id: TORRENT_MEDIA_MODULE,
    version: 1,
    render(message, { document: doc }) {
      const payload = message.payload || {}
      const magnet = String(payload.magnet || '')
      const card = doc.createElement('section')
      card.className = 'torrent-card'

      const title = doc.createElement('strong')
      title.textContent = String(payload.title || 'Shared torrent')
      const status = doc.createElement('div')
      status.className = 'torrent-status'
      status.textContent = 'Loading torrent metadata...'
      const actions = doc.createElement('div')
      actions.className = 'torrent-actions'
      const preloadButton = doc.createElement('button')
      preloadButton.textContent = 'Preload'
      const copyButton = doc.createElement('button')
      copyButton.textContent = 'Copy magnet'
      actions.append(preloadButton, copyButton)
      const files = doc.createElement('div')
      files.className = 'torrent-files'
      const viewer = doc.createElement('div')
      viewer.className = 'torrent-viewer'
      card.append(title, status, actions, files, viewer)

      copyButton.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(magnet)
        copyButton.textContent = 'Copied'
      })

      if (!isMagnetUri(magnet)) {
        status.textContent = 'Invalid magnet link.'
        preloadButton.disabled = true
        return card
      }

      controller.add(magnet).then((torrent) => {
        const update = () => {
          status.textContent = `${Math.round(torrent.progress * 100)}% · ${torrent.numPeers} peers · ${formatBytes(torrent.downloadSpeed)}/s`
        }
        update()
        torrent.on('download', update)
        torrent.on('wire', update)
        torrent.on('done', update)

        files.replaceChildren()
        for (const file of torrent.files) {
          const button = doc.createElement('button')
          button.className = 'torrent-file'
          button.textContent = `${file.name} · ${formatBytes(file.length)}`
          button.addEventListener('click', async () => {
            setButtonBusy(button, true, 'Opening...')
            try {
              file.select?.()
              await openTorrentFile(doc, file, viewer)
            } catch (error) {
              viewer.textContent = `Unable to open file: ${error.message}`
            } finally {
              setButtonBusy(button, false, `${file.name} · ${formatBytes(file.length)}`)
            }
          })
          files.appendChild(button)
        }

        preloadButton.addEventListener('click', () => {
          controller.preload(torrent)
          preloadButton.textContent = 'Preloading'
          update()
        })
        if (controller.autoPreload) {
          controller.preload(torrent)
          preloadButton.textContent = 'Preloading'
        }
      }).catch((error) => {
        status.textContent = `Torrent unavailable: ${error.message}`
      })

      return card
    }
  }
}
