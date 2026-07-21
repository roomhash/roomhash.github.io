import { buildShareUrl, encodeRoomHash, resolveRoomFromHash } from './room-url.js'

const MAX_CHANNEL_NAME = 40

export function normalizeChannelName(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ')
  if (name.length > MAX_CHANNEL_NAME) {
    return { ok: false, name: '', error: `channel name must be ${MAX_CHANNEL_NAME} characters or fewer` }
  }
  return { ok: true, name }
}

export function encodeNamedRoomHash({ roomId, tracker, channelName = '' }) {
  const base = encodeRoomHash({ roomId, tracker })
  const queryAt = base.indexOf('?')
  const room = queryAt < 0 ? base : base.slice(0, queryAt)
  const query = queryAt < 0 ? '' : base.slice(queryAt)
  const normalized = normalizeChannelName(channelName)
  const suffix = normalized.ok && normalized.name ? `/${encodeURIComponent(normalized.name)}` : ''
  return `${room}${suffix}${query}`
}

export function resolveNamedRoomFromHash(hash) {
  const raw = String(hash || '').replace(/^#/, '')
  const queryAt = raw.indexOf('?')
  const path = queryAt < 0 ? raw : raw.slice(0, queryAt)
  const query = queryAt < 0 ? '' : raw.slice(queryAt)
  const slashAt = path.indexOf('/')
  const room = slashAt < 0 ? path : path.slice(0, slashAt)
  let channelName = ''
  if (slashAt >= 0) {
    try {
      channelName = normalizeChannelName(decodeURIComponent(path.slice(slashAt + 1))).name
    } catch {
      channelName = ''
    }
  }
  return { ...resolveRoomFromHash(`${room}${query}`), channelName }
}

export function buildNamedShareUrl({ roomId, tracker, channelName = '' }) {
  const url = new URL(buildShareUrl({ roomId, tracker }))
  url.hash = encodeNamedRoomHash({ roomId, tracker, channelName })
  return url.toString()
}
