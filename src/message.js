/**
 * Chat message framing: text + file metadata payloads used by the app.
 * Pure serialize/deserialize — no DOM, no network.
 */

/**
 * @typedef {'text' | 'file' | 'system'} MessageType
 *
 * @typedef {object} FileMeta
 * @property {string} name
 * @property {string} mime
 * @property {number} size
 * @property {string} [id] local/transfer id
 *
 * @typedef {object} ChatMessage
 * @property {string} id
 * @property {MessageType} type
 * @property {string} nickname
 * @property {string} [peerId]
 * @property {number} ts
 * @property {string} [text]
 * @property {FileMeta} [file]
 * @property {string} [dataUrl] for images/files persisted as data URL
 * @property {boolean} [local] true if sent by this client
 */

/**
 * @returns {string}
 */
export function newMessageId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const MIME_TYPE_RE =
  /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i

/**
 * Keep MIME metadata safe for data URLs and HTML rendering.
 * @param {string | null | undefined} mime
 */
export function normalizeMimeType(mime) {
  const value = String(mime || 'application/octet-stream').trim().toLowerCase()
  return MIME_TYPE_RE.test(value) ? value : 'application/octet-stream'
}

/**
 * Build a text chat message object (the shape UI + P2P both use).
 * @param {{ text: string, nickname: string, peerId?: string, id?: string, ts?: number, local?: boolean }} input
 * @returns {ChatMessage}
 */
export function createTextMessage(input) {
  const text = String(input.text ?? '')
  if (!text.trim()) {
    throw new Error('text message cannot be empty')
  }
  return {
    id: input.id || newMessageId(),
    type: 'text',
    nickname: String(input.nickname || 'Anonymous'),
    peerId: input.peerId,
    ts: input.ts ?? Date.now(),
    text,
    local: Boolean(input.local)
  }
}

/**
 * Build a file/image message (metadata + optional dataUrl for local store / small payloads).
 * @param {{
 *   nickname: string,
 *   peerId?: string,
 *   file: { name: string, mime?: string, size: number, id?: string },
 *   dataUrl?: string,
 *   id?: string,
 *   ts?: number,
 *   local?: boolean
 * }} input
 * @returns {ChatMessage}
 */
export function createFileMessage(input) {
  const name = String(input.file?.name || 'file')
  const size = Number(input.file?.size ?? 0)
  if (!Number.isFinite(size) || size < 0) {
    throw new Error('invalid file size')
  }
  return {
    id: input.id || newMessageId(),
    type: 'file',
    nickname: String(input.nickname || 'Anonymous'),
    peerId: input.peerId,
    ts: input.ts ?? Date.now(),
    file: {
      name,
      mime: normalizeMimeType(input.file?.mime),
      size,
      id: input.file?.id || newMessageId()
    },
    dataUrl: input.dataUrl,
    local: Boolean(input.local)
  }
}

/**
 * Serialize a ChatMessage for P2P wire / storage (JSON-safe).
 * Omits large binary; file bytes travel separately or as dataUrl.
 * @param {ChatMessage} msg
 * @returns {string}
 */
export function serializeMessage(msg) {
  if (!msg || typeof msg !== 'object') {
    throw new Error('message required')
  }
  if (!msg.id || !msg.type || !msg.nickname || typeof msg.ts !== 'number') {
    throw new Error('message missing required fields')
  }
  if (msg.type === 'text' && typeof msg.text !== 'string') {
    throw new Error('text message requires text field')
  }
  if (msg.type === 'file' && (!msg.file || typeof msg.file.name !== 'string')) {
    throw new Error('file message requires file metadata')
  }
  const payload = {
    id: msg.id,
    type: msg.type,
    nickname: msg.nickname,
    peerId: msg.peerId,
    ts: msg.ts,
    text: msg.text,
    file: msg.file
      ? {
          name: msg.file.name,
          mime: msg.file.mime,
          size: msg.file.size,
          id: msg.file.id
        }
      : undefined,
    // dataUrl is included for small files so receivers can display without separate binary channel
    dataUrl: msg.dataUrl
  }
  return JSON.stringify(payload)
}

/**
 * Deserialize wire JSON into a ChatMessage.
 * @param {string} raw
 * @returns {ChatMessage}
 */
export function deserializeMessage(raw) {
  let obj
  try {
    obj = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    throw new Error('invalid message JSON')
  }
  if (!obj || typeof obj !== 'object') {
    throw new Error('invalid message object')
  }
  if (!obj.id || !obj.type || !obj.nickname || typeof obj.ts !== 'number') {
    throw new Error('message missing required fields')
  }
  if (obj.type === 'text') {
    return createTextMessage({
      id: obj.id,
      text: obj.text,
      nickname: obj.nickname,
      peerId: obj.peerId,
      ts: obj.ts,
      local: false
    })
  }
  if (obj.type === 'file') {
    return createFileMessage({
      id: obj.id,
      nickname: obj.nickname,
      peerId: obj.peerId,
      ts: obj.ts,
      file: {
        name: obj.file?.name,
        mime: obj.file?.mime,
        size: obj.file?.size,
        id: obj.file?.id
      },
      dataUrl: obj.dataUrl,
      local: false
    })
  }
  if (obj.type === 'system') {
    return {
      id: obj.id,
      type: 'system',
      nickname: obj.nickname,
      peerId: obj.peerId,
      ts: obj.ts,
      text: obj.text || ''
    }
  }
  throw new Error(`unknown message type: ${obj.type}`)
}

