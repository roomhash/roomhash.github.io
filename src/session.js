/**
 * Peer session: discovery + text/file fan-out over a transport.
 *
 * Production transport: Trystero (@trystero-p2p/torrent) WebTorrent trackers + WebRTC.
 * Tests inject a LocalBusTransport (in-process two-peer simulation).
 */

import { APP_ID, DEFAULT_TRACKER } from './config.js'
import { isDefaultTracker, validateTrackerUrl } from './room-url.js'
import {
  createFileMessage,
  createTextMessage,
  deserializeMessage,
  serializeMessage,
  FileAssembler,
  frameFileTransfer,
  bytesToDataUrl,
  newMessageId
} from './message.js'

/**
 * @typedef {object} SessionEvents
 * @property {(peerId: string) => void} [onPeerJoin]
 * @property {(peerId: string) => void} [onPeerLeave]
 * @property {(msg: import('./message.js').ChatMessage) => void} [onMessage]
 * @property {(err: Error) => void} [onError]
 * @property {(peers: string[]) => void} [onPeersChanged]
 * @property {(status: string) => void} [onStatus]
 */

/**
 * Minimal room-like interface used by PeerSession (subset of Trystero room).
 * @typedef {object} RoomLike
 * @property {(peerId: string) => void} [onPeerJoin]
 * @property {(peerId: string) => void} [onPeerLeave]
 * @property {() => void} leave
 * @property {(actionId: string) => { send: Function, onMessage?: Function }} makeAction
 * @property {Record<string, unknown>} [getPeers]
 */

/**
 * @typedef {object} JoinRoomFn
 * @property {any} _brand
 */

/**
 * In-process multi-peer bus for unit tests (no WebRTC).
 * Each "join" creates a peer that can exchange action messages with others in the same roomId.
 */
export class LocalBusTransport {
  constructor() {
    /** @type {Map<string, Map<string, LocalRoom>>} roomId -> peerId -> room */
    this.rooms = new Map()
    this._seq = 0
  }

  /**
   * @param {object} config
   * @param {string} roomId
   */
  joinRoom = (config, roomId) => {
    const peerId = `local-peer-${++this._seq}`
    if (!this.rooms.has(roomId)) this.rooms.set(roomId, new Map())
    const peers = this.rooms.get(roomId)
    const room = new LocalRoom(this, roomId, peerId, peers)
    peers.set(peerId, room)

    // notify existing peers asynchronously (like network)
    queueMicrotask(() => {
      for (const [id, other] of peers) {
        if (id === peerId) continue
        if (typeof other.onPeerJoin === 'function') other.onPeerJoin(peerId)
        if (typeof room.onPeerJoin === 'function') room.onPeerJoin(id)
      }
    })

    return room
  }
}

class LocalRoom {
  /**
   * @param {LocalBusTransport} bus
   * @param {string} roomId
   * @param {string} peerId
   * @param {Map<string, LocalRoom>} peers
   */
  constructor(bus, roomId, peerId, peers) {
    this.bus = bus
    this.roomId = roomId
    this.peerId = peerId
    this.peers = peers
    /** @type {Map<string, { handlers: Set<Function> }>} */
    this.actions = new Map()
    this.onPeerJoin = null
    this.onPeerLeave = null
    this._left = false
  }

  makeAction(actionId) {
    if (!this.actions.has(actionId)) {
      this.actions.set(actionId, { handlers: new Set() })
    }
    const entry = this.actions.get(actionId)
    const action = {
      send: async (data, opts = {}) => {
        if (this._left) return
        const targets =
          opts.target == null
            ? [...this.peers.keys()].filter((id) => id !== this.peerId)
            : Array.isArray(opts.target)
              ? opts.target
              : [opts.target]
        for (const tid of targets) {
          const other = this.peers.get(tid)
          if (!other || other._left) continue
          const otherAction = other.actions.get(actionId)
          if (!otherAction) continue
          const payload = data
          for (const h of otherAction.handlers) {
            queueMicrotask(() => h(payload, { peerId: this.peerId, metadata: opts.metadata }))
          }
        }
      },
      set onMessage(fn) {
        entry.handlers.add(fn)
      },
      get onMessage() {
        return [...entry.handlers][0]
      }
    }
    return action
  }

  leave() {
    if (this._left) return
    this._left = true
    this.peers.delete(this.peerId)
    for (const other of this.peers.values()) {
      if (typeof other.onPeerLeave === 'function') other.onPeerLeave(this.peerId)
    }
  }

  getPeers() {
    const out = {}
    for (const id of this.peers.keys()) {
      if (id !== this.peerId) out[id] = {}
    }
    return out
  }
}

/**
 * High-level chat session over RoomLike transport.
 */
