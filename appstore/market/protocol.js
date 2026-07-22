export const SCHEMAS = Object.freeze({
  listing: 'roomhash.market/listing-v1',
  intent: 'roomhash.market/purchase-intent-v1',
  sensitive: 'roomhash.market/purchase-private-v1',
  frame: 'roomhash.market/frame-v1',
  state: 'roomhash.market/state-v1'
})

export const LIMITS = Object.freeze({
  maxHops: 16,
  maxInventory: 2000,
  maxPhotos: 8,
  maxVideos: 2,
  maxPhotoBytes: 10 * 1024 * 1024,
  maxVideoBytes: 100 * 1024 * 1024,
  maxMediaBytes: 210 * 1024 * 1024
})

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
const VIDEO_TYPES = new Set(['video/mp4', 'video/webm'])
const FORBIDDEN_COMMERCE_KEYS = new Set([
  'payment', 'paymentstatus', 'wallet', 'walletaddress', 'escrow', 'transactionid', 'paid', 'refund'
])

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function cryptoApi() {
  assert(globalThis.crypto?.subtle, 'Web Crypto is required')
  return globalThis.crypto
}

function text(value, name, max = 256, { optional = false } = {}) {
  const result = String(value ?? '').trim()
  if (optional && !result) return ''
  assert(result.length > 0 && result.length <= max, `invalid ${name}`)
  return result
}

function integer(value, name, min = 0) {
  const result = Number(value)
  assert(Number.isSafeInteger(result) && result >= min, `invalid ${name}`)
  return result
}

function rejectCommerceFields(value) {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert(!FORBIDDEN_COMMERCE_KEYS.has(key.toLowerCase()), `unsupported commerce field: ${key}`)
    rejectCommerceFields(child)
  }
}

function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
}

function bytesToBase64Url(bytes) {
  let binary = ''
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')
}

function base64UrlToBytes(value) {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized + '='.repeat((4 - normalized.length % 4) % 4))
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}

