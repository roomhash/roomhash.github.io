const BALLOT_SCHEMA = 'roomhash.vote/ballot-v1'
const FRAME_SCHEMA = 'roomhash.vote/frame-v1'
const MAX_HOPS = 16
const MAX_NICK = 80
const MAX_ID = 128
const MAX_INVENTORY = 2000
const encoder = new TextEncoder()

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cleanString(value, name, max = MAX_ID) {
  const result = String(value ?? '').trim()
  assert(result.length > 0 && result.length <= max, `invalid ${name}`)
  return result
}

function canonicalBallot(ballot) {
  return JSON.stringify([
    BALLOT_SCHEMA,
    ballot.pollId,
    ballot.voterHash,
    ballot.nick,
    ballot.optionId,
    ballot.revision,
    ballot.updatedAt
  ])
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value) {
  const cryptoApi = globalThis.crypto
  assert(cryptoApi?.subtle, 'Web Crypto SHA-256 is required')
  return hex(await cryptoApi.subtle.digest('SHA-256', encoder.encode(value)))
}

export async function hashUserIdentity(identity) {
  return sha256(cleanString(identity, 'identity', 1024))
}

export function normalizeBallot(input, poll) {
  const voterHash = cleanString(input.voterHash, 'voterHash').toLowerCase()
  assert(/^[a-z0-9:_-]{8,128}$/.test(voterHash), 'invalid voterHash format')
  const optionId = cleanString(input.optionId, 'optionId', 64)
  assert(poll.options.some((option) => option.id === optionId), 'unknown optionId')
  const revision = Number(input.revision)
  const updatedAt = Number(input.updatedAt)
  assert(Number.isSafeInteger(revision) && revision >= 1, 'invalid revision')
  assert(Number.isSafeInteger(updatedAt) && updatedAt >= 0, 'invalid updatedAt')
  return Object.freeze({
    schema: BALLOT_SCHEMA,
    pollId: poll.id,
    voterHash,
    nick: cleanString(input.nick, 'nick', MAX_NICK),
    optionId,
    revision,
    updatedAt
  })
}

export async function makeBallot(input, poll) {
  const ballot = normalizeBallot(input, poll)
  return Object.freeze({ ...ballot, eventId: await sha256(canonicalBallot(ballot)) })
}

export async function verifyBallot(input, poll) {
  try {
    const ballot = normalizeBallot(input, poll)
    const eventId = cleanString(input.eventId, 'eventId', 64).toLowerCase()
    if (!/^[a-f0-9]{64}$/.test(eventId)) return null
    if (eventId !== await sha256(canonicalBallot(ballot))) return null
    return Object.freeze({ ...ballot, eventId })
  } catch {
    return null
  }
}

function compareBallots(left, right) {
  if (!right) return 1
  if (left.revision !== right.revision) return left.revision - right.revision
  return left.eventId.localeCompare(right.eventId)
}

function validatePoll(poll) {
  assert(poll && typeof poll === 'object', 'poll is required')
  const id = cleanString(poll.id, 'poll.id')
  const title = cleanString(poll.title, 'poll.title', 200)
  assert(Array.isArray(poll.options) && poll.options.length >= 2 && poll.options.length <= 64, 'poll needs 2-64 options')
  const options = poll.options.map((option) => ({
    id: cleanString(option.id, 'option.id', 64),
    label: cleanString(option.label, 'option.label', 120)
  }))
  assert(new Set(options.map((option) => option.id)).size === options.length, 'duplicate option id')
  return Object.freeze({ id, title, options: Object.freeze(options) })
}

function validFrameShape(frame, pollId) {
  return Boolean(
    frame && frame.schema === FRAME_SCHEMA && frame.pollId === pollId &&
    typeof frame.frameId === 'string' && /^[a-f0-9]{64}$/.test(frame.frameId) &&
    typeof frame.originId === 'string' && frame.originId.length <= MAX_ID &&
    (frame.destinationId == null || (typeof frame.destinationId === 'string' && frame.destinationId.length <= MAX_ID)) &&
    Number.isInteger(frame.hops) && frame.hops >= 0 && frame.hops <= MAX_HOPS &&
    Number.isInteger(frame.maxHops) && frame.maxHops >= 1 && frame.maxHops <= MAX_HOPS &&
    typeof frame.type === 'string' && frame.payload && typeof frame.payload === 'object'
  )
}

export class VotingNode {
  constructor({ nodeId, poll, send, now = () => Date.now(), persist = () => {} }) {
    this.nodeId = cleanString(nodeId, 'nodeId')
    this.poll = validatePoll(poll)
    assert(typeof send === 'function', 'send callback is required')
    this.send = send
    this.now = now
    this.persist = persist
    this.current = new Map()
    this.events = new Map()
    this.seenFrames = new Set()
    this.sequence = 0
    this.stats = { accepted: 0, duplicateFrames: 0, forwarded: 0, rejected: 0 }
  }

  async _newFrame(type, payload, destinationId = null) {
    const nonce = `${this.nodeId}\n${++this.sequence}\n${this.now()}\n${type}`
    return {
      schema: FRAME_SCHEMA,
      pollId: this.poll.id,
      frameId: await sha256(nonce),
      originId: this.nodeId,
      destinationId,
      hops: 0,
      maxHops: MAX_HOPS,
      type,
      payload
    }
  }

