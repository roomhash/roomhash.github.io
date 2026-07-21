import { localizeError, t } from '../i18n.js'

export const WASM_APP_MODULE = 'wasm.app'
export const WASM_APP_EVENT_MODULE = 'wasm.app.event'
export const SUPPORTED_WASM_ABIS = new Set(['roomhash-pixel-grid-v1'])

const MAX_WASM_BYTES = 10 * 1024 * 1024
const TRUST_PREFIX = 'roomhash:wasm-trust:'

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(bytes) {
  return hex(await crypto.subtle.digest('SHA-256', bytes))
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function infoHashFromMagnet(magnet) {
  try {
    const exactTopic = new URL(String(magnet || '')).searchParams.getAll('xt')
      .find((value) => value.toLowerCase().startsWith('urn:btih:'))
    return exactTopic ? exactTopic.slice('urn:btih:'.length) : ''
  } catch {
    return ''
  }
}

function appendIdentity(identity, doc, label, value, className = '') {
  if (!value) return
  const row = doc.createElement('div')
  const term = doc.createElement('dt')
  term.textContent = label
  const detail = doc.createElement('dd')
  detail.textContent = value
  detail.title = value
  if (className) detail.className = className
  row.append(term, detail)
  identity.appendChild(row)
}

function validManifest(manifest) {
  return Boolean(
    manifest &&
    manifest.schema === 'roomhash.app/v1' &&
    typeof manifest.id === 'string' &&
    typeof manifest.entry === 'string' &&
    typeof manifest.sha256 === 'string' &&
    SUPPORTED_WASM_ABIS.has(manifest.abi)
  )
}

export async function detectWasmAppManifest(files) {
  const manifestFile = files.find((file) => /(^|\/)roomhash\.json$/i.test(file.webkitRelativePath || file.name))
  if (!manifestFile) return null
  try {
    const manifest = JSON.parse(await manifestFile.text())
    if (manifest.schema !== 'roomhash.app/v1' || !SUPPORTED_WASM_ABIS.has(manifest.abi)) return null
    const wasm = files.find((file) => {
      const path = file.webkitRelativePath || file.name
      return path === manifest.entry || path.endsWith(`/${manifest.entry}`)
    })
    if (!wasm || wasm.size > MAX_WASM_BYTES) return null
    const digest = await sha256(await wasm.arrayBuffer())
    if (manifest.sha256 && manifest.sha256.toLowerCase() !== digest) return null
    return { ...manifest, sha256: digest }
  } catch {
    return null
  }
}

function permissionPrompt(doc, manifest) {
  let trusted = false
  try { trusted = localStorage.getItem(`${TRUST_PREFIX}${manifest.sha256}`) === '1' } catch {}
  if (trusted) return Promise.resolve(true)

  if (!doc.createElement('dialog').showModal) {
    return Promise.resolve(doc.defaultView.confirm(t('wasm.permissionTitle', { name: manifest.name || manifest.id })))
  }

  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog')
    dialog.className = 'wasm-permission-dialog'
    const body = doc.createElement('div')
    body.className = 'wasm-permission-body'
    const title = doc.createElement('h3')
    title.textContent = t('wasm.permissionTitle', { name: manifest.name || manifest.id })
    const source = doc.createElement('p')
    source.textContent = t('wasm.permissionSource')
    const fingerprint = doc.createElement('p')
    fingerprint.textContent = t('wasm.permissionHash', { hash: `${manifest.sha256.slice(0, 12)}...${manifest.sha256.slice(-8)}` })
    const capabilityTitle = doc.createElement('strong')
    capabilityTitle.textContent = t('wasm.permissionList')
    const capabilities = doc.createElement('ul')
    for (const capability of manifest.permissions || []) {
      const item = doc.createElement('li')
      item.textContent = String(capability)
      capabilities.appendChild(item)
    }
    const isolation = doc.createElement('p')
    isolation.textContent = t('wasm.permissionIsolation')
    body.append(title, source, fingerprint, capabilityTitle, capabilities, isolation)

    const actions = doc.createElement('div')
    actions.className = 'wasm-permission-actions'
    const cancel = doc.createElement('button')
    cancel.textContent = t('common.cancel')
    const once = doc.createElement('button')
    once.textContent = t('wasm.runOnce')
    const trust = doc.createElement('button')
    trust.className = 'demo-action primary'
    trust.textContent = t('wasm.trustVersion')
    actions.append(cancel, once, trust)
    dialog.append(body, actions)
    doc.body.appendChild(dialog)

    const finish = (allowed, remember = false) => {
      if (remember) {
        try { localStorage.setItem(`${TRUST_PREFIX}${manifest.sha256}`, '1') } catch {}
      }
      dialog.close()
      dialog.remove()
      resolve(allowed)
    }
    cancel.addEventListener('click', () => finish(false))
    once.addEventListener('click', () => finish(true))
    trust.addEventListener('click', () => finish(true, true))
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(false)
    })
    dialog.showModal()
  })
}

