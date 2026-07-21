/**
 * RoomHash entry: room from hash, P2P via WebTorrent trackers, local persistence.
 */

import { DEFAULT_TRACKER, DEFAULT_TORRENT_TRACKERS } from './config.js'
import {
  buildShareUrl,
  encodeRoomHash,
  isDefaultTracker,
  normalizeTracker,
  resolveRoomFromHash,
  validateTrackerUrl
} from './room-url.js'
import { normalizeNickname, resolveNickname } from './nickname.js'
import { createTorrentSession } from './session.js'
import {
  appendMessage,
  loadMessages,
  loadNickname,
  loadPreferredTracker,
  loadTorrentPreload,
  saveNickname,
  savePreferredTracker,
  saveTorrentPreload
} from './storage.js'
import { bindUi } from './ui.js'
import { MessageModuleRegistry } from './modules/registry.js'
import {
  TORRENT_MEDIA_MODULE,
  TorrentMediaController,
  createTorrentMediaModule,
  isMagnetUri
} from './modules/torrent-media.js'

/** @type {import('./session.js').PeerSession | null} */
let session = null
/** @type {ReturnType<typeof bindUi> | null} */
let ui = null
let roomId = ''
let tracker = DEFAULT_TRACKER
let nickname = ''
const torrentMedia = new TorrentMediaController({
  trackers: DEFAULT_TORRENT_TRACKERS,
  autoPreload: loadTorrentPreload()
})
const moduleRegistry = new MessageModuleRegistry().register(
  createTorrentMediaModule(torrentMedia)
)

function applyHashToLocation(id, track) {
  const hash = encodeRoomHash({ roomId: id, tracker: track })
  const next = `#${hash}`
  if (location.hash !== next) {
    // replaceState keeps history clean on first assignment
    history.replaceState(null, '', `${location.pathname}${location.search}${next}`)
  }
}

function refreshShareUrl() {
  const url = buildShareUrl({ roomId, tracker })
  ui?.setShareUrl(url)
  return url
}

async function startSession() {
  if (session) {
    session.leave()
    session = null
  }

  ui?.setStatus('connecting…')
  ui?.setPeerCount(0)

  try {
    session = await createTorrentSession({
      roomId,
      tracker,
      nickname,
      getHistory: () => loadMessages(roomId),
      events: {
        onPeerJoin(peerId) {
          ui?.addMessage({
            id: `sys-join-${peerId}-${Date.now()}`,
            type: 'system',
            nickname: 'system',
            ts: Date.now(),
            text: `Peer ${peerId.slice(0, 6)}… joined`
          })
        },
        onPeerLeave(peerId) {
          ui?.addMessage({
            id: `sys-leave-${peerId}-${Date.now()}`,
            type: 'system',
            nickname: 'system',
            ts: Date.now(),
            text: `Peer ${peerId.slice(0, 6)}… left`
          })
        },
        onPeersChanged(peers) {
          ui?.setPeerCount(peers.length)
        },
        onMessage(msg) {
          appendMessage(roomId, msg)
          ui?.addMessage(msg)
        },
        onError(err) {
          console.error(err)
          ui?.setStatus(`error: ${err.message}`)
        },
        onStatus(s) {
          ui?.setStatus(s)
        }
      }
    })
  } catch (err) {
    console.error(err)
    ui?.setStatus(`failed to connect: ${err?.message || err}`)
  }
}

function loadHistory() {
  ui?.clearMessages()
  const history = loadMessages(roomId)
  for (const m of history) ui?.addMessage(m)
}

