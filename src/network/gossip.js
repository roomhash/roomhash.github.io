export const MESSAGE_LIFETIME_MS = 10 * 60 * 1000
export const PRESENCE_LIFETIME_MS = 60 * 1000

export class SeenMessageCache {
  constructor({ maxEntries = 5000 } = {}) {
    this.maxEntries = maxEntries
    this.entries = new Map()
  }

  has(id, now = Date.now()) {
    this.prune(now)
    return this.entries.has(id)
  }

  add(id, expiresAt) {
    this.entries.set(id, expiresAt)
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value)
    }
  }

  prune(now = Date.now()) {
    for (const [id, expiresAt] of this.entries) {
      if (expiresAt <= now) this.entries.delete(id)
    }
  }
}

export class RelayLimiter {
  constructor() {
    this.nextAt = 0
    this.queue = Promise.resolve()
  }

  enqueue(task, byteLength, policy = {}) {
    const bytesPerSecond = Math.max(0, Number(policy.bandwidthKbps || 0) * 1024)
    const messagesPerSecond = Math.max(0, Number(policy.messagesPerSecond || 0))
    const byteDelay = bytesPerSecond ? (byteLength / bytesPerSecond) * 1000 : 0
    const messageDelay = messagesPerSecond ? 1000 / messagesPerSecond : 0
    const spacing = Math.max(byteDelay, messageDelay)

    this.queue = this.queue.then(async () => {
      const now = Date.now()
      const wait = Math.max(0, this.nextAt - now)
      if (wait) await new Promise((resolve) => setTimeout(resolve, wait))
      this.nextAt = Math.max(Date.now(), this.nextAt) + spacing
      return task()
    })
    return this.queue
  }
}

export function createGossipEnvelope({ id, kind, originId, payload, createdAt, lifetimeMs }) {
  const now = Number(createdAt ?? Date.now())
  const lifetime = Number(lifetimeMs ?? MESSAGE_LIFETIME_MS)
  return {
    version: 1,
    id: String(id),
    kind: String(kind),
    originId: String(originId || 'unknown'),
    createdAt: now,
    expiresAt: now + lifetime,
    payload
  }
}

export function validateGossipEnvelope(envelope, now = Date.now()) {
  if (!envelope || envelope.version !== 1) return false
  if (typeof envelope.id !== 'string' || !envelope.id || envelope.id.length > 160) return false
  if (!['message', 'presence', 'channels'].includes(envelope.kind)) return false
  if (typeof envelope.originId !== 'string' || !envelope.originId) return false
  if (!Number.isFinite(envelope.createdAt) || !Number.isFinite(envelope.expiresAt)) return false
  if (envelope.createdAt > now + 60_000) return false
  const maxLifetime = envelope.kind === 'presence' ? PRESENCE_LIFETIME_MS : MESSAGE_LIFETIME_MS
  if (envelope.expiresAt > envelope.createdAt + maxLifetime) return false
  if (envelope.expiresAt <= now) return false
  return envelope.payload != null
}

export function gossipByteLength(envelope) {
  return new TextEncoder().encode(JSON.stringify(envelope)).byteLength
}