function hex(bytes) {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(value) {
  const bytes = typeof value === 'string' ? encoder.encode(value) : value
  return hex(await cryptoApi().subtle.digest('SHA-256', bytes))
}

function publicKeyShape(jwk, usage) {
  assert(jwk?.kty === 'EC' && jwk.crv === 'P-256' && typeof jwk.x === 'string' && typeof jwk.y === 'string', `invalid ${usage} public key`)
  return Object.freeze({ kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y, ext: true })
}

export async function publicKeyHash(jwk) {
  return sha256(canonical(publicKeyShape(jwk, 'identity')))
}

async function importVerifyKey(jwk) {
  return cryptoApi().subtle.importKey('jwk', publicKeyShape(jwk, 'signing'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
}

async function signObject(privateJwk, value) {
  const key = await cryptoApi().subtle.importKey('jwk', privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  return bytesToBase64Url(await cryptoApi().subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(canonical(value))))
}

async function verifyObject(publicJwk, value, signature) {
  try {
    const key = await importVerifyKey(publicJwk)
    return cryptoApi().subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64UrlToBytes(signature), encoder.encode(canonical(value)))
  } catch {
    return false
  }
}

export async function generateIdentity({ nick, publicContact = '' }) {
  const signing = await cryptoApi().subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const encryption = await cryptoApi().subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const signingPublicKey = publicKeyShape(await cryptoApi().subtle.exportKey('jwk', signing.publicKey), 'signing')
  const encryptionPublicKey = publicKeyShape(await cryptoApi().subtle.exportKey('jwk', encryption.publicKey), 'encryption')
  return {
    nick: text(nick, 'nick', 80),
    publicContact: text(publicContact, 'publicContact', 240, { optional: true }),
    userHash: await publicKeyHash(signingPublicKey),
    signingPublicKey,
    signingPrivateKey: await cryptoApi().subtle.exportKey('jwk', signing.privateKey),
    encryptionPublicKey,
    encryptionPrivateKey: await cryptoApi().subtle.exportKey('jwk', encryption.privateKey)
  }
}

export async function sha256File(file) {
  assert(file && typeof file.arrayBuffer === 'function', 'file is required')
  return sha256(await file.arrayBuffer())
}

export function validateMedia(input) {
  assert(Array.isArray(input), 'media must be an array')
  let photos = 0
  let videos = 0
  let total = 0
  const result = input.map((item, index) => {
    const mime = text(item?.mime, `media[${index}].mime`, 100).toLowerCase()
    const kind = PHOTO_TYPES.has(mime) ? 'photo' : VIDEO_TYPES.has(mime) ? 'video' : null
    assert(kind, `unsupported media type: ${mime}`)
    const size = integer(item.size, `media[${index}].size`, 1)
    if (kind === 'photo') {
      photos += 1
      assert(size <= LIMITS.maxPhotoBytes, 'photo is too large')
    } else {
      videos += 1
      assert(size <= LIMITS.maxVideoBytes, 'video is too large')
    }
    total += size
    const digest = text(item.sha256, `media[${index}].sha256`, 64).toLowerCase()
    assert(/^[a-f0-9]{64}$/u.test(digest), 'invalid media sha256')
    const magnet = text(item.magnet, `media[${index}].magnet`, 2048, { optional: true })
    const webSeed = text(item.webSeed, `media[${index}].webSeed`, 2048, { optional: true })
    if (magnet) assert(magnet.startsWith('magnet:?'), 'invalid magnet URI')
    if (webSeed) assert(/^https:\/\//u.test(webSeed) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//u.test(webSeed), 'webSeed must use HTTPS (localhost HTTP is allowed for development)')
    assert(magnet || webSeed, 'media needs magnet or webSeed')
    return Object.freeze({ kind, name: text(item.name, `media[${index}].name`, 180), mime, size, sha256: digest, magnet, webSeed })
  })
  assert(photos <= LIMITS.maxPhotos, 'too many photos')
  assert(videos <= LIMITS.maxVideos, 'too many videos')
  assert(total <= LIMITS.maxMediaBytes, 'media total is too large')
  return Object.freeze(result)
}

function normalizePrice(price) {
  assert(price && typeof price === 'object', 'price is required')
  const amount = text(price.amount, 'price.amount', 32)
  assert(/^(0|[1-9]\d{0,11})(\.\d{1,4})?$/u.test(amount), 'invalid price amount')
  const currency = text(price.currency, 'price.currency', 12).toUpperCase()
  assert(/^[A-Z][A-Z0-9]{1,11}$/u.test(currency), 'invalid currency')
  return Object.freeze({ amount, currency })
}

function unsignedListing(input) {
  rejectCommerceFields(input)
  const seller = input.seller
  assert(seller && typeof seller === 'object', 'seller is required')
  const signingPublicKey = publicKeyShape(seller.signingPublicKey, 'signing')
  const encryptionPublicKey = publicKeyShape(seller.encryptionPublicKey, 'encryption')
  const sellerHash = text(seller.userHash, 'seller.userHash', 64).toLowerCase()
  assert(/^[a-f0-9]{64}$/u.test(sellerHash), 'invalid seller hash')
  const listingId = text(input.listingId, 'listingId', 160)
  assert(listingId.startsWith(`${sellerHash}:`) && /^[a-f0-9]{64}:[a-z0-9][a-z0-9_-]{0,63}$/u.test(listingId), 'listingId must be owned by seller hash')
  const status = text(input.status, 'status', 16)
  assert(status === 'active' || status === 'withdrawn', 'invalid listing status')
  return Object.freeze({
    schema: SCHEMAS.listing,
    listingId,
    seller: Object.freeze({
      nick: text(seller.nick, 'seller.nick', 80),
      userHash: sellerHash,
      publicContact: text(seller.publicContact, 'seller.publicContact', 240),
      signingPublicKey,
      encryptionPublicKey
    }),
    title: text(input.title, 'title', 160),
    price: normalizePrice(input.price),
    description: text(input.description, 'description', 5000),
    media: validateMedia(input.media || []),
    status,
    revision: integer(input.revision, 'revision', 1),
    updatedAt: integer(input.updatedAt, 'updatedAt')
  })
}

export async function makeListing(input, identity) {
  const seller = {
    nick: identity.nick,
    userHash: identity.userHash,
    publicContact: identity.publicContact,
    signingPublicKey: identity.signingPublicKey,
    encryptionPublicKey: identity.encryptionPublicKey
  }
  const listing = unsignedListing({ ...input, seller })
  assert(await publicKeyHash(listing.seller.signingPublicKey) === listing.seller.userHash, 'identity hash mismatch')
  const eventId = await sha256(canonical(listing))
  const signature = await signObject(identity.signingPrivateKey, listing)
  return Object.freeze({ ...listing, eventId, signature })
}

export async function verifyListing(input) {
  try {
    const listing = unsignedListing(input)
    if (await publicKeyHash(listing.seller.signingPublicKey) !== listing.seller.userHash) return null
    const eventId = text(input.eventId, 'eventId', 64).toLowerCase()
    if (eventId !== await sha256(canonical(listing))) return null
    if (!await verifyObject(listing.seller.signingPublicKey, listing, input.signature)) return null
    return Object.freeze({ ...listing, eventId, signature: input.signature })
  } catch {
    return null
  }
}

function randomHex(byteLength = 16) {
  return hex(cryptoApi().getRandomValues(new Uint8Array(byteLength)))
}

function normalizeSensitive(input) {
  rejectCommerceFields(input)
  return Object.freeze({
    schema: SCHEMAS.sensitive,
    buyerNick: text(input.buyerNick, 'buyerNick', 80),
    contact: text(input.contact, 'contact', 500),
    delivery: text(input.delivery, 'delivery', 1000),
    note: text(input.note, 'note', 2000, { optional: true }),
    createdAt: integer(input.createdAt, 'createdAt')
  })
}

function unsignedIntent(input) {
  rejectCommerceFields(input)
  const buyerSigningPublicKey = publicKeyShape(input.buyerSigningPublicKey, 'buyer signing')
  const buyerHash = text(input.buyerHash, 'buyerHash', 64).toLowerCase()
  assert(/^[a-f0-9]{64}$/u.test(buyerHash), 'invalid buyerHash')
  const orderIntentId = text(input.orderIntentId, 'orderIntentId', 160)
  assert(orderIntentId.startsWith(`${buyerHash}:`) && /^[a-f0-9]{64}:[a-f0-9]{32}$/u.test(orderIntentId), 'invalid orderIntentId')
  const envelope = input.envelope
  assert(envelope && typeof envelope === 'object', 'envelope is required')
  assert(envelope.alg === 'ECDH-P256/HKDF-SHA-256/AES-256-GCM', 'unsupported envelope algorithm')
  const checkedEnvelope = Object.freeze({
    alg: envelope.alg,
    ephemeralPublicKey: publicKeyShape(envelope.ephemeralPublicKey, 'ephemeral encryption'),
    salt: text(envelope.salt, 'envelope.salt', 64),
    iv: text(envelope.iv, 'envelope.iv', 32),
    ciphertext: text(envelope.ciphertext, 'envelope.ciphertext', 16384)
  })
  const listingId = text(input.listingId, 'listingId', 160)
  const recipientSellerHash = text(input.recipientSellerHash, 'recipientSellerHash', 64).toLowerCase()
  assert(/^[a-f0-9]{64}$/u.test(recipientSellerHash) && listingId.startsWith(`${recipientSellerHash}:`), 'intent recipient does not own listingId')
  return Object.freeze({
    schema: SCHEMAS.intent,
    orderIntentId,
    listingId,
    recipientSellerHash,
    buyerHash,
    buyerSigningPublicKey,
    revision: integer(input.revision, 'revision', 1),
    createdAt: integer(input.createdAt, 'createdAt'),
    envelope: checkedEnvelope
  })
}

async function deriveEnvelopeKey(privateKey, publicKey, salt, info) {
  const sharedBits = await cryptoApi().subtle.deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256)
  const keyMaterial = await cryptoApi().subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  return cryptoApi().subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: encoder.encode(info) },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

function envelopeContext(intent) {
  return canonical({
    schema: SCHEMAS.intent,
    orderIntentId: intent.orderIntentId,
    listingId: intent.listingId,
    recipientSellerHash: intent.recipientSellerHash,
    buyerHash: intent.buyerHash,
    revision: intent.revision,
    createdAt: intent.createdAt
  })
}

export async function makePurchaseIntent(input) {
  rejectCommerceFields(input)
  const { listing, buyerIdentity, buyerNick, contact, delivery, note = '', revision = 1, createdAt = Date.now(), orderIntentId } = input
  const verifiedListing = await verifyListing(listing)
  assert(verifiedListing, 'verified listing is required')
  assert(verifiedListing.status === 'active', 'listing is not active')
  assert(await publicKeyHash(buyerIdentity.signingPublicKey) === buyerIdentity.userHash, 'buyer identity hash mismatch')
  const intentBase = {
    orderIntentId: orderIntentId || `${buyerIdentity.userHash}:${randomHex()}`,
    listingId: verifiedListing.listingId,
    recipientSellerHash: verifiedListing.seller.userHash,
    buyerHash: buyerIdentity.userHash,
    revision,
    createdAt
  }
  const sensitive = normalizeSensitive({ buyerNick, contact, delivery, note, createdAt })
  const ephemeral = await cryptoApi().subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const recipient = await cryptoApi().subtle.importKey('jwk', verifiedListing.seller.encryptionPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const salt = cryptoApi().getRandomValues(new Uint8Array(16))
  const iv = cryptoApi().getRandomValues(new Uint8Array(12))
  const context = envelopeContext(intentBase)
  const key = await deriveEnvelopeKey(ephemeral.privateKey, recipient, salt, context)
  const ciphertext = await cryptoApi().subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(context) }, key, encoder.encode(JSON.stringify(sensitive)))
  const unsigned = unsignedIntent({
    ...intentBase,
    buyerSigningPublicKey: buyerIdentity.signingPublicKey,
    envelope: {
      alg: 'ECDH-P256/HKDF-SHA-256/AES-256-GCM',
      ephemeralPublicKey: await cryptoApi().subtle.exportKey('jwk', ephemeral.publicKey),
      salt: bytesToBase64Url(salt),
      iv: bytesToBase64Url(iv),
      ciphertext: bytesToBase64Url(ciphertext)
    }
  })
  const eventId = await sha256(canonical(unsigned))
  const signature = await signObject(buyerIdentity.signingPrivateKey, unsigned)
  return Object.freeze({ ...unsigned, eventId, signature })
}

export async function verifyPurchaseIntent(input) {
  try {
    const intent = unsignedIntent(input)
    if (await publicKeyHash(intent.buyerSigningPublicKey) !== intent.buyerHash) return null
    if (!/^[a-f0-9]{64}$/u.test(intent.recipientSellerHash)) return null
    const eventId = text(input.eventId, 'eventId', 64).toLowerCase()
    if (eventId !== await sha256(canonical(intent))) return null
    if (!await verifyObject(intent.buyerSigningPublicKey, intent, input.signature)) return null
    return Object.freeze({ ...intent, eventId, signature: input.signature })
  } catch {
    return null
  }
}

export async function decryptPurchaseIntent(intentInput, sellerIdentity) {
  const intent = await verifyPurchaseIntent(intentInput)
  assert(intent, 'invalid purchase intent')
  assert(intent.recipientSellerHash === sellerIdentity.userHash, 'purchase intent is not addressed to this seller')
  const privateKey = await cryptoApi().subtle.importKey('jwk', sellerIdentity.encryptionPrivateKey, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
  const publicKey = await cryptoApi().subtle.importKey('jwk', intent.envelope.ephemeralPublicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const context = envelopeContext(intent)
  const key = await deriveEnvelopeKey(privateKey, publicKey, base64UrlToBytes(intent.envelope.salt), context)
  const plaintext = await cryptoApi().subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(intent.envelope.iv), additionalData: encoder.encode(context) },
    key,
    base64UrlToBytes(intent.envelope.ciphertext)
  )
  const sensitive = normalizeSensitive(JSON.parse(decoder.decode(plaintext)))
  return Object.freeze({ ...sensitive, buyerHash: intent.buyerHash, orderIntentId: intent.orderIntentId, listingId: intent.listingId })
}

function compareEvents(left, right) {
  if (!right) return 1
  if (left.revision !== right.revision) return left.revision - right.revision
  return left.eventId.localeCompare(right.eventId)
}

function validFrame(frame, roomId) {
  return Boolean(frame && frame.schema === SCHEMAS.frame && frame.roomId === roomId &&
    typeof frame.frameId === 'string' && /^[a-f0-9]{64}$/u.test(frame.frameId) &&
    typeof frame.originId === 'string' && frame.originId.length > 0 && frame.originId.length <= 128 &&
    (frame.destinationId == null || (typeof frame.destinationId === 'string' && frame.destinationId.length <= 128)) &&
    Number.isInteger(frame.hops) && frame.hops >= 0 && frame.hops <= LIMITS.maxHops &&
    Number.isInteger(frame.maxHops) && frame.maxHops >= 1 && frame.maxHops <= LIMITS.maxHops &&
    typeof frame.type === 'string' && frame.payload && typeof frame.payload === 'object')
}

export class MarketNode {
  constructor({ nodeId, roomId = 'default', send, now = () => Date.now(), persist = () => {} }) {
    this.nodeId = text(nodeId, 'nodeId', 128)
    this.roomId = text(roomId, 'roomId', 128)
    assert(typeof send === 'function', 'send callback is required')
    this.send = send
    this.now = now
    this.persist = persist
    this.listingEvents = new Map()
    this.listingsById = new Map()
    this.intentEvents = new Map()
    this.intentsById = new Map()
    this.seenFrames = new Set()
    this.sequence = 0
    this.stats = { accepted: 0, duplicateFrames: 0, forwarded: 0, rejected: 0 }
  }

  async _newFrame(type, payload, destinationId = null) {
    const seed = `${this.nodeId}\n${++this.sequence}\n${this.now()}\n${randomHex(8)}\n${type}`
    return { schema: SCHEMAS.frame, roomId: this.roomId, frameId: await sha256(seed), originId: this.nodeId, destinationId, hops: 0, maxHops: LIMITS.maxHops, type, payload }
  }

  async _emit(type, payload, destinationId = null, options = {}) {
    const frame = await this._newFrame(type, payload, destinationId)
    this.seenFrames.add(frame.frameId)
    await this.send(frame, options)
    return frame
  }

  _applyListing(listing) {
    this.listingEvents.set(listing.eventId, listing)
    const previous = this.listingsById.get(listing.listingId)
    if (compareEvents(listing, previous) <= 0) return false
    this.listingsById.set(listing.listingId, listing)
    this.stats.accepted += 1
    this.persist(this.exportState())
    return true
  }

  _applyIntent(intent) {
    this.intentEvents.set(intent.eventId, intent)
    const previous = this.intentsById.get(intent.orderIntentId)
    if (compareEvents(intent, previous) <= 0) return false
    this.intentsById.set(intent.orderIntentId, intent)
    this.stats.accepted += 1
    this.persist(this.exportState())
    return true
  }

  async publishListing(input, identity) {
    const listing = await makeListing({ ...input, updatedAt: input.updatedAt ?? this.now() }, identity)
    this._applyListing(listing)
    await this._emit('event', { kind: 'listing', event: listing })
    return listing
  }

  async publishPurchaseIntent(input) {
    const intent = await makePurchaseIntent(input)
    this._applyIntent(intent)
    await this._emit('event', { kind: 'intent', event: intent })
    return intent
  }

  listings({ includeWithdrawn = false } = {}) {
    return [...this.listingsById.values()].filter((item) => includeWithdrawn || item.status === 'active').sort((a, b) => b.updatedAt - a.updatedAt || a.listingId.localeCompare(b.listingId))
  }

  intentsForSeller(sellerHash) {
    return [...this.intentsById.values()].filter((intent) => intent.recipientSellerHash === sellerHash).sort((a, b) => b.createdAt - a.createdAt)
  }

  async receive(frame, sourcePeerId = null) {
    if (!validFrame(frame, this.roomId) || frame.hops > frame.maxHops) return this._reject()
    if (this.seenFrames.has(frame.frameId)) {
      this.stats.duplicateFrames += 1
      return false
    }
    this.seenFrames.add(frame.frameId)
    const isDestination = frame.destinationId == null || frame.destinationId === this.nodeId
    let accepted = true
    if (isDestination) accepted = await this._process(frame)
    if (accepted && frame.destinationId !== this.nodeId && frame.hops < frame.maxHops) {
      await this.send({ ...frame, hops: frame.hops + 1 }, { excludePeerId: sourcePeerId })
      this.stats.forwarded += 1
    }
    return accepted
  }

  async _verified(kind, event) {
    if (kind === 'listing') return verifyListing(event)
    if (kind === 'intent') return verifyPurchaseIntent(event)
    return null
  }

  _apply(kind, event) {
    return kind === 'listing' ? this._applyListing(event) : this._applyIntent(event)
  }

  async _process(frame) {
    if (frame.type === 'event') {
      const event = await this._verified(frame.payload.kind, frame.payload.event)
      if (!event) return this._reject()
      this._apply(frame.payload.kind, event)
      return true
    }
    if (frame.type === 'inventory') {
      const entries = frame.payload.entries
      if (!Array.isArray(entries) || entries.length > LIMITS.maxInventory) return this._reject()
      const wants = []
      for (const entry of entries) {
        const current = entry?.kind === 'listing' ? this.listingsById.get(entry.key) : entry?.kind === 'intent' ? this.intentsById.get(entry.key) : null
        if (!current || current.eventId !== entry.eventId) wants.push(entry.eventId)
      }
      if (wants.length) await this._emit('want', { eventIds: [...new Set(wants)] }, frame.originId)
      if (frame.payload.replyRequested) await this._sendInventory(frame.originId, false)
      return true
    }
    if (frame.type === 'want') {
      const ids = frame.payload.eventIds
      if (!Array.isArray(ids) || ids.length > LIMITS.maxInventory) return this._reject()
      const events = [...new Set(ids)].map((id) => this.listingEvents.has(id)
        ? { kind: 'listing', event: this.listingEvents.get(id) }
        : this.intentEvents.has(id) ? { kind: 'intent', event: this.intentEvents.get(id) } : null).filter(Boolean)
      if (events.length) await this._emit('events', { events }, frame.originId)
      return true
    }
    if (frame.type === 'events') {
      const inputs = frame.payload.events
      if (!Array.isArray(inputs) || inputs.length > LIMITS.maxInventory) return this._reject()
      const learned = []
      for (const item of inputs) {
        const event = await this._verified(item?.kind, item?.event)
        if (event && this._apply(item.kind, event)) learned.push({ kind: item.kind, event })
        else if (!event) this.stats.rejected += 1
      }
      for (const item of learned) await this._emit('event', item)
      return true
    }
    return this._reject()
  }

  _reject() {
    this.stats.rejected += 1
    return false
  }

  _inventory() {
    return [
      ...[...this.listingsById.values()].map((event) => ({ kind: 'listing', key: event.listingId, eventId: event.eventId, revision: event.revision })),
      ...[...this.intentsById.values()].map((event) => ({ kind: 'intent', key: event.orderIntentId, eventId: event.eventId, revision: event.revision }))
    ]
  }

  async _sendInventory(destinationId, replyRequested) {
    return this._emit('inventory', { entries: this._inventory(), replyRequested }, destinationId)
  }

  async sync(destinationId = null) {
    return this._sendInventory(destinationId, true)
  }

  exportState() {
    return { schema: SCHEMAS.state, roomId: this.roomId, listings: [...this.listingsById.values()], intents: [...this.intentsById.values()] }
  }

  async importState(state) {
    if (!state || state.schema !== SCHEMAS.state || state.roomId !== this.roomId || !Array.isArray(state.listings) || !Array.isArray(state.intents)) return 0
    let count = 0
    for (const input of state.listings) {
      const event = await verifyListing(input)
      if (event && this._applyListing(event)) count += 1
    }
    for (const input of state.intents) {
      const event = await verifyPurchaseIntent(input)
      if (event && this._applyIntent(event)) count += 1
    }
    return count
  }
}
