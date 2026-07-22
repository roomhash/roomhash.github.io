import { localizeAppMetadata } from '../appstore.js'
import { getLanguage, localizeError, t } from '../i18n.js'
import { renderWasmFormView } from './wasm-form-ui.js'
import { paintPortableScene } from './portable-surface.js'

export const WASM_APP_MODULE = 'wasm.app'
export const WASM_APP_EVENT_MODULE = 'wasm.app.event'
export const SUPPORTED_WASM_ABIS = new Set(['roomhash-pixel-grid-v1', 'roomhash-form-v1', 'portable-surface-v1'])

const MAX_WASM_BYTES = 10 * 1024 * 1024
const TRUST_PREFIX = 'roomhash:wasm-trust:'
const TRUST_VERSION = 'v2'

function appDisplayName(manifest, fallback = '') {
  return localizeAppMetadata(manifest, getLanguage()).name || fallback || manifest?.id || 'WASM App'
}

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

function normalizedWasmSha(manifest) {
  const value = String(manifest?.sha256 || '').trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(value) ? value : ''
}

export function normalizedWasmPermissions(manifest) {
  const permissions = Array.isArray(manifest?.permissions) ? manifest.permissions : []
  return [...new Set(permissions.filter((permission) => typeof permission === 'string'))].sort()
}

export function wasmTrustKey(manifest) {
  const digest = normalizedWasmSha(manifest)
  if (!digest) return ''
  const permissions = encodeURIComponent(JSON.stringify(normalizedWasmPermissions(manifest)))
  return `${TRUST_PREFIX}${TRUST_VERSION}:${digest}:${permissions}`
}

function trustStorage(doc) {
  try { return doc?.defaultView?.localStorage || null } catch { return null }
}

export function isWasmAppTrusted(doc, manifest) {
  const key = wasmTrustKey(manifest)
  if (!key) return false
  try { return trustStorage(doc)?.getItem(key) === '1' } catch { return false }
}