  async _emit(type, payload, destinationId = null, options = {}) {
    const frame = await this._newFrame(type, payload, destinationId)
    this.seenFrames.add(frame.frameId)
    await this.send(frame, options)
    return frame
  }

  _apply(ballot) {
    this.events.set(ballot.eventId, ballot)
    const previous = this.current.get(ballot.voterHash)
    if (compareBallots(ballot, previous) <= 0) return false
    this.current.set(ballot.voterHash, ballot)
    this.stats.accepted += 1
    this.persist(this.exportState())
    return true
  }

  async cast(input) {
    const ballot = await makeBallot({ ...input, updatedAt: input.updatedAt ?? this.now() }, this.poll)
    this._apply(ballot)
    await this._emit('ballot', { ballot })
    return ballot
  }

  async receive(frame, sourcePeerId = null) {
    if (!validFrameShape(frame, this.poll.id) || frame.hops > frame.maxHops) {
      this.stats.rejected += 1
      return false
    }
    if (this.seenFrames.has(frame.frameId)) {
      this.stats.duplicateFrames += 1
      return false
    }
    this.seenFrames.add(frame.frameId)

    const isDestination = frame.destinationId == null || frame.destinationId === this.nodeId
    let accepted = true
    if (isDestination) accepted = await this._process(frame)

    // A broadcast keeps flooding. An addressed frame may cross intermediaries,
    // but the destination consumes it and terminates that route.
    const reachedDestination = frame.destinationId === this.nodeId
    if (accepted && !reachedDestination && frame.hops < frame.maxHops) {
      const forwarded = { ...frame, hops: frame.hops + 1 }
      await this.send(forwarded, { excludePeerId: sourcePeerId })
      this.stats.forwarded += 1
    }
    return accepted
  }

  async _process(frame) {
    if (frame.type === 'ballot') {
      const ballot = await verifyBallot(frame.payload.ballot, this.poll)
      if (!ballot) return this._reject()
      this._apply(ballot)
      return true
    }

    if (frame.type === 'inventory') {
      const entries = frame.payload.entries
      if (!Array.isArray(entries) || entries.length > MAX_INVENTORY) return this._reject()
      const wants = []
      for (const entry of entries) {
        if (!entry || typeof entry.voterHash !== 'string' || typeof entry.eventId !== 'string') continue
        if (this.current.get(entry.voterHash)?.eventId !== entry.eventId) wants.push(entry.eventId)
      }
      if (wants.length) await this._emit('want', { eventIds: [...new Set(wants)] }, frame.originId)
      if (frame.payload.replyRequested) await this._sendInventory(frame.originId, false)
      return true
    }

    if (frame.type === 'want') {
      const ids = frame.payload.eventIds
      if (!Array.isArray(ids) || ids.length > MAX_INVENTORY) return this._reject()
      const ballots = ids.map((id) => this.events.get(id)).filter(Boolean)
      if (ballots.length) await this._emit('ballots', { ballots }, frame.originId)
      return true
    }

    if (frame.type === 'ballots') {
      const inputs = frame.payload.ballots
      if (!Array.isArray(inputs) || inputs.length > MAX_INVENTORY) return this._reject()
      const learned = []
      for (const input of inputs) {
        const ballot = await verifyBallot(input, this.poll)
        if (ballot) {
          if (this._apply(ballot)) learned.push(ballot)
        }
        else this.stats.rejected += 1
      }
      // An addressed repair terminates here. Re-gossip only newly materialized
      // winners under fresh frame IDs so adjacent collectors also repair.
      for (const ballot of learned) await this._emit('ballot', { ballot })
      return true
    }
    return this._reject()
  }

  _reject() {
    this.stats.rejected += 1
    return false
  }

  _inventory() {
    return [...this.current.values()].map(({ voterHash, eventId, revision }) => ({ voterHash, eventId, revision }))
  }

  async _sendInventory(destinationId, replyRequested) {
    return this._emit('inventory', { entries: this._inventory(), replyRequested }, destinationId)
  }

  async sync(destinationId = null) {
    return this._sendInventory(destinationId, true)
  }

  async importState(state) {
    if (!state || state.pollId !== this.poll.id || !Array.isArray(state.ballots)) return 0
    let imported = 0
    for (const input of state.ballots) {
      const ballot = await verifyBallot(input, this.poll)
      if (ballot) {
        this._apply(ballot)
        imported += 1
      }
    }
    return imported
  }

  exportState() {
    return { schema: 'roomhash.vote/state-v1', pollId: this.poll.id, ballots: [...this.events.values()] }
  }

  ballots() {
    return [...this.current.values()].sort((a, b) => a.voterHash.localeCompare(b.voterHash))
  }

  tally() {
    const counts = Object.fromEntries(this.poll.options.map((option) => [option.id, 0]))
    for (const ballot of this.current.values()) counts[ballot.optionId] += 1
    return { pollId: this.poll.id, collectorId: this.nodeId, collectedBallots: this.current.size, counts }
  }
}

export const protocolConstants = Object.freeze({ BALLOT_SCHEMA, FRAME_SCHEMA, MAX_HOPS })