export class PeerSession {
  /**
   * @param {object} opts
   * @param {string} opts.roomId
   * @param {string} [opts.tracker]
   * @param {string} opts.nickname
   * @param {SessionEvents} [opts.events]
   * @param {(config: object, roomId: string) => RoomLike} [opts.joinRoom] inject transport
   * @param {boolean} [opts.useFileActions=true] send files via binary action when available
   */
  constructor(opts) {
    this.roomId = opts.roomId
    const tracker = validateTrackerUrl(opts.tracker || DEFAULT_TRACKER)
    if (!tracker.ok) throw new Error(tracker.error)
    this.tracker = tracker.tracker
    this.nickname = opts.nickname
    this.events = opts.events || {}
    this.joinRoomFn = opts.joinRoom || null
    this.useFileActions = opts.useFileActions !== false
    /** @type {RoomLike | null} */
    this.room = null
    /** @type {Set<string>} */
    this.peerIds = new Set()
    /** @type {Map<string, string>} peerId -> nickname */
    this.peerNicks = new Map()
    this.selfId = null
    this._chatAction = null
    this._nickAction = null
    this._fileAction = null
    this._fileWireAction = null
    this._relaySockets = []
    this.assembler = new FileAssembler()
    this._started = false
  }

  /**
   * Build Trystero config for torrent strategy.
   */
  buildTrysteroConfig() {
    const config = {
      appId: APP_ID
    }
    // Preserve Trystero's deterministic three-tracker redundancy by default.
    // A custom tracker intentionally opts out so shared links use exactly it.
    if (!isDefaultTracker(this.tracker)) {
      config.relayConfig = { urls: [this.tracker] }
    }
    return config
  }