export function rememberWasmAppTrust(doc, manifest) {
  const key = wasmTrustKey(manifest)
  const storage = trustStorage(doc)
  if (!key || !storage) return false
  try {
    storage.setItem(key, '1')
    return storage.getItem(key) === '1'
  } catch {
    return false
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
  const base = Boolean(
    manifest &&
    manifest.schema === 'roomhash.app/v1' &&
    manifest.runtime === 'wasm' &&
    typeof manifest.id === 'string' &&
    typeof manifest.entry === 'string' &&
    typeof manifest.sha256 === 'string' &&
    SUPPORTED_WASM_ABIS.has(manifest.abi)
  )
  return base && (manifest.abi !== 'roomhash-pixel-grid-v1' || validNumericGridContract(manifest.legacyNumericGrid))
}

const NUMERIC_GRID_EXPORT_KEYS = [
  'width', 'height', 'framebufferPointer', 'framebufferLength', 'initialize',
  'write', 'merge', 'recordCount', 'recordActor', 'recordValue', 'recordClock'
]

function validNumericGridContract(contract) {
  if (contract?.schema !== 'roomhash.numeric-grid/v1') return false
  if (!Number.isInteger(contract.columns) || contract.columns < 1 || contract.columns > 256) return false
  if (!Number.isInteger(contract.rows) || contract.rows < 1 || contract.rows > 256) return false
  if (!contract.exports || NUMERIC_GRID_EXPORT_KEYS.some((key) => !/^rh_[a-z0-9_]{1,63}$/.test(contract.exports[key] || ''))) return false
  if (!Array.isArray(contract.controls) || contract.controls.length < 1 || contract.controls.length > 16) return false
  return contract.controls.every((control) =>
    Number.isInteger(control?.value) && control.value >= 0 && control.value <= 255 &&
    /^#[a-f0-9]{6}$/i.test(control.color || '') &&
    typeof control.label === 'string' && control.label.length >= 1 && control.label.length <= 48
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

export function permissionPrompt(doc, manifest) {
  if (isWasmAppTrusted(doc, manifest)) return Promise.resolve(true)

  if (!doc.createElement('dialog').showModal) {
    return Promise.resolve(doc.defaultView.confirm(t('wasm.permissionTitle', { name: appDisplayName(manifest) })))
  }

  return new Promise((resolve) => {
    const dialog = doc.createElement('dialog')
    dialog.className = 'wasm-permission-dialog'
    const body = doc.createElement('div')
    body.className = 'wasm-permission-body'
    const title = doc.createElement('h3')
    title.textContent = t('wasm.permissionTitle', { name: appDisplayName(manifest) })
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
      if (remember) rememberWasmAppTrust(doc, manifest)
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
  constructor({ torrentMedia, getActiveChannel, getIdentity, sendEvent }) {
    this.torrentMedia = torrentMedia
    this.getActiveChannel = getActiveChannel
    this.getIdentity = getIdentity
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

  async getLaunchState(payload, doc) {
    const manifest = payload?.manifest
    const trusted = validManifest(manifest) && isWasmAppTrusted(doc, manifest)
    const infoHash = infoHashFromMagnet(payload?.magnet).toLowerCase()
    if (!validManifest(manifest) || !infoHash || typeof this.torrentMedia?.hasCached !== 'function') {
      return { cached: false, trusted, canOpen: false }
    }
    const files = Array.isArray(payload?.files) ? payload.files : []
    const entryFile = files.find((file) => file?.name === manifest.entry || file?.path?.endsWith(`/${manifest.entry}`))
    let cached = false
    try {
      cached = Boolean(await this.torrentMedia.hasCached(infoHash, {
        entry: manifest.entry,
        size: entryFile?.size ?? entryFile?.length
      }))
    } catch {}
    return { cached, trusted, canOpen: cached && trusted }
  }

  async resolveFormValues(values) {
    const resolved = {}
    for (const [name, value] of Object.entries(values || {})) {
      if (!Array.isArray(value) || !value.every((item) => item && typeof item.arrayBuffer === 'function' && typeof item.name === 'string')) {
        resolved[name] = value
        continue
      }
      if (!value.length) {
        resolved[name] = []
        continue
      }
      const torrent = await this.torrentMedia.seed(value)
      resolved[name] = await Promise.all(value.map(async (file) => ({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        size: file.size,
        sha256: await sha256(await file.arrayBuffer()),
        magnet: torrent.magnetURI,
        webSeed: ''
      })))
    }
    return resolved
  }

  async resolveFormMedia(descriptor) {
    const torrent = await this.torrentMedia.add(String(descriptor?.magnet || ''))
    const file = torrent.files.find((item) => item.name === descriptor?.name || item.path?.endsWith(`/${descriptor?.name}`))
    if (!file) throw new Error('media file is unavailable')
    return URL.createObjectURL(await file.blob())
  }

  launchSurface({ manifest, bytes, digest, worker, mount, doc, channelId, instanceId, key, onStop }) {
    const shell = doc.createElement('section')
    shell.className = 'wasm-game-shell portable-surface-shell'
    const toolbar = doc.createElement('div')
    toolbar.className = 'wasm-game-toolbar portable-host-toolbar'
    const name = doc.createElement('strong')
    name.textContent = appDisplayName(manifest)
    const fullscreen = doc.createElement('button')
    fullscreen.type = 'button'
    fullscreen.textContent = t('wasm.fullscreen')
    const stop = doc.createElement('button')
    stop.type = 'button'
    stop.textContent = t('wasm.stop')
    toolbar.append(name, fullscreen, stop)
    const status = doc.createElement('p')
    status.className = 'wasm-app-status portable-surface-status'
    status.setAttribute('aria-live', 'polite')
    const stage = doc.createElement('div')
    stage.className = 'portable-surface-stage'
    const canvas = doc.createElement('canvas')
    canvas.className = 'portable-surface-canvas'
    canvas.tabIndex = 0
    stage.appendChild(canvas)
    shell.append(toolbar, status, stage)
    mount.replaceChildren(shell)

    const storage = doc.defaultView?.localStorage
    const identityKey = `roomhash:wasm-identity:${manifest.id}`
    let identitySeed = ''
    try { identitySeed = storage?.getItem(identityKey) || '' } catch {}
    if (!/^[a-f0-9]{64}$/i.test(identitySeed)) {
      identitySeed = hex(crypto.getRandomValues(new Uint8Array(32)))
      try { storage?.setItem(identityKey, identitySeed) } catch {}
    }
    const stateKey = `roomhash:wasm-state:${key}`
    let savedState = null
    try { savedState = JSON.parse(storage?.getItem(stateKey) || 'null') } catch {}
    const identity = this.getIdentity?.() || {}
    const context = {
      nickname: String(identity.nickname || ''), peerId: String(identity.peerId || ''),
      identitySeed, channelId, instanceId, savedState,
      locale: doc.documentElement.lang || 'zh-CN', theme: 'dark', nowMs: Date.now()
    }

    const listeners = this.listeners.get(key) || new Set()
    const receive = (event) => {
      if (!event || typeof event !== 'object') return
      if (event.kind === 'surface-event') worker.postMessage({ type: 'surface-input', input: { kind: 'remote', event: event.data } })
      if (event.kind === 'state-request') worker.postMessage({ type: 'surface-input', input: { kind: 'state-request' } })
      if (event.kind === 'surface-snapshot' && event.state) worker.postMessage({ type: 'surface-input', input: { kind: 'snapshot', state: event.state } })
    }
    listeners.add(receive)
    this.listeners.set(key, listeners)

    let currentScene = null
    let lastPong = Date.now()
    let timer = 0
    let stopped = false
    let resizeObserver = null
    let textInput = null
    let lastViewportAt = 0
    const media = new Map()
    const objectUrls = new Set()
    const fullscreenElement = () => doc.fullscreenElement || doc.webkitFullscreenElement
    const send = (event) => this.sendEvent(channelId, { instanceId, appHash: digest, event }).catch(() => {})
    const dispatch = (input) => worker.postMessage({
      type: 'surface-input', input: { ...input, nowMs: Date.now() }
    })
    const viewport = () => {
      const rect = stage.getBoundingClientRect()
      const width = Math.max(0, Math.floor(stage.clientWidth || rect.width))
      const height = Math.max(0, Math.floor(stage.clientHeight || rect.height))
      if (width > 0 && height > 0) dispatch({
        kind: 'viewport', width, height,
        dpr: Math.min(3, doc.defaultView.devicePixelRatio || 1), fullscreen: fullscreenElement() === shell
      })
      lastViewportAt = Date.now()
    }
    const setFullscreen = async (enabled) => {
      if (enabled && fullscreenElement() !== shell) {
        const request = shell.requestFullscreen || shell.webkitRequestFullscreen
        if (!request) throw new Error(t('wasm.fullscreenUnavailable'))
        await request.call(shell)
      } else if (!enabled && fullscreenElement() === shell) {
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen
        await exit?.call(doc)
      }
    }
    const openTextInput = (effect) => {
      textInput?.remove()
      const input = doc.createElement(effect.multiline ? 'textarea' : 'input')
      if (!effect.multiline) input.type = 'text'
      input.value = String(effect.value || '')
      input.inputMode = String(effect.inputMode || 'text')
      input.autocomplete = 'off'
      input.autocapitalize = 'sentences'
      input.spellcheck = true
      input.enterKeyHint = effect.multiline ? 'enter' : 'done'
      input.setAttribute('aria-label', String(effect.label || effect.requestId || 'Application input'))
      input.className = 'portable-surface-input-bridge'
      let composing = false
      let compositionEndedAt = -Infinity
      let lastPayload = `${input.value}\u0000${input.selectionStart ?? 0}\u0000${input.selectionEnd ?? 0}`
      const update = () => {
        if (composing) return
        const selectionStart = input.selectionStart ?? 0
        const selectionEnd = input.selectionEnd ?? 0
        const payload = `${input.value}\u0000${selectionStart}\u0000${selectionEnd}`
        if (payload === lastPayload) return
        lastPayload = payload
        dispatch({
          kind: 'text', requestId: String(effect.requestId || ''), value: input.value,
          selectionStart, selectionEnd
        })
      }
      input.addEventListener('compositionstart', () => { composing = true })
      input.addEventListener('compositionend', () => {
        composing = false
        compositionEndedAt = performance.now()
        update()
      })
      input.addEventListener('input', update)
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') { event.preventDefault(); input.blur(); return }
        if (event.key !== 'Enter' || effect.multiline) return
        const isImeCommit = composing || event.isComposing || event.keyCode === 229 ||
          performance.now() - compositionEndedAt < 80
        if (isImeCommit) return
        event.preventDefault()
        update()
        input.blur()
      })
      input.addEventListener('blur', () => {
        update()
        if (textInput === input) textInput = null
        input.remove()
        canvas.focus({ preventScroll: true })
      }, { once: true })
      textInput = input
      shell.appendChild(input)
      input.focus({ preventScroll: true })
      input.setSelectionRange?.(input.value.length, input.value.length)
    }
    const hostResult = (requestId, ok, value, error = '') => dispatch({ kind: 'host-result', requestId, ok, value, error })
    const saveImage = async (effect) => {
      if (!manifest.permissions?.includes('file.download')) throw new Error('file.download permission is required')
      if (!currentScene) throw new Error('no scene is available to export')
      const requested = effect.region && typeof effect.region === 'object' ? effect.region : {}
      const x = Math.max(0, Math.min(currentScene.width, Number(requested.x) || 0))
      const y = Math.max(0, Math.min(currentScene.height, Number(requested.y) || 0))
      const width = Math.max(1, Math.min(currentScene.width - x, Number(requested.width) || currentScene.width - x))
      const height = Math.max(1, Math.min(currentScene.height - y, Number(requested.height) || currentScene.height - y))
      const sourceScaleX = canvas.width / currentScene.width
      const sourceScaleY = canvas.height / currentScene.height
      const exportScale = Math.max(1, Math.min(2, sourceScaleX, sourceScaleY, Math.sqrt(16_000_000 / (width * height))))
      const output = doc.createElement('canvas')
      output.width = Math.max(1, Math.round(width * exportScale))
      output.height = Math.max(1, Math.round(height * exportScale))
      const context = output.getContext('2d')
      const background = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\))$/i.test(String(effect.background || ''))
        ? String(effect.background)
        : '#ffffff'
      context.fillStyle = background
      context.fillRect(0, 0, output.width, output.height)
      context.drawImage(
        canvas,
        x * sourceScaleX,
        y * sourceScaleY,
        width * sourceScaleX,
        height * sourceScaleY,
        0,
        0,
        output.width,
        output.height
      )
      const blob = await new Promise((resolve, reject) => output.toBlob((value) => value ? resolve(value) : reject(new Error('image encoding failed')), 'image/png'))
      const url = URL.createObjectURL(blob)
      objectUrls.add(url)
      const link = doc.createElement('a')
      const candidate = String(effect.filename || 'roomhash-app.png').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120)
      link.download = candidate.toLowerCase().endsWith('.png') ? candidate : `${candidate || 'roomhash-app'}.png`
      link.href = url
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
        objectUrls.delete(url)
      }, 0)
    }
    const handleEffect = async (effect) => {
      if (!effect || typeof effect.type !== 'string') return
      const requestId = String(effect.requestId || '')
      try {
        if (effect.type === 'fullscreen') await setFullscreen(Boolean(effect.enabled))
        else if (effect.type === 'announce') { status.textContent = String(effect.text || ''); return }
        else if (effect.type === 'text-input') { openTextInput(effect); return }
        else if (effect.type === 'random-bytes') {
          const length = Math.max(1, Math.min(64, Number(effect.length) || 32))
          hostResult(requestId, true, hex(crypto.getRandomValues(new Uint8Array(length))))
          return
        }
        else if (effect.type === 'clipboard-write') await doc.defaultView.navigator.clipboard.writeText(String(effect.text || ''))
        else if (effect.type === 'save-image') await saveImage(effect)
        else if (effect.type === 'pick-files') {
          const input = doc.createElement('input')
          input.type = 'file'
          input.multiple = Boolean(effect.multiple)
          input.accept = Array.isArray(effect.accept) ? effect.accept.join(',') : ''
          input.addEventListener('change', async () => {
            try {
              const resolved = await this.resolveFormValues({ files: [...(input.files || [])] })
              hostResult(requestId, true, resolved.files || [])
            } catch (error) { hostResult(requestId, false, null, localizeError(error)) }
          }, { once: true })
          input.click()
          return
        } else if (effect.type === 'load-media') {
          const url = await this.resolveFormMedia(effect.descriptor)
          objectUrls.add(url)
          const image = new doc.defaultView.Image()
          image.src = url
          await image.decode()
          media.set(requestId, image)
          if (currentScene) paintPortableScene(canvas, currentScene, { media })
        } else if (effect.type === 'open-media') {
          const url = await this.resolveFormMedia(effect.descriptor)
          objectUrls.add(url)
          doc.defaultView.open(url, '_blank', 'noopener,noreferrer')
        } else return
        if (requestId) hostResult(requestId, true, null)
      } catch (error) {
        if (requestId) hostResult(requestId, false, null, localizeError(error))
        status.textContent = localizeError(error)
      }
    }
    const cleanup = () => {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      resizeObserver?.disconnect()
      worker.terminate()
      listeners.delete(receive)
      textInput?.remove()
      for (const url of objectUrls) URL.revokeObjectURL(url)
      doc.removeEventListener('fullscreenchange', onFullscreenChange)
      doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      onStop?.()
    }
    const onFullscreenChange = () => {
      const active = fullscreenElement() === shell
      shell.classList.toggle('is-fullscreen', active)
      fullscreen.textContent = t(active ? 'wasm.exitFullscreen' : 'wasm.fullscreen')
      viewport()
    }

    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        send({ kind: 'state-request' })
        viewport()
      } else if (data.type === 'surface-scene') {
        currentScene = data.scene
        paintPortableScene(canvas, currentScene, { media })
      } else if (data.type === 'surface-effect') {
        handleEffect(data.effect)
      } else if (data.type === 'event') {
        send({ kind: 'surface-event', data: data.event })
      } else if (data.type === 'surface-snapshot') {
        send({ kind: 'surface-snapshot', state: data.state })
      } else if (data.type === 'persist') {
        try { storage?.setItem(stateKey, JSON.stringify(data.state)) } catch {}
      } else if (data.type === 'surface-error') {
        status.textContent = localizeError(data.message)
      } else if (data.type === 'pong') {
        lastPong = Date.now()
      } else if (data.type === 'error') {
        status.textContent = t('wasm.invalid', { message: data.message })
        cleanup()
      }
    })
    worker.addEventListener('error', (error) => { status.textContent = t('wasm.invalid', { message: localizeError(error) }); cleanup() })

    const point = (event) => {
      const rect = canvas.getBoundingClientRect()
      return { x: (event.clientX - rect.left) * (currentScene?.width || rect.width) / rect.width, y: (event.clientY - rect.top) * (currentScene?.height || rect.height) / rect.height }
    }
    for (const phase of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
      canvas.addEventListener(phase, (event) => {
        if (phase === 'pointerdown') { canvas.focus({ preventScroll: true }); canvas.setPointerCapture?.(event.pointerId) }
        for (const sample of phase === 'pointermove' ? event.getCoalescedEvents?.() || [event] : [event]) {
          const current = point(sample)
          dispatch({ kind: 'pointer', phase: phase.slice(7), pointerId: event.pointerId, x: current.x, y: current.y, buttons: event.buttons, pressure: event.pressure || 0 })
        }
      })
    }
    canvas.addEventListener('wheel', (event) => { event.preventDefault(); const current = point(event); dispatch({ kind: 'wheel', x: current.x, y: current.y, deltaX: event.deltaX, deltaY: event.deltaY }) }, { passive: false })
    canvas.addEventListener('keydown', (event) => dispatch({ kind: 'key', phase: 'down', key: event.key, code: event.code, repeat: event.repeat }))
    fullscreen.addEventListener('click', () => setFullscreen(fullscreenElement() !== shell).catch((error) => { status.textContent = localizeError(error) }))
    stop.addEventListener('click', () => { cleanup(); mount.replaceChildren() })
    doc.addEventListener('fullscreenchange', onFullscreenChange)
    doc.addEventListener('webkitfullscreenchange', onFullscreenChange)
    resizeObserver = new ResizeObserver(() => viewport())
    resizeObserver.observe(stage)
    timer = setInterval(() => {
      if (Date.now() - lastPong > 5000) { status.textContent = t('wasm.invalid', { message: 'execution timeout' }); cleanup(); return }
      if (Date.now() - lastViewportAt > 30_000) viewport()
      worker.postMessage({ type: 'ping' })
    }, 1500)
    worker.postMessage({ type: 'load', bytes, context }, [bytes])
    return true
  }

  launchForm({ payload, manifest, bytes, digest, worker, mount, doc, channelId, instanceId, key, onStop }) {
    const shell = doc.createElement('section')
    shell.className = 'wasm-game-shell wasm-form-shell'
    const toolbar = doc.createElement('div')
    toolbar.className = 'wasm-game-toolbar'
    const name = doc.createElement('strong')
    name.textContent = appDisplayName(manifest)
    const stop = doc.createElement('button')
    stop.type = 'button'
    stop.textContent = t('wasm.stop')
    toolbar.append(name, stop)
    const status = doc.createElement('p')
    status.className = 'wasm-app-status'
    const content = doc.createElement('div')
    content.className = 'wasm-form-content'
    shell.append(toolbar, status, content)
    mount.replaceChildren(shell)

    const storage = doc.defaultView?.localStorage
    const identityKey = `roomhash:wasm-identity:${manifest.id}`
    let identitySeed = ''
    try { identitySeed = storage?.getItem(identityKey) || '' } catch {}
    if (!/^[a-f0-9]{64}$/i.test(identitySeed)) {
      identitySeed = hex(crypto.getRandomValues(new Uint8Array(32)))
      try { storage?.setItem(identityKey, identitySeed) } catch {}
    }
    const stateKey = `roomhash:wasm-state:${key}`
    let savedState = null
    try { savedState = JSON.parse(storage?.getItem(stateKey) || 'null') } catch {}
    const identity = this.getIdentity?.() || {}
    const context = {
      nickname: String(identity.nickname || ''),
      peerId: String(identity.peerId || ''),
      identitySeed,
      channelId,
      instanceId,
      savedState
    }

    const listeners = this.listeners.get(key) || new Set()
    const receive = (event) => {
      if (!event || typeof event !== 'object') return
      if (event.kind === 'form-event') worker.postMessage({ type: 'form-remote', event: event.data })
      if (event.kind === 'state-request') worker.postMessage({ type: 'snapshot-request' })
      if (event.kind === 'form-snapshot' && event.state) worker.postMessage({ type: 'form-snapshot', state: event.state })
    }
    listeners.add(receive)
    this.listeners.set(key, listeners)

    let lastPong = Date.now()
    let stopped = false
    let timer = 0
    const objectUrls = new Set()
    const notifyStopped = () => {
      if (stopped) return
      stopped = true
      onStop?.()
    }
    const send = (event) => this.sendEvent(channelId, { instanceId, appHash: digest, event }).catch(() => {})
    const act = async (action, values) => {
      status.textContent = ''
      const resolved = await this.resolveFormValues(values)
      worker.postMessage({
        type: 'form-action',
        action,
        values: resolved,
        random: hex(crypto.getRandomValues(new Uint8Array(32)))
      })
    }
    worker.addEventListener('message', ({ data }) => {
      if (data.type === 'ready') {
        send({ kind: 'state-request' })
      } else if (data.type === 'view') {
        renderWasmFormView(doc, content, data.view, act, async (descriptor) => {
          const objectUrl = await this.resolveFormMedia(descriptor)
          objectUrls.add(objectUrl)
          return objectUrl
        })
      } else if (data.type === 'event') {
        send({ kind: 'form-event', data: data.event })
      } else if (data.type === 'form-snapshot') {
        send({ kind: 'form-snapshot', state: data.state })
      } else if (data.type === 'persist') {
        try { storage?.setItem(stateKey, JSON.stringify(data.state)) } catch {}
      } else if (data.type === 'form-error') {
        status.textContent = localizeError(data.message)
      } else if (data.type === 'pong') {
        lastPong = Date.now()
      } else if (data.type === 'error') {
        content.textContent = t('wasm.invalid', { message: data.message })
        worker.terminate()
        clearInterval(timer)
        listeners.delete(receive)
        for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
        notifyStopped()
      }
    })
    worker.addEventListener('error', (error) => {
      content.textContent = t('wasm.invalid', { message: localizeError(error) })
      worker.terminate()
      clearInterval(timer)
      listeners.delete(receive)
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
      notifyStopped()
    })
    timer = setInterval(() => {
      if (Date.now() - lastPong > 5000) {
        worker.terminate()
        clearInterval(timer)
        listeners.delete(receive)
        for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
        content.textContent = t('wasm.invalid', { message: 'execution timeout' })
        notifyStopped()
        return
      }
      worker.postMessage({ type: 'ping' })
    }, 1500)
    stop.addEventListener('click', () => {
      clearInterval(timer)
      worker.terminate()
      listeners.delete(receive)
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
      mount.replaceChildren()
      notifyStopped()
    })
    worker.postMessage({ type: 'load', bytes, context }, [bytes])
    return true
  }

  async launch(payload, mount, doc, { onStop } = {}) {
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
    if (manifest.abi === 'portable-surface-v1') {
      return this.launchSurface({ manifest, bytes, digest, worker, mount, doc, channelId, instanceId, key, onStop })
    }
    if (manifest.abi === 'roomhash-form-v1') {
      return this.launchForm({ payload, manifest, bytes, digest, worker, mount, doc, channelId, instanceId, key, onStop })
    }
    const shell = doc.createElement('section')
    shell.className = 'wasm-game-shell'
    const toolbar = doc.createElement('div')
    toolbar.className = 'wasm-game-toolbar'
    const name = doc.createElement('strong')
    name.textContent = appDisplayName(manifest)
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
    const legacyNumericGrid = manifest.legacyNumericGrid
    let selectedValue = legacyNumericGrid.controls[0].value
    legacyNumericGrid.controls.forEach((control, index) => {
      const button = doc.createElement('button')
      button.className = `wasm-value-choice${index === 0 ? ' active' : ''}`
      button.style.background = control.color
      button.title = control.label
      button.setAttribute('aria-label', control.label)
      button.addEventListener('click', () => {
        selectedValue = control.value
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
      if (event.kind === 'legacy-operation' && Array.isArray(event.values)) {
        worker.postMessage({ type: 'legacy-remote', values: event.values })
      }
      if (event.kind === 'state-request') worker.postMessage({ type: 'snapshot-request' })
      if (event.kind === 'legacy-snapshot' && Array.isArray(event.records)) {
        worker.postMessage({ type: 'legacy-snapshot', records: event.records })
      }
    }
    listeners.add(receive)
    this.listeners.set(key, listeners)

    const actor = crypto.getRandomValues(new Uint32Array(1))[0] || 1
    let lastPong = Date.now()
    let heartbeat = 0
    let stopped = false
    const notifyStopped = () => {
      if (stopped) return
      stopped = true
      onStop?.()
    }
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
        send({ kind: 'legacy-snapshot', records: data.records })
      } else if (data.type === 'pong') {
        lastPong = Date.now()
      } else if (data.type === 'error') {
        mount.textContent = t('wasm.invalid', { message: data.message })
        worker.terminate()
        clearInterval(timer)
        listeners.delete(receive)
        doc.removeEventListener('fullscreenchange', onFullscreenChange)
        doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        notifyStopped()
      }
    })
    worker.addEventListener('error', (error) => {
      mount.textContent = t('wasm.invalid', { message: localizeError(error) })
      worker.terminate()
      clearInterval(timer)
      listeners.delete(receive)
      doc.removeEventListener('fullscreenchange', onFullscreenChange)
      doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
      notifyStopped()
    })
    const postPointer = (event) => {
      const rect = canvas.getBoundingClientRect()
      worker.postMessage({
        type: 'legacy-input',
        x: Math.floor((event.clientX - rect.left) * canvas.width / rect.width),
        y: Math.floor((event.clientY - rect.top) * canvas.height / rect.height),
        value: selectedValue,
        actor
      })
    }
    canvas.addEventListener('pointerdown', postPointer)

    const timer = setInterval(() => {
      if (Date.now() - lastPong > 5000) {
        worker.terminate()
        clearInterval(timer)
        doc.removeEventListener('fullscreenchange', onFullscreenChange)
        doc.removeEventListener('webkitfullscreenchange', onFullscreenChange)
        mount.textContent = t('wasm.invalid', { message: 'execution timeout' })
        notifyStopped()
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
      notifyStopped()
    })
    worker.postMessage({ type: 'load', bytes, legacyNumericGrid }, [bytes])
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
      title.textContent = appDisplayName(manifest, payload.title)
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
      run.type = 'button'
      run.textContent = t('wasm.run')
      run.dataset.launchState = 'download'
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
      let launchState = { cached: false, trusted: false, canOpen: false }
      const refreshLaunchState = async () => {
        launchState = await controller.getLaunchState(payload, doc)
        run.dataset.launchState = launchState.canOpen ? 'open' : 'download'
        run.textContent = t(launchState.canOpen ? 'wasm.open' : 'wasm.run')
        return launchState
      }
      if (validManifest(manifest)) refreshLaunchState().catch(() => {})
      run.addEventListener('click', async () => {
        run.disabled = true
        try { await refreshLaunchState() } catch {}
        status.textContent = launchState.canOpen ? '' : t('wasm.downloading')
        try {
          const started = await controller.launch(payload, runtime, doc, {
            onStop: () => {
              run.disabled = false
              status.textContent = ''
              refreshLaunchState().catch(() => {})
            }
          })
          status.textContent = started ? t('wasm.running') : ''
          if (!started) run.disabled = false
          await refreshLaunchState()
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