function runtimeKey(channelId, instanceId, appHash) {
  return `${channelId}:${instanceId}:${appHash}`
}

export class WasmAppController {
  constructor({ torrentMedia, getActiveChannel, sendEvent }) {
    this.torrentMedia = torrentMedia
    this.getActiveChannel = getActiveChannel
    this.sendEvent = sendEvent
    this.listeners = new Map()
  }

  handleNetworkMessage(channelId, message) {
    if (message?.module !== WASM_APP_EVENT_MODULE) return false
    const payload = message.payload || {}
    const key = runtimeKey(channelId, payload.instanceId, payload.appHash)
    for (const listener of this.listeners.get(key) || []) listener(payload.event)
    return true
  }

  async launch(payload, mount, doc) {
    const manifest = payload.manifest
    if (!validManifest(manifest)) throw new Error(`unsupported ABI: ${manifest?.abi || 'unknown'}`)
    const torrent = await this.torrentMedia.add(payload.magnet)
    const file = torrent.files.find((item) => item.name === manifest.entry || item.path?.endsWith(`/${manifest.entry}`))
    if (!file) throw new Error(`missing WASM entry: ${manifest.entry}`)
    if (file.length > MAX_WASM_BYTES) throw new Error('WASM exceeds the 10 MB limit')
    const bytes = await (await file.blob()).arrayBuffer()
    const digest = await sha256(bytes)
    if (digest !== manifest.sha256.toLowerCase()) throw new Error('SHA-256 fingerprint mismatch')
    if (!await permissionPrompt(doc, manifest)) return false

    const channelId = this.getActiveChannel()
    const instanceId = String(payload.instanceId || manifest.id)
    const key = runtimeKey(channelId, instanceId, digest)
    const worker = new Worker(new URL('../workers/wasm-runtime.worker.js', import.meta.url), { type: 'module' })
    const shell = doc.createElement('section')
    shell.className = 'wasm-game-shell'
    const toolbar = doc.createElement('div')
    toolbar.className = 'wasm-game-toolbar'
    const name = doc.createElement('strong')
    name.textContent = manifest.name || manifest.id
    const fullscreen = doc.createElement('button')
    fullscreen.className = 'wasm-fullscreen-action'
    fullscreen.type = 'button'
    fullscreen.textContent = t('wasm.fullscreen')
    const stop = doc.createElement('button')
    stop.type = 'button'
    stop.textContent = t('wasm.stop')
    toolbar.append(name, fullscreen, stop)
    const palette = doc.createElement('div')
    palette.className = 'wasm-game-palette'
    const colors = ['#f5b84b', '#51d7b7', '#ff7b72', '#74b9ff']
    let flower = 1
    colors.forEach((color, index) => {
      const button = doc.createElement('button')
      button.className = `wasm-flower-choice${index === 0 ? ' active' : ''}`
      button.style.background = color
      button.title = t('wasm.flower', { number: index + 1 })
      button.addEventListener('click', () => {
        flower = index + 1
        for (const choice of palette.children) choice.classList.toggle('active', choice === button)
      })
      palette.appendChild(button)
    })
    const canvas = doc.createElement('canvas')
    canvas.className = 'wasm-game-canvas'
    shell.append(toolbar, palette, canvas)
    mount.replaceChildren(shell)

    const fullscreenElement = () => doc.fullscreenElement || doc.webkitFullscreenElement
    const updateFullscreen = () => {
      const active = fullscreenElement() === shell
      shell.classList.toggle('is-fullscreen', active)
      fullscreen.textContent = t(active ? 'wasm.exitFullscreen' : 'wasm.fullscreen')
      fullscreen.setAttribute('aria-pressed', String(active))
    }
    const onFullscreenChange = () => updateFullscreen()
    doc.addEventListener('fullscreenchange', onFullscreenChange)
    doc.addEventListener('webkitfullscreenchange', onFullscreenChange)
    fullscreen.addEventListener('click', async () => {
      try {
        if (fullscreenElement() === shell) {
          const exit = doc.exitFullscreen || doc.webkitExitFullscreen
          await exit?.call(doc)
        } else {
          const request = shell.requestFullscreen || shell.webkitRequestFullscreen
          if (!request) throw new Error(t('wasm.fullscreenUnavailable'))
          await request.call(shell)
        }
      } catch {
        fullscreen.textContent = t('wasm.fullscreenUnavailable')
      }
    })

    const listeners = this.listeners.get(key) || new Set()
    const receive = (event) => {
      if (!event || typeof event !== 'object') return
      if (event.kind === 'plant') worker.postMessage({ type: 'remote', event })
      if (event.kind === 'state-request') worker.postMessage({ type: 'snapshot-request' })
      if (event.kind === 'snapshot' && Array.isArray(event.cells)) worker.postMessage({ type: 'snapshot', cells: event.cells })
    }
    listeners.add(receive)
    this.listeners.set(key, listeners)

    const actor = crypto.getRandomValues(new Uint32Array(1))[0] || 1
    let lastPong = Date.now()
    let heartbeat = 0
    const send = (event) => this.sendEvent(channelId, { instanceId, appHash: digest, event }).catch(() => {})
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        canvas.width = data.width
        canvas.height = data.height
        send({ kind: 'state-request' })
      } else if (data.type === 'frame') {
        const context = canvas.getContext('2d')
        context.putImageData(new ImageData(new Uint8ClampedArray(data.pixels), data.width, data.height), 0, 0)
      } else if (data.type === 'event') {
        send(data.event)
      } else if (data.type === 'snapshot') {
        send({ kind: 'snapshot', cells: data.cells })
      } else if (data.type === 'pong') {
        lastPong = Date.now()
      } else if (data.type === 'error') {
        mount.textContent = t('wasm.invalid', { message: data.message })
      }
    })
    worker.addEventListener('error', (error) => {
      mount.textContent = t('wasm.invalid', { message: localizeError(error) })
    })
    canvas.addEventListener('pointerdown', (event) => {
      const rect = canvas.getBoundingClientRect()
      worker.postMessage({
        type: 'input',
        x: Math.floor((event.clientX - rect.left) * canvas.width / rect.width),
        y: Math.floor((event.clientY - rect.top) * canvas.height / rect.height),
        flower,
        actor
      })
    })

    const timer = setInterval(() => {
      if (Date.now() - lastPong > 5000) {
        worker.terminate()
        clearInterval(timer)
        doc.removeEventListener('fullscreenchange', onFullscreenChange)
        doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        mount.textContent = t('wasm.invalid', { message: 'execution timeout' })
        return
      }
      worker.postMessage({ type: 'ping' })
    }, 1500)
    stop.addEventListener('click', () => {
      clearInterval(timer)
      worker.terminate()
      listeners.delete(receive)
      doc.removeEventListener('fullscreenchange', onFullscreenChange)
      doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      if (fullscreenElement() === shell) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen
        exit?.call(doc)
      }
      mount.replaceChildren()
    })
    worker.postMessage({ type: 'load', bytes }, [bytes])
    return true
  }
}