  async start() {
    if (this._started) return
    this._started = true

    let joinRoom = this.joinRoomFn
    let getRelaySockets = null
    if (!joinRoom) {
      const mod = await import('@trystero-p2p/torrent')
      joinRoom = mod.joinRoom
      getRelaySockets = mod.getRelaySockets
    }

    const config = this.buildTrysteroConfig()
    this.events.onStatus?.('connecting')
    this.room = joinRoom(config, this.roomId, {
      onJoinError: ({ error, peerId }) => {
        const peer = peerId ? ` ${peerId.slice(0, 6)}` : ''
        const message = `peer${peer} connection failed: ${error}`
        this.events.onError?.(new Error(message))
        this.events.onStatus?.(message)
      }
    })

    // Try to read selfId from module when using trystero
    try {
      if (!this.joinRoomFn) {
        const mod = await import('@trystero-p2p/torrent')
        this.selfId = mod.selfId
      } else if (this.room.peerId) {
        this.selfId = this.room.peerId
      }
    } catch {
      // ignore
    }

    this._chatAction = this.room.makeAction('chat')
    this._nickAction = this.room.makeAction('nick')
    this._fileAction = this.room.makeAction('file')
    // Explicit chunk wire for protocol tests / fallback assembly path
    this._fileWireAction = this.room.makeAction('file-wire')

    if (getRelaySockets) {
      this._watchRelaySockets(getRelaySockets)
    }

    this.room.onPeerJoin = (peerId) => {
      this.peerIds.add(peerId)
      this.events.onPeerJoin?.(peerId)
      this.events.onPeersChanged?.([...this.peerIds])
      this._updateConnectionStatus()
      // introduce ourselves
      this._nickAction.send(this.nickname, { target: peerId })
    }

    this.room.onPeerLeave = (peerId) => {
      this.peerIds.delete(peerId)
      this.peerNicks.delete(peerId)
      this.events.onPeerLeave?.(peerId)
      this.events.onPeersChanged?.([...this.peerIds])
      this._updateConnectionStatus()
    }

    this._chatAction.onMessage = (data, { peerId }) => {
      try {
        const raw = typeof data === 'string' ? data : JSON.stringify(data)
        const msg = deserializeMessage(raw)
        msg.peerId = peerId
        msg.local = false
        if (msg.nickname) this.peerNicks.set(peerId, msg.nickname)
        this.events.onMessage?.(msg)
      } catch (err) {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }

    this._nickAction.onMessage = (nick, { peerId }) => {
      this.peerNicks.set(peerId, String(nick))
    }

    // Trystero auto-chunk binary with metadata
    this._fileAction.onMessage = (data, { peerId, metadata }) => {
      try {
        const bytes =
          data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : data instanceof Uint8Array
              ? data
              : new Uint8Array(data)
        const name = metadata?.name || 'file'
        const mime = metadata?.mime || 'application/octet-stream'
        const size = metadata?.size ?? bytes.byteLength
        const dataUrl = bytesToDataUrl(bytes, mime)
        const msg = createFileMessage({
          nickname: this.peerNicks.get(peerId) || metadata?.nickname || 'Peer',
          peerId,
          file: { name, mime, size, id: metadata?.id },
          dataUrl,
          local: false
        })
        this.events.onMessage?.(msg)
      } catch (err) {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }

    // Manual chunk path (LocalBus / protocol tests)
    this._fileWireAction.onMessage = (frame, { peerId }) => {
      try {
        const result = this.assembler.push(frame)
        if (result && result.done) {
          const dataUrl = bytesToDataUrl(result.bytes, result.mime)
          const msg = createFileMessage({
            nickname: this.peerNicks.get(peerId) || 'Peer',
            peerId,
            file: {
              name: result.name,
              mime: result.mime,
              size: result.size
            },
            dataUrl,
            local: false
          })
          this.events.onMessage?.(msg)
        }
      } catch (err) {
        this.events.onError?.(err instanceof Error ? err : new Error(String(err)))
      }
    }

    this._updateConnectionStatus()
  }

  _watchRelaySockets(getRelaySockets) {
    this._relaySockets = Object.values(getRelaySockets())
    const update = () => this._updateConnectionStatus()
    for (const socket of this._relaySockets) {
      socket.addEventListener?.('open', update)
      socket.addEventListener?.('close', update)
      socket.addEventListener?.('error', update)
    }
  }

  _updateConnectionStatus() {
    if (!this._started) return
    if (this.peerIds.size > 0) {
      const suffix = this.peerIds.size === 1 ? 'peer' : 'peers'
      this.events.onStatus?.(`connected · ${this.peerIds.size} ${suffix}`)
      return
    }
    if (this.joinRoomFn) {
      this.events.onStatus?.('waiting for peers · local transport')
      return
    }
    const open = this._relaySockets.filter((socket) => socket.readyState === 1).length
    if (open > 0) {
      this.events.onStatus?.(
        `waiting for peers · trackers ${open}/${this._relaySockets.length}`
      )
    } else if (this._relaySockets.length > 0) {
      this.events.onStatus?.(`connecting trackers · 0/${this._relaySockets.length}`)
    } else {
      this.events.onStatus?.('initializing trackers')
    }
  }

  /**
   * @param {string} nickname
   */
  setNickname(nickname) {
    this.nickname = nickname
    this._nickAction?.send(nickname)
  }

  /**
   * Send a text chat message to all peers.
   * @param {string} text
   * @returns {Promise<import('./message.js').ChatMessage>}
   */
  async sendText(text) {
    const msg = createTextMessage({
      text,
      nickname: this.nickname,
      peerId: this.selfId || undefined,
      local: true
    })
    const wire = serializeMessage(msg)
    await this._chatAction?.send(wire)
    this.events.onMessage?.(msg)
    return msg
  }

  /**
   * Send a file/image. Uses binary action when possible; also supports chunk wire.
   * @param {{ name: string, mime?: string, size?: number, bytes: Uint8Array | ArrayBuffer }} file
   * @param {{ mode?: 'binary' | 'wire' }} [opts]
   * @returns {Promise<import('./message.js').ChatMessage>}
   */
  async sendFile(file, opts = {}) {
    const bytes =
      file.bytes instanceof ArrayBuffer
        ? new Uint8Array(file.bytes)
        : file.bytes instanceof Uint8Array
          ? file.bytes
          : new Uint8Array(file.bytes)
    const name = file.name || 'file'
    const mime = file.mime || 'application/octet-stream'
    const size = file.size ?? bytes.byteLength
    const transferId = newMessageId()
    const dataUrl = bytesToDataUrl(bytes, mime)

    const msg = createFileMessage({
      nickname: this.nickname,
      peerId: this.selfId || undefined,
      file: { name, mime, size, id: transferId },
      dataUrl,
      local: true
    })

    const mode = opts.mode || (this.useFileActions ? 'binary' : 'wire')

    if (mode === 'wire') {
      const framed = frameFileTransfer(
        { transferId, name, mime, size, chunkSize: 8 * 1024 },
        bytes
      )
      await this._fileWireAction?.send(framed.meta)
      for (const chunk of framed.chunks) {
        await this._fileWireAction?.send(chunk)
      }
      await this._fileWireAction?.send(framed.end)
    } else {
      // Trystero binary path with metadata
      await this._fileAction?.send(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
        metadata: {
          name,
          mime,
          size,
          id: transferId,
          nickname: this.nickname
        }
      })
    }

    this.events.onMessage?.(msg)
    return msg
  }

  getPeers() {
    return [...this.peerIds]
  }

  getPeerNickname(peerId) {
    return this.peerNicks.get(peerId) || peerId
  }

  leave() {
    try {
      this.room?.leave()
    } catch {
      // ignore
    }
    this.room = null
    this.peerIds.clear()
    this._relaySockets = []
    this._started = false
    this.events.onStatus?.('left')
  }
}

/**
 * Factory used by the app: real torrent transport.
 * @param {object} opts
 */
export async function createTorrentSession(opts) {
  const session = new PeerSession(opts)
  await session.start()
  return session
}
