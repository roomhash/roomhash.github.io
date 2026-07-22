import { DEFAULT_TORRENT_TRACKERS } from '../config.js'
import { localizeError, t } from '../i18n.js'
import { TorrentSeedCache } from '../torrent-cache.js'

export const TORRENT_MEDIA_MODULE = 'torrent.media'
const TEXT_PREVIEW_LIMIT = 5 * 1024 * 1024
const METADATA_TIMEOUT_MS = 20_000
const TRACKER_PEER_OFFERS = 1
const TRACKER_SOCKET_MAX_LISTENERS = 64

export function normalizeMagnetUri(value) {
  return String(value || '').trim().replace(
    /(^|[?&])xt=urn%3Abtih%3A/ig,
    '$1xt=urn:btih:'
  )
}

function resolveTorrentIdentifier(magnet) {
  // Keep the full magnet so WebTorrent can validate `xs` metadata against
  // `xt` and merge the card's current `ws` with any web seeds embedded in the
  // torrent file. Returning the fetched `xs` bytes here would discard `ws`
  // and could also accept metadata for a different info hash.
  return magnet
}

export class TorrentMetadataTimeoutError extends Error {
  constructor() {
    super('no WebRTC seed is currently available')
    this.name = 'TorrentMetadataTimeoutError'
    this.code = 'ERR_TORRENT_METADATA_TIMEOUT'
  }
}

export function isMagnetUri(value) {
  const magnet = normalizeMagnetUri(value)
  if (!magnet.toLowerCase().startsWith('magnet:?')) {
    return false
  }
  try {
    const url = new URL(magnet)
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
  if (mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|avif|svg)$/.test(name)) return 'image'
  if (mime === 'text/markdown' || /\.(md|markdown)$/.test(name)) return 'markdown'
  if (mime.startsWith('text/') || /\.(txt|log|csv|json)$/.test(name)) return 'text'
  return 'download'
}

