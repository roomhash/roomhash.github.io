/**
 * Browser local persistence for nickname, tracker preference, and room message history.
 * Uses localStorage; falls back to in-memory when unavailable (tests / private mode).
 */

import { STORAGE_PREFIX } from './config.js'

/**
 * @returns {Storage | { getItem(k:string): string|null, setItem(k:string,v:string): void, removeItem(k:string): void }}
 */
function getStore() {
  try {
    if (typeof localStorage !== 'undefined') {
      const k = `${STORAGE_PREFIX}__probe`
      localStorage.setItem(k, '1')
      localStorage.removeItem(k)
      return localStorage
    }
  } catch {
    // ignore
  }
  /** @type {Map<string, string>} */
  const map = new Map()
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null
    },
    setItem(key, value) {
      map.set(key, String(value))
    },
    removeItem(key) {
      map.delete(key)
    }
  }
}

const store = getStore()

function key(part) {
  return `${STORAGE_PREFIX}${part}`
}

/**
 * @param {string} roomId
 */
export function messagesKey(roomId) {
  return key(`messages:${roomId}`)
}

export function loadNickname() {
  return store.getItem(key('nickname'))
}

/**
 * @param {string} nickname
 */
export function saveNickname(nickname) {
  store.setItem(key('nickname'), nickname)
}

export function loadPreferredTracker() {
  return store.getItem(key('tracker'))
}

/**
 * @param {string} tracker
 */
export function savePreferredTracker(tracker) {
  store.setItem(key('tracker'), tracker)
}

export function loadTorrentPreload() {
  return store.getItem(key('torrent-preload')) === 'true'
}

export function saveTorrentPreload(enabled) {
  store.setItem(key('torrent-preload'), String(Boolean(enabled)))
}

/**
 * @param {string} roomId
 * @returns {import('./message.js').ChatMessage[]}
 */
export function loadMessages(roomId) {
  const raw = store.getItem(messagesKey(roomId))
  if (!raw) return []
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

/**
 * @param {string} roomId
 * @param {import('./message.js').ChatMessage[]} messages
 * @param {number} [max=200]
 */
export function saveMessages(roomId, messages, max = 200) {
  const trimmed = messages.slice(-max)
  // Cap dataUrl size in storage to avoid quota blow-ups
  const safe = trimmed.map((m) => {
    if (m.dataUrl && m.dataUrl.length > 200_000) {
      const { dataUrl, ...rest } = m
      return { ...rest, dataUrlOmitted: true }
    }
    return m
  })
  try {
    store.setItem(messagesKey(roomId), JSON.stringify(safe))
  } catch {
    // quota exceeded — drop dataUrls and retry
    const lean = safe.map(({ dataUrl, ...rest }) => rest)
    try {
      store.setItem(messagesKey(roomId), JSON.stringify(lean))
    } catch {
      // give up silently
    }
  }
}

/**
 * Append one message and persist.
 * @param {string} roomId
 * @param {import('./message.js').ChatMessage} message
 */
export function appendMessage(roomId, message) {
  const list = loadMessages(roomId)
  if (list.some((m) => m.id === message.id)) return list
  list.push(message)
  saveMessages(roomId, list)
  return list
}

/**
 * Clear all RoomHash keys (testing helper).
 */
export function clearAllStorage() {
  if (typeof localStorage === 'undefined') return
  const keys = []
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i)
    if (k && k.startsWith(STORAGE_PREFIX)) keys.push(k)
  }
  keys.forEach((k) => localStorage.removeItem(k))
}
