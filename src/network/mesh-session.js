import {
  createModuleMessage,
  createTextMessage,
  deserializeMessage,
  newMessageId,
  serializeMessage
} from '../message.js'
import { PeerSession } from '../session.js'
import {
  MESSAGE_LIFETIME_MS,
  PRESENCE_LIFETIME_MS,
  RelayLimiter,
  SeenMessageCache,
  createGossipEnvelope,
  gossipByteLength,
  validateGossipEnvelope
} from './gossip.js'

const PRESENCE_INTERVAL_MS = 20_000

export class MeshPeerSession extends PeerSession {
  constructor(opts) {
    const events = opts.events || {}
    super({ ...opts, events, getHistory: () => [] })
    this.meshEvents = events
    this.meshHistory = opts.getHistory || (() => [])
    this.getChannels = opts.getChannels || (() => [])
    this.getRelayPolicy = opts.getRelayPolicy || (() => ({}))
    this.runtimeCapabilities = opts.runtimeCapabilities || null
    this.relayLimiter = opts.relayLimiter || new RelayLimiter()
    this.seen = new SeenMessageCache()
    this._meshAction = null
    this._presenceTimer = null
  }

  async start() {
    await super.start()
    this._meshAction = this.room.makeAction('mesh-v1')
    this._meshAction.onMessage = (envelope, { peerId }) => {
      this._acceptEnvelope(envelope, peerId)
    }

    const baseJoin = this.room.onPeerJoin
    this.room.onPeerJoin = (peerId) => {
      baseJoin?.(peerId)
      this._announceTo(peerId).catch((error) => this.meshEvents.onError?.(error))
      setTimeout(() => this._detectPublicStatus(), 1500)
    }

    this._presenceTimer = setInterval(() => this.broadcastPresence(), PRESENCE_INTERVAL_MS)
    this.broadcastPresence()
    this.broadcastChannels()
    this._detectPublicStatus()
  }

  _messageEnvelope(message) {
    return createGossipEnvelope({
      id: `message:${message.id}`,
      kind: 'message',
      originId: message.peerId || this.selfId || 'local',
      payload: serializeMessage(message),
      createdAt: message.ts,
      lifetimeMs: MESSAGE_LIFETIME_MS
    })
  }

  async _announceTo(peerId) {
    const presence = this._presenceEnvelope()
    const channels = this._channelsEnvelope()
    this.seen.add(presence.id, presence.expiresAt)
    this.seen.add(channels.id, channels.expiresAt)
    await this._sendEnvelope(presence, peerId)
    await this._sendEnvelope(channels, peerId)
    for (const message of this.meshHistory().slice(-100)) {
      const envelope = this._messageEnvelope(message)
      if (validateGossipEnvelope(envelope)) {
        this.seen.add(envelope.id, envelope.expiresAt)
        await this._sendEnvelope(envelope, peerId)
      }
    }
  }

  _presenceEnvelope() {
    return createGossipEnvelope({
      id: `presence:${this.selfId || 'local'}:${Date.now()}`,
      kind: 'presence',
      originId: this.selfId || 'local',
      payload: { nickname: this.nickname, online: true },
      lifetimeMs: PRESENCE_LIFETIME_MS
    })
  }

  _channelsEnvelope() {
    return createGossipEnvelope({
      id: `channels:${this.selfId || 'local'}:${Date.now()}`,
      kind: 'channels',
      originId: this.selfId || 'local',
      payload: { channels: this.getChannels().slice(0, 100) },
      lifetimeMs: MESSAGE_LIFETIME_MS
    })
  }

  async _publishEnvelope(envelope) {
    this.seen.add(envelope.id, envelope.expiresAt)
    await this._forwardEnvelope(envelope)
  }

  async _acceptEnvelope(envelope, sourcePeerId) {
    const now = Date.now()
    if (!validateGossipEnvelope(envelope, now) || this.seen.has(envelope.id, now)) return
    this.seen.add(envelope.id, envelope.expiresAt)

    try {
      if (envelope.kind === 'message') {
        const message = deserializeMessage(envelope.payload)
        message.peerId = envelope.originId
        message.local = false
        this.meshEvents.onMessage?.(message)
      } else if (envelope.kind === 'presence') {
        this.meshEvents.onPresence?.({
          id: envelope.originId,
          nickname: String(envelope.payload?.nickname || 'Peer'),
          online: envelope.payload?.online !== false,
          expiresAt: envelope.expiresAt,
          direct: this.peerIds.has(envelope.originId)
        })
      } else if (envelope.kind === 'channels') {
        this.meshEvents.onChannels?.(envelope.payload?.channels || [], envelope.originId)
      }
    } catch (error) {
      this.meshEvents.onError?.(error instanceof Error ? error : new Error(String(error)))
      return
    }

    await this._forwardEnvelope(envelope, sourcePeerId)
  }

  async _forwardEnvelope(envelope, excludePeerId = null) {
    if (!this._meshAction || envelope.expiresAt <= Date.now()) return
    const targets = [...this.peerIds].filter((id) => id !== excludePeerId)
    await Promise.all(targets.map((target) => this._sendEnvelope(envelope, target)))
  }

  _sendEnvelope(envelope, target) {
    const send = () => this._meshAction?.send(envelope, { target })
    const policy = this.getRelayPolicy()
    if (this.runtimeCapabilities?.publicStatus?.public) {
      return this.relayLimiter.enqueue(send, gossipByteLength(envelope), policy)
    }
    return send()
  }

  async _detectPublicStatus() {
    if (!this.runtimeCapabilities) return
    const peers = Object.values(this.room?.getPeers?.() || {})
    try {
      const status = await this.runtimeCapabilities.detectPublicNode(peers)
      this.meshEvents.onPublicStatus?.(status)
    } catch (error) {
      this.meshEvents.onError?.(error instanceof Error ? error : new Error(String(error)))
    }
  }

  refreshPublicStatus() {
    return this._detectPublicStatus()
  }

  async sendText(text) {
    const message = createTextMessage({
      text,
      nickname: this.nickname,
      peerId: this.selfId || undefined,
      local: true
    })
    await this._publishEnvelope(this._messageEnvelope(message))
    this.meshEvents.onMessage?.(message)
    return message
  }

  async sendModule(module, payload, moduleVersion = 1) {
    const message = createModuleMessage({
      module,
      moduleVersion,
      payload,
      nickname: this.nickname,
      peerId: this.selfId || undefined,
      local: true
    })
    await this._publishEnvelope(this._messageEnvelope(message))
    this.meshEvents.onMessage?.(message)
    return message
  }

  broadcastPresence() {
    return this._publishEnvelope(this._presenceEnvelope())
  }

  broadcastChannels() {
    return this._publishEnvelope(this._channelsEnvelope())
  }

  setNickname(nickname) {
    super.setNickname(nickname)
    this.broadcastPresence()
  }

  leave() {
    clearInterval(this._presenceTimer)
    this._presenceTimer = null
    super.leave()
  }
}

export async function createMeshSession(opts) {
  const session = new MeshPeerSession(opts)
  await session.start()
  return session
}