export function createTorrentMediaPayload(source) {
  const magnet = normalizeMagnetUri(source?.magnetURI)
  if (!isMagnetUri(magnet)) throw new Error('cached seed has no valid magnet link')
  const files = Array.from(source?.files || []).map((file) => {
    const rawSize = Number(file?.length ?? file?.size ?? file?.blob?.size ?? 0)
    return {
      name: String(file?.name || file?.path || ''),
      size: Number.isFinite(rawSize) && rawSize >= 0 ? rawSize : 0,
      mime: String(file?.type || file?.mime || file?.blob?.type || '')
    }
  })
  if (!files.length || files.some((file) => !file.name)) {
    throw new Error('cached seed has no shareable files')
  }
  return {
    magnet,
    title: String(source?.name || files[0].name || 'Shared files'),
    files
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0)
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function getBlob(file) {
  return file.blob()
}

async function getBlobUrl(file) {
  return URL.createObjectURL(await getBlob(file))
}

export class TorrentMediaController {
  constructor({ trackers = DEFAULT_TORRENT_TRACKERS, autoPreload = false, cache = new TorrentSeedCache() } = {}) {
    this.trackers = [...new Set(trackers)]
    this.autoPreload = Boolean(autoPreload)
    this.client = null
    this.server = null
    this.startPromise = null
    this.cache = cache
    this.cacheWrites = new Map()
    this.seedRestorePromises = new Map()
    this.watchedTorrents = new WeakSet()
    this.torrentObservers = new WeakMap()
    this.localSeeds = new Map()
    this.seedListeners = new Set()
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
    const { default: WebTorrent } = await import('webtorrent/dist/webtorrent.min.js')
    this.client = new WebTorrent({
      tracker: {
        getAnnounceOpts: () => ({ numwant: TRACKER_PEER_OFFERS })
      }
    })
    this.client.setMaxListeners?.(TRACKER_SOCKET_MAX_LISTENERS)
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
    await this._restoreCachedSeeds()
    return this.client
  }

  async _restoreCachedSeeds() {
    let records = []
    try {
      records = await this.cache.list()
    } catch (error) {
      console.warn('Unable to read the RoomHash torrent cache', error)
      return
    }
    await Promise.all(records.map(async (record) => {
      try {
        if (!record?.torrentFile || !record?.files?.length) throw new Error('cached torrent is incomplete')
        this._registerCachedRecord(record, false)
        if (await this.client.get(record.infoHash)) return
        this._restoreCachedRecord(record)
      } catch (error) {
        console.warn(`Unable to restore cached torrent ${record?.infoHash || 'unknown'}`, error)
        if (record?.infoHash) this.cache.remove(record.infoHash).catch(() => {})
      }
    }))
    this._emitSeedsChanged()
  }

  _restoreCachedRecord(record) {
    const torrent = this.client.add(new Uint8Array(record.torrentFile), { announce: this.trackers })
    this._configureTrackerSockets(torrent)
    let resolveRestore
    let rejectRestore
    let restoreFinished = false
    const restorePromise = new Promise((resolve, reject) => {
      resolveRestore = resolve
      rejectRestore = reject
    })
    this.seedRestorePromises.set(record.infoHash, restorePromise)
    const failRestore = (error) => {
      const entry = this.localSeeds.get(record.infoHash)
      if (entry) entry.active = false
      this._emitSeedsChanged()
      if (restoreFinished) return
      restoreFinished = true
      rejectRestore(error instanceof Error ? error : new Error(String(error)))
    }
    const restore = () => {
      try {
        const cachedByPath = new Map(record.files.map((file) => [file.path || file.name, file]))
        const streams = torrent.files.map((file) => cachedByPath.get(file.path || file.name)?.blob?.stream?.())
        if (streams.some((stream) => !stream)) throw new Error('cached torrent files do not match metadata')
        torrent.load(streams, (error) => {
          if (error) {
            failRestore(error)
            return
          }
          if (restoreFinished) return
          restoreFinished = true
          this._registerTorrent(torrent, true)
          resolveRestore(torrent)
        })
        this._watchForCompletion(torrent)
      } catch (error) {
        failRestore(error)
      }
    }
    if (torrent.ready) restore()
    else torrent.once('ready', restore)
    torrent.once('error', failRestore)
    restorePromise.then(
      () => {
        if (this.seedRestorePromises.get(record.infoHash) === restorePromise) {
          this.seedRestorePromises.delete(record.infoHash)
        }
      },
      (error) => {
        if (this.seedRestorePromises.get(record.infoHash) === restorePromise) {
          this.seedRestorePromises.delete(record.infoHash)
        }
        console.warn(`Unable to restore cached torrent ${record.infoHash}`, error)
      }
    )
    return torrent
  }

  async add(magnet, { onTorrent } = {}) {
    const normalizedMagnet = normalizeMagnetUri(magnet)
    if (!isMagnetUri(normalizedMagnet)) throw new Error('invalid magnet link')
    const client = await this.start()
    const torrentId = await resolveTorrentIdentifier(normalizedMagnet)
    const existing = await client.get(torrentId)
    const torrent = existing || client.add(torrentId, {
      announce: this.trackers,
      deselect: true
    })
    this._configureTrackerSockets(torrent)
    onTorrent?.(torrent)
    this._watchForCompletion(torrent)
    const readyTorrent = await this._waitForMetadata(torrent)
    const cachedRestore = this.seedRestorePromises.get(readyTorrent.infoHash)
    if (cachedRestore) await cachedRestore
    return readyTorrent
  }

  async seed(files) {
    const input = Array.from(files || [])
    if (!input.length) throw new Error('select at least one file')
    const client = await this.start()
    const torrent = await new Promise((resolve, reject) => {
      const torrent = client.seed(input, { announce: this.trackers }, resolve)
      torrent.once('error', reject)
    })
    this._configureTrackerSockets(torrent)
    torrent.roomHashCached = await this._cacheTorrent(torrent)
    this._registerTorrent(torrent, torrent.roomHashCached)
    this._watchForCompletion(torrent)
    return torrent
  }

  async _waitForMetadata(torrent) {
    if (torrent.ready || torrent.metadata) return torrent
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        torrent.off('metadata', onMetadata)
        torrent.off('error', onError)
      }
      const onMetadata = () => {
        cleanup()
        resolve(torrent)
      }
      const onError = (error) => {
        cleanup()
        reject(error)
      }
      const timer = setTimeout(() => {
        cleanup()
        reject(new TorrentMetadataTimeoutError())
      }, METADATA_TIMEOUT_MS)
      torrent.once('metadata', onMetadata)
      torrent.once('error', onError)
    })
  }

  _watchForCompletion(torrent) {
    if (!torrent || this.watchedTorrents.has(torrent)) return
    this.watchedTorrents.add(torrent)
    const cache = () => this._cacheTorrent(torrent).catch((error) => {
      console.warn(`Unable to cache completed torrent ${torrent.infoHash || ''}`, error)
    })
    if (torrent.done) cache()
    else torrent.once('done', cache)
  }

  _configureTrackerSockets(torrent) {
    const configure = () => {
      const trackers = torrent?.discovery?.tracker?._trackers || []
      for (const tracker of trackers) {
        tracker.socket?.setMaxListeners?.(TRACKER_SOCKET_MAX_LISTENERS)
      }
    }
    configure()
    queueMicrotask(configure)
  }

  async _cacheTorrent(torrent) {
    if (!torrent?.infoHash) return false
    if (this.cacheWrites.has(torrent.infoHash)) return this.cacheWrites.get(torrent.infoHash)
    const write = this.cache.storeTorrent(torrent).then((stored) => {
      if (stored) this._registerTorrent(torrent, true)
      return stored
    }).catch((error) => {
      console.warn(`Unable to persist torrent ${torrent.infoHash}`, error)
      return false
    }).finally(() => this.cacheWrites.delete(torrent.infoHash))
    this.cacheWrites.set(torrent.infoHash, write)
    return write
  }

  _registerCachedRecord(record, active) {
    this.localSeeds.set(record.infoHash, {
      infoHash: record.infoHash,
      name: record.name || record.files?.[0]?.name || record.infoHash,
      files: record.files?.length || 0,
      size: (record.files || []).reduce((total, file) => total + Number(file.length || file.blob?.size || 0), 0),
      updatedAt: record.updatedAt || 0,
      active: Boolean(active),
      cached: true
    })
  }

  _registerTorrent(torrent, cached = false) {
    if (!torrent?.infoHash) return
    const existing = this.localSeeds.get(torrent.infoHash)
    this.localSeeds.set(torrent.infoHash, {
      infoHash: torrent.infoHash,
      name: torrent.name || existing?.name || torrent.infoHash,
      files: torrent.files?.length || existing?.files || 0,
      size: torrent.files?.reduce((total, file) => total + Number(file.length || 0), 0) || existing?.size || 0,
      updatedAt: Date.now(),
      active: true,
      cached: Boolean(cached || existing?.cached)
    })
    this._emitSeedsChanged()
  }

  _emitSeedsChanged() {
    const seeds = this.getLocalSeedsSnapshot()
    for (const listener of this.seedListeners) listener(seeds)
  }

  onSeedsChanged(listener) {
    this.seedListeners.add(listener)
    return () => this.seedListeners.delete(listener)
  }

  getLocalSeedsSnapshot() {
    return [...this.localSeeds.values()]
      .map((seed) => ({ ...seed }))
      .sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt - a.updatedAt)
  }

  async getLocalSeeds() {
    await this.start()
    return this.getLocalSeedsSnapshot()
  }

  async hasCached(infoHash, { entry = '', size } = {}) {
    const normalized = String(infoHash || '').trim().toLowerCase()
    if (!/^[a-f0-9]{40}$/.test(normalized)) return false
    const expectedSize = Number(size)
    const matchesEntry = (files) => {
      const file = Array.from(files || []).find((item) => {
        const path = String(item?.path || item?.name || '')
        return !entry || path === entry || path.endsWith(`/${entry}`)
      })
      if (!file) return false
      if (!Number.isFinite(expectedSize) || expectedSize < 0) return true
      return Number(file.length ?? file.size ?? file.blob?.size) === expectedSize
    }

    const active = this.client ? await this.client.get(normalized) : null
    if (active?.done && matchesEntry(active.files)) return true
    try {
      const record = await this.cache.get(normalized)
      return Boolean(record?.torrentFile && matchesEntry(record.files))
    } catch {
      return false
    }
  }

  async stopSeed(infoHash) {
    await this.start()
    const torrent = await this.client.get(infoHash)
    if (torrent) await this.client.remove(infoHash)
    const entry = this.localSeeds.get(infoHash)
    if (entry) entry.active = false
    this._emitSeedsChanged()
    return this.getLocalSeedsSnapshot()
  }

  async resumeSeed(infoHash) {
    await this.start()
    if (await this.client.get(infoHash)) {
      const pending = this.seedRestorePromises.get(infoHash)
      if (pending) await pending
      return this.getLocalSeedsSnapshot()
    }
    const record = await this.cache.get(infoHash)
    if (!record) throw new Error('cached seed is unavailable')
    this._registerCachedRecord(record, false)
    this._restoreCachedRecord(record)
    const pending = this.seedRestorePromises.get(infoHash)
    if (pending) await pending
    return this.getLocalSeedsSnapshot()
  }

  async prepareLocalSeedShare(infoHash) {
    await this.start()
    let torrent = await this.client.get(infoHash)
    if (!torrent) {
      await this.resumeSeed(infoHash)
      torrent = await this.client.get(infoHash)
    } else {
      const pending = this.seedRestorePromises.get(infoHash)
      if (pending) await pending
    }
    if (!torrent) throw new Error('cached seed could not resume')
    return createTorrentMediaPayload(torrent)
  }

  async removeSeed(infoHash) {
    await this.stopSeed(infoHash)
    await this.cache.remove(infoHash)
    this.localSeeds.delete(infoHash)
    this._emitSeedsChanged()
    return this.getLocalSeedsSnapshot()
  }

  observeTorrent(torrent, listener) {
    if (!torrent || typeof listener !== 'function') return () => {}
    let observer = this.torrentObservers.get(torrent)
    if (!observer) {
      const listeners = new Set()
      const handlers = new Map()
      for (const event of ['wire', 'noPeers', 'trackerWarning', 'trackerError', 'download', 'done']) {
        const handler = () => {
          for (const current of listeners) current(event, torrent)
        }
        handlers.set(event, handler)
        torrent.on(event, handler)
      }
      observer = { listeners, handlers }
      this.torrentObservers.set(torrent, observer)
    }
    observer.listeners.add(listener)
    return () => {
      observer.listeners.delete(listener)
      if (observer.listeners.size) return
      for (const [event, handler] of observer.handlers) torrent.off(event, handler)
      this.torrentObservers.delete(torrent)
    }
  }

  preload(torrent) {
    for (const file of torrent.files) file.select?.()
  }
}