/**
 * File transfer framing for chunked binary assembly (when not using library auto-chunking).
 * Used by protocol tests and as a fallback path.
 *
 * Wire units:
 *   { kind: 'file-meta', transferId, name, mime, size, totalChunks }
 *   { kind: 'file-chunk', transferId, index, data: base64 }
 *   { kind: 'file-end', transferId }
 */

/**
 * @param {{ transferId: string, name: string, mime: string, size: number, chunkSize?: number }} meta
 * @param {Uint8Array | ArrayBuffer} bytes
 * @returns {{ meta: object, chunks: object[] }}
 */
export function frameFileTransfer(meta, bytes) {
  const buf =
    bytes instanceof ArrayBuffer
      ? new Uint8Array(bytes)
      : bytes instanceof Uint8Array
        ? bytes
        : new Uint8Array(bytes)
  const chunkSize = meta.chunkSize && meta.chunkSize > 0 ? meta.chunkSize : 16 * 1024
  const totalChunks = Math.max(1, Math.ceil(buf.length / chunkSize) || 1)
  const metaMsg = {
    kind: 'file-meta',
    transferId: meta.transferId,
    name: meta.name,
    mime: meta.mime || 'application/octet-stream',
    size: meta.size ?? buf.length,
    totalChunks
  }
  const chunks = []
  if (buf.length === 0) {
    chunks.push({
      kind: 'file-chunk',
      transferId: meta.transferId,
      index: 0,
      data: ''
    })
  } else {
    for (let i = 0; i < totalChunks; i++) {
      const start = i * chunkSize
      const slice = buf.subarray(start, start + chunkSize)
      chunks.push({
        kind: 'file-chunk',
        transferId: meta.transferId,
        index: i,
        data: bytesToBase64(slice)
      })
    }
  }
  return {
    meta: metaMsg,
    chunks,
    end: { kind: 'file-end', transferId: meta.transferId }
  }
}

/**
 * Assemble chunks back into bytes + file metadata.
 */
export class FileAssembler {
  constructor() {
    /** @type {Map<string, { meta: object, chunks: Map<number, string> }>} */
    this.transfers = new Map()
  }

  /**
   * @param {object} msg
   * @returns {null | { done: false } | { done: true, name: string, mime: string, size: number, bytes: Uint8Array }}
   */
  push(msg) {
    if (!msg || !msg.kind || !msg.transferId) {
      throw new Error('invalid file frame')
    }
    if (msg.kind === 'file-meta') {
      this.transfers.set(msg.transferId, {
        meta: msg,
        chunks: new Map()
      })
      return { done: false }
    }
    if (msg.kind === 'file-chunk') {
      let t = this.transfers.get(msg.transferId)
      if (!t) {
        t = { meta: null, chunks: new Map() }
        this.transfers.set(msg.transferId, t)
      }
      t.chunks.set(msg.index, msg.data)
      return { done: false }
    }
    if (msg.kind === 'file-end') {
      const t = this.transfers.get(msg.transferId)
      if (!t || !t.meta) {
        throw new Error('file-end without meta')
      }
      const { meta, chunks } = t
      const parts = []
      for (let i = 0; i < meta.totalChunks; i++) {
        if (!chunks.has(i)) {
          throw new Error(`missing chunk ${i}`)
        }
        parts.push(base64ToBytes(chunks.get(i)))
      }
      const total = parts.reduce((n, p) => n + p.length, 0)
      const bytes = new Uint8Array(total)
      let offset = 0
      for (const p of parts) {
        bytes.set(p, offset)
        offset += p.length
      }
      this.transfers.delete(msg.transferId)
      return {
        done: true,
        name: meta.name,
        mime: meta.mime,
        size: meta.size,
        bytes
      }
    }
    throw new Error(`unknown frame kind: ${msg.kind}`)
  }
}

/** @param {Uint8Array} bytes */
export function bytesToBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64')
  }
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

/** @param {string} b64 */
export function base64ToBytes(b64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'))
  }
  const binary = atob(b64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

/**
 * Convert ArrayBuffer/Uint8Array to a data URL (for local display / persistence).
 * @param {Uint8Array | ArrayBuffer} bytes
 * @param {string} mime
 */
export function bytesToDataUrl(bytes, mime) {
  const b64 = bytesToBase64(
    bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  )
  return `data:${normalizeMimeType(mime)};base64,${b64}`
}
