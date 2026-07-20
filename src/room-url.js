/**
 * Room URL encode/decode: room UUID in the hash, optional custom tracker.
 *
 * Formats (hash portion after #):
 *   <uuid>
 *   <uuid>?tracker=<encodeURIComponent(wss-url)>
 *
 * Also accepts legacy/alternate:
 *   r=<uuid>
 *   r=<uuid>&tracker=...
 */

import { DEFAULT_TRACKER } from './config.js'

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Generate a RFC4122-ish v4 UUID (browser crypto preferred).
 * @returns {string}
 */
export function generateRoomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // Fallback for older environments / some Node versions
  const bytes = new Uint8Array(16)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(bytes)
  } else {
    for (let i = 0; i < 16; i++) bytes[i] = (Math.random() * 256) | 0
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * @param {string} id
 * @returns {boolean}
 */
export function isValidRoomId(id) {
  return typeof id === 'string' && UUID_RE.test(id.trim())
}

/**
 * Normalize a tracker URL for comparison / storage.
 * @param {string | null | undefined} tracker
 * @returns {string}
 */
export function normalizeTracker(tracker) {
  if (tracker == null || String(tracker).trim() === '') {
    return DEFAULT_TRACKER
  }
  return String(tracker).trim().replace(/\/+$/, '')
}

/**
 * Validate a tracker for use from an HTTPS-hosted static page.
 * Only secure WebSocket trackers work without mixed-content failures.
 *
 * @param {string | null | undefined} tracker
 * @returns {{ ok: true, tracker: string } | { ok: false, error: string }}
 */
export function validateTrackerUrl(tracker) {
  const normalized = normalizeTracker(tracker)
  try {
    const parsed = new URL(normalized)
    if (parsed.protocol !== 'wss:') {
      return { ok: false, error: 'tracker must use wss://' }
    }
    if (!parsed.hostname || parsed.username || parsed.password) {
      return { ok: false, error: 'invalid tracker URL' }
    }
    return { ok: true, tracker: normalized }
  } catch {
    return { ok: false, error: 'invalid tracker URL' }
  }
}

/**
 * Whether the given tracker is the app default.
 * @param {string | null | undefined} tracker
 */
export function isDefaultTracker(tracker) {
  return normalizeTracker(tracker) === normalizeTracker(DEFAULT_TRACKER)
}

/**
 * Encode room + optional tracker into a hash fragment (without leading #).
 * Omits tracker query when it matches the default so share links stay short.
 *
 * @param {{ roomId: string, tracker?: string | null }} state
 * @returns {string} hash body e.g. "uuid" or "uuid?tracker=wss%3A%2F%2F..."
 */
export function encodeRoomHash({ roomId, tracker }) {
  if (!isValidRoomId(roomId)) {
    throw new Error(`invalid roomId: ${roomId}`)
  }
  const id = roomId.trim().toLowerCase()
  const validated = validateTrackerUrl(tracker)
  if (!validated.ok) {
    throw new Error(validated.error)
  }
  const t = validated.tracker
  if (isDefaultTracker(t)) {
    return id
  }
  return `${id}?tracker=${encodeURIComponent(t)}`
}

/**
 * Parse location.hash (with or without leading #) into roomId + tracker.
 * Returns null roomId when hash is empty or invalid.
 *
 * @param {string} hash
 * @returns {{ roomId: string | null, tracker: string }}
 */
export function decodeRoomHash(hash) {
  const raw = String(hash ?? '')
    .replace(/^#/, '')
    .trim()

  if (!raw) {
    return { roomId: null, tracker: DEFAULT_TRACKER }
  }

  // Support r=<uuid> form
  let body = raw
  if (body.startsWith('r=')) {
    body = body.slice(2)
  }

  let pathPart = body
  let queryPart = ''
  const q = body.indexOf('?')
  if (q >= 0) {
    pathPart = body.slice(0, q)
    queryPart = body.slice(q + 1)
  } else {
    // also allow &tracker without ?
    const amp = body.indexOf('&')
    if (amp >= 0) {
      pathPart = body.slice(0, amp)
      queryPart = body.slice(amp + 1)
    }
  }

  // path may still be "r=uuid" if someone used #r=uuid&tracker=
  let roomId = pathPart.trim()
  if (roomId.startsWith('r=')) roomId = roomId.slice(2)

  const params = new URLSearchParams(queryPart)
  const trackerParam = params.get('tracker') || params.get('t')
  const validatedTracker = validateTrackerUrl(trackerParam || DEFAULT_TRACKER)
  const tracker = validatedTracker.ok ? validatedTracker.tracker : DEFAULT_TRACKER

  if (!isValidRoomId(roomId)) {
    return { roomId: null, tracker }
  }

  return { roomId: roomId.trim().toLowerCase(), tracker }
}

/**
 * Build a full shareable URL for the current origin/path + room state.
 *
 * @param {{ roomId: string, tracker?: string | null, origin?: string, pathname?: string }} opts
 * @returns {string}
 */
export function buildShareUrl({ roomId, tracker, origin, pathname }) {
  const hash = encodeRoomHash({ roomId, tracker })
  const baseOrigin =
    origin ??
    (typeof location !== 'undefined' ? location.origin : 'https://example.github.io')
  const basePath =
    pathname ?? (typeof location !== 'undefined' ? location.pathname : '/')
  // Ensure no double slashes issues; pathname from location already includes leading /
  return `${baseOrigin}${basePath}#${hash}`
}

/**
 * Ensure a room id exists: reuse valid hash room, otherwise generate and return new state.
 * Does not mutate location — caller applies hash.
 *
 * @param {string} hash current location.hash
 * @returns {{ roomId: string, tracker: string, created: boolean }}
 */
export function resolveRoomFromHash(hash) {
  const parsed = decodeRoomHash(hash)
  if (parsed.roomId) {
    return { roomId: parsed.roomId, tracker: parsed.tracker, created: false }
  }
  return {
    roomId: generateRoomId(),
    tracker: parsed.tracker || DEFAULT_TRACKER,
    created: true
  }
}