function setButtonBusy(button, busy, label) {
  button.disabled = busy
  if (label) button.textContent = label
}

function trackerSummary(trackers) {
  const names = trackers.map((tracker) => {
    try { return new URL(tracker).host }
    catch { return tracker }
  })
  if (!names.length) return '-'
  return names.length > 1 ? `${names[0]} +${names.length - 1}` : names[0]
}

async function renderTextFile(doc, file, host, markdown) {
  if (file.length > TEXT_PREVIEW_LIMIT) {
    host.textContent = t('torrent.previewLarge')
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
  renderedButton.textContent = t('torrent.rendered')
  const rawButton = doc.createElement('button')
  rawButton.textContent = t('torrent.raw')
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
    content.textContent = t('torrent.markdownFailed', { message: localizeError(error) })
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
    const useBlobFallback = async () => {
      video.src = await getBlobUrl(file)
      video.load()
    }
    if (!navigator.serviceWorker?.controller) {
      await useBlobFallback()
      return
    }
    video.addEventListener('error', () => {
      useBlobFallback().catch((error) => {
        host.textContent = t('torrent.videoFallbackFailed', { message: localizeError(error) })
      })
    }, { once: true })
    file.streamTo(video)
    return
  }
  if (kind === 'image') {
    const image = doc.createElement('img')
    image.className = 'torrent-image'
    image.alt = file.name
    image.src = await getBlobUrl(file)
    host.appendChild(image)
    return
  }
  if (kind === 'text' || kind === 'markdown') {
    await renderTextFile(doc, file, host, kind === 'markdown')
    return
  }
  const link = doc.createElement('a')
  link.className = 'msg-file-link'
  link.textContent = t('torrent.download', { name: file.name })
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
      const magnet = normalizeMagnetUri(payload.magnet)
      const card = doc.createElement('section')
      card.className = 'torrent-card'

      const title = doc.createElement('strong')
      title.textContent = String(payload.title || t('torrent.shared'))
      const status = doc.createElement('div')
      status.className = 'torrent-status'
      status.textContent = t('torrent.loading')
      const network = doc.createElement('div')
      network.className = 'torrent-network'
      const trackerState = doc.createElement('span')
      trackerState.textContent = t('torrent.tracker', { tracker: trackerSummary(controller.trackers) })
      const peerState = doc.createElement('span')
      peerState.textContent = t('torrent.peers', { count: 0 })
      const connectionState = doc.createElement('span')
      connectionState.textContent = t('torrent.connection', { state: t('torrent.connecting') })
      network.append(trackerState, peerState, connectionState)
      const actions = doc.createElement('div')
      actions.className = 'torrent-actions'
      const preloadButton = doc.createElement('button')
      preloadButton.textContent = t('torrent.preload')
      preloadButton.disabled = true
      const copyButton = doc.createElement('button')
      copyButton.textContent = t('torrent.copyMagnet')
      actions.append(preloadButton, copyButton)
      const files = doc.createElement('div')
      files.className = 'torrent-files'
      const viewer = doc.createElement('div')
      viewer.className = 'torrent-viewer'
      card.append(title, status, network, actions, files, viewer)

      let currentTorrent = null
      let observedTorrent = null
      let attemptNumber = 0
      let preloadAction = 'loading'
      let updateProgress = () => {}
      let releaseTorrentObserver = () => {}

      const setConnection = (key) => {
        connectionState.textContent = t('torrent.connection', { state: t(key) })
      }
      const updateNetwork = () => {
        peerState.textContent = t('torrent.peers', { count: currentTorrent?.numPeers || 0 })
      }
      const observeTorrent = (torrent) => {
        currentTorrent = torrent
        updateNetwork()
        if (observedTorrent === torrent) return
        releaseTorrentObserver()
        observedTorrent = torrent
        releaseTorrentObserver = controller.observeTorrent(torrent, (event) => {
          updateNetwork()
          updateProgress()
          if (torrent.done) {
            setConnection('torrent.seeding')
            preloadButton.hidden = true
            return
          }
          if (event === 'wire') setConnection('torrent.connected')
          if (event === 'noPeers') setConnection('torrent.noPeers')
          if (event === 'trackerWarning') setConnection('torrent.trackerWarning')
          if (event === 'trackerError') setConnection('torrent.trackerError')
          if (event === 'done') {
            setConnection('torrent.seeding')
            preloadButton.hidden = true
          }
        })
      }

      card.roomHashDispose = () => {
        attemptNumber += 1
        releaseTorrentObserver()
        releaseTorrentObserver = () => {}
        observedTorrent = null
        currentTorrent = null
      }

      copyButton.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(magnet)
        copyButton.textContent = t('torrent.copied')
      })

      if (!isMagnetUri(magnet)) {
        status.textContent = t('torrent.invalid')
        preloadButton.disabled = true
        setConnection('torrent.invalidState')
        return card
      }

      const showTorrent = (torrent) => {
        currentTorrent = torrent
        preloadAction = 'preload'
        preloadButton.hidden = Boolean(torrent.done)
        preloadButton.disabled = false
        preloadButton.textContent = t('torrent.preload')
        setConnection(torrent.done ? 'torrent.seeding' : 'torrent.metadataReady')
        updateProgress = () => {
          status.textContent = t('torrent.progress', { progress: Math.round(torrent.progress * 100), peers: torrent.numPeers, speed: formatBytes(torrent.downloadSpeed) })
          updateNetwork()
          if (torrent.done) {
            setConnection('torrent.seeding')
            preloadButton.hidden = true
          }
        }
        updateProgress()

        files.replaceChildren()
        for (const file of torrent.files) {
          const button = doc.createElement('button')
          button.className = 'torrent-file'
          button.textContent = `${file.name} · ${formatBytes(file.length)}`
          button.addEventListener('click', async () => {
            setButtonBusy(button, true, t('torrent.opening'))
            try {
              file.select?.()
              await openTorrentFile(doc, file, viewer)
            } catch (error) {
              viewer.textContent = t('torrent.openFailed', { message: localizeError(error) })
            } finally {
              setButtonBusy(button, false, `${file.name} · ${formatBytes(file.length)}`)
            }
          })
          files.appendChild(button)
        }

        if (controller.autoPreload && !torrent.done) {
          controller.preload(torrent)
          preloadAction = 'preloading'
          preloadButton.disabled = true
          preloadButton.textContent = t('torrent.preloading')
        }
      }

      const connect = async () => {
        const attempt = ++attemptNumber
        preloadAction = 'loading'
        preloadButton.hidden = false
        preloadButton.disabled = true
        preloadButton.textContent = t('torrent.preload')
        status.textContent = t('torrent.loading')
        setConnection('torrent.connecting')
        try {
          const torrent = await controller.add(magnet, { onTorrent: observeTorrent })
          if (attempt !== attemptNumber) return
          showTorrent(torrent)
        } catch (error) {
          if (attempt !== attemptNumber) return
          preloadAction = 'retry'
          preloadButton.disabled = false
          preloadButton.textContent = t('torrent.retry')
          if (error?.code === 'ERR_TORRENT_METADATA_TIMEOUT') {
            status.textContent = t('torrent.noWebRtcSeed')
            setConnection('torrent.noPeers')
          } else {
            status.textContent = t('torrent.unavailable', { message: localizeError(error) })
            setConnection('torrent.failed')
          }
          updateNetwork()
        }
      }
      preloadButton.addEventListener('click', () => {
        if (preloadAction === 'retry') {
          connect()
          return
        }
        if (preloadAction !== 'preload' || !currentTorrent) return
        controller.preload(currentTorrent)
        preloadAction = 'preloading'
        preloadButton.disabled = true
        preloadButton.textContent = t('torrent.preloading')
      })
      connect()

      return card
    }
  }
}
