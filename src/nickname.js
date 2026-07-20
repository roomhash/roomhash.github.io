/**
 * Temporary random nicknames for chat peers.
 */

const ADJECTIVES = [
  'Swift',
  'Quiet',
  'Bright',
  'Clever',
  'Bold',
  'Lucky',
  'Cosmic',
  'Fuzzy',
  'Neon',
  'Rusty',
  'Silent',
  'Happy',
  'Curious',
  'Brave',
  'Gentle',
  'Wild',
  'Tiny',
  'Mighty',
  'Sunny',
  'Misty'
]

const NOUNS = [
  'Fox',
  'Otter',
  'Panda',
  'Falcon',
  'Wolf',
  'Koala',
  'Tiger',
  'Owl',
  'Lynx',
  'Hare',
  'Badger',
  'Raven',
  'Dolphin',
  'Crane',
  'Moose',
  'Seal',
  'Heron',
  'Puma',
  'Gecko',
  'Marten'
]

/**
 * @param {number} max exclusive
 * @returns {number}
 */
function randomInt(max) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return buf[0] % max
  }
  return Math.floor(Math.random() * max)
}

/**
 * Generate a random temporary nickname like "SwiftFox42".
 * @returns {string}
 */
export function generateNickname() {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)]
  const noun = NOUNS[randomInt(NOUNS.length)]
  const n = randomInt(90) + 10 // 10–99
  return `${adj}${noun}${n}`
}

/**
 * Validate / normalize a user-chosen nickname.
 * @param {string} nick
 * @returns {{ ok: true, nickname: string } | { ok: false, error: string }}
 */
export function normalizeNickname(nick) {
  if (nick == null) {
    return { ok: false, error: 'nickname required' }
  }
  const trimmed = String(nick).trim().replace(/\s+/g, ' ')
  if (trimmed.length < 1) {
    return { ok: false, error: 'nickname too short' }
  }
  if (trimmed.length > 32) {
    return { ok: false, error: 'nickname too long (max 32)' }
  }
  // Allow letters, numbers, spaces, common punctuation; block control chars
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return { ok: false, error: 'nickname contains invalid characters' }
  }
  return { ok: true, nickname: trimmed }
}

/**
 * Resolve nickname: use override if valid, else generate random.
 * @param {string | null | undefined} preferred
 * @returns {string}
 */
export function resolveNickname(preferred) {
  if (preferred != null && String(preferred).trim() !== '') {
    const n = normalizeNickname(preferred)
    if (n.ok) return n.nickname
  }
  return generateNickname()
}