export function createWasmAppModule(controller) {
  return {
    id: WASM_APP_MODULE,
    version: 1,
    render(message, { document: doc }) {
      const payload = message.payload || {}
      const manifest = payload.manifest || {}
      const card = doc.createElement('section')
      card.className = 'torrent-card wasm-app-card'
      const heading = doc.createElement('div')
      heading.className = 'wasm-app-heading'
      const title = doc.createElement('strong')
      title.className = 'wasm-app-title'
      title.textContent = manifest.name || payload.title || 'WASM App'
      heading.appendChild(title)
      if (manifest.version) {
        const version = doc.createElement('span')
        version.className = 'wasm-app-version'
        version.textContent = `v${manifest.version}`
        heading.appendChild(version)
      }
      const meta = doc.createElement('div')
      meta.className = 'wasm-app-meta'
      meta.textContent = `${t('wasm.type')} · ${manifest.abi || 'unknown ABI'}`
      const identity = doc.createElement('dl')
      identity.className = 'wasm-app-identity'
      const files = Array.isArray(payload.files) ? payload.files : []
      const entryFile = files.find((file) => file?.name === manifest.entry || file?.path?.endsWith(`/${manifest.entry}`)) || files[0]
      const fileName = entryFile?.name || manifest.entry
      const fileSize = formatBytes(entryFile?.size ?? entryFile?.length)
      appendIdentity(identity, doc, t('wasm.appId'), manifest.id)
      appendIdentity(identity, doc, t('wasm.file'), [fileName, fileSize].filter(Boolean).join(' · '))
      appendIdentity(identity, doc, t('wasm.infoHash'), infoHashFromMagnet(payload.magnet), 'wasm-app-hash')
      appendIdentity(identity, doc, t('wasm.sha256'), manifest.sha256, 'wasm-app-hash')
      const status = doc.createElement('p')
      status.className = 'wasm-app-status'
      const actions = doc.createElement('div')
      actions.className = 'wasm-app-actions'
      const run = doc.createElement('button')
      run.textContent = t('wasm.run')
      const copy = doc.createElement('button')
      copy.textContent = t('torrent.copyMagnet')
      actions.append(run, copy)
      const runtime = doc.createElement('div')
      runtime.className = 'wasm-app-runtime'
      card.append(heading, meta, identity, status, actions, runtime)

      if (!validManifest(manifest)) {
        status.textContent = t('wasm.unsupported', { abi: manifest.abi || 'unknown ABI' })
        run.disabled = true
      }
      run.addEventListener('click', async () => {
        run.disabled = true
        status.textContent = t('wasm.downloading')
        try {
          const started = await controller.launch(payload, runtime, doc)
          status.textContent = started ? t('wasm.running') : ''
          if (!started) run.disabled = false
        } catch (error) {
          status.textContent = t('wasm.invalid', { message: localizeError(error) })
          run.disabled = false
        }
      })
      copy.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(payload.magnet || '')
        copy.textContent = t('torrent.copied')
      })
      return card
    }
  }
}