async function boot() {
  // Room from hash, or mint new UUID
  const resolved = resolveRoomFromHash(location.hash)
  roomId = resolved.roomId

  // Tracker priority: URL param > saved preference > default
  if (!isDefaultTracker(resolved.tracker) || location.hash.includes('tracker=')) {
    tracker = resolved.tracker
  } else {
    const saved = loadPreferredTracker()
    const savedTracker = validateTrackerUrl(saved || DEFAULT_TRACKER)
    tracker = savedTracker.ok ? savedTracker.tracker : DEFAULT_TRACKER
  }

  // Nickname: saved > random
  nickname = resolveNickname(loadNickname())
  saveNickname(nickname)

  applyHashToLocation(roomId, tracker)

  ui = bindUi(document, {
    onCopyLink() {
      const url = refreshShareUrl()
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(url).then(
          () => ui?.setStatus('link copied'),
          () => ui?.setStatus('copy failed — select the URL field')
        )
      } else {
        ui?.els.shareUrl?.select()
        ui?.setStatus('select & copy the share URL')
      }
    },
    onTrackerChange(value) {
      const validated = validateTrackerUrl(value || DEFAULT_TRACKER)
      if (!validated.ok) {
        ui?.setStatus(validated.error)
        ui?.setTracker(tracker)
        return
      }
      const next = validated.tracker
      if (next === tracker) return
      tracker = next
      savePreferredTracker(tracker)
      applyHashToLocation(roomId, tracker)
      refreshShareUrl()
      ui?.setTracker(tracker)
      // Reconnect with new tracker
      startSession()
    },
    onNicknameChange(value) {
      const n = normalizeNickname(value)
      if (!n.ok) {
        ui?.setStatus(n.error)
        ui?.setNickname(nickname)
        return
      }
      nickname = n.nickname
      saveNickname(nickname)
      session?.setNickname(nickname)
      ui?.setNickname(nickname)
      ui?.setStatus(`nickname → ${nickname}`)
    },
    async onSendText(text) {
      if (!text.trim()) return
      if (!session) {
        ui?.setStatus('not connected')
        return
      }
      try {
        const trimmed = text.trim()
        if (isMagnetUri(trimmed)) {
          await session.sendModule(TORRENT_MEDIA_MODULE, {
            magnet: trimmed,
            title: 'Shared magnet link'
          })
        } else {
          await session.sendText(text)
        }
      } catch (err) {
        ui?.setStatus(`send failed: ${err?.message || err}`)
      }
    },
    async onSendFile(file) {
      if (!session) {
        ui?.setStatus('not connected')
        return
      }
      try {
        ui?.setStatus(`sending ${file.name}…`)
        const buf = await file.arrayBuffer()
        await session.sendFile({
          name: file.name,
          mime: file.type || 'application/octet-stream',
          size: file.size,
          bytes: new Uint8Array(buf)
        })
        ui?.setStatus('file sent')
      } catch (err) {
        console.error(err)
        ui?.setStatus(`file send failed: ${err?.message || err}`)
      }
    },
    async onSeedFiles(files) {
      if (!session) {
        ui?.setStatus('not connected')
        return
      }
      try {
        ui?.setStatus('creating torrent...')
        const torrent = await torrentMedia.seed(files)
        await session.sendModule(TORRENT_MEDIA_MODULE, {
          magnet: torrent.magnetURI,
          title: torrent.name || Array.from(files)[0]?.name || 'Shared files',
          files: torrent.files.map((file) => ({
            name: file.name,
            size: file.length,
            mime: file.type || ''
          }))
        })
        ui?.setStatus('torrent published · keep this tab open to seed')
      } catch (err) {
        console.error(err)
        ui?.setStatus(`torrent publish failed: ${err?.message || err}`)
      }
    },
    onTorrentPreloadChange(enabled) {
      torrentMedia.setAutoPreload(enabled)
      saveTorrentPreload(enabled)
      ui?.setStatus(enabled ? 'torrent auto-preload enabled' : 'torrent auto-preload disabled')
    }
  }, { moduleRegistry })

  ui.setRoomId(roomId)
  ui.setTracker(tracker)
  ui.setNickname(nickname)
  ui.setPeerCount(0)
  ui.setTorrentPreload(torrentMedia.autoPreload)
  refreshShareUrl()
  loadHistory()

  // Respond to hash changes (user pasted another room)
  window.addEventListener('hashchange', () => {
    const next = resolveRoomFromHash(location.hash)
    if (next.roomId === roomId && normalizeTracker(next.tracker) === tracker) return
    roomId = next.roomId
    tracker = next.tracker
    applyHashToLocation(roomId, tracker)
    ui?.setRoomId(roomId)
    ui?.setTracker(tracker)
    refreshShareUrl()
    loadHistory()
    startSession()
  })

  await startSession()
}

boot().catch((err) => {
  console.error('boot failed', err)
  const status = document.getElementById('status')
  if (status) status.textContent = `boot failed: ${err?.message || err}`
})
