/** RoomHash application shell: multi-channel mesh chat and torrent media. */

import { DEFAULT_TRACKER, DEFAULT_TORRENT_TRACKERS } from './config.js'
import {
  buildShareUrl,
  encodeRoomHash,
  generateRoomId,
  isDefaultTracker,
  normalizeTracker,
  resolveRoomFromHash,
  validateTrackerUrl
} from './room-url.js'
import { normalizeNickname, resolveNickname } from './nickname.js'
import { createMeshSession } from './network/mesh-session.js'
import { RelayLimiter } from './network/gossip.js'
import { RuntimeCapabilities } from './network/runtime-capabilities.js'
import {
  appendMessage,
  loadAutoAddChannels,
  loadChannels,
  loadDiscoveredChannels,
  loadMessages,
  loadNickname,
  loadPreferredTracker,
  loadRelaySettings,
  loadTorrentPreload,
  saveAutoAddChannels,
  saveChannels,
  saveDiscoveredChannels,
  saveNickname,
  savePreferredTracker,
  saveRelaySettings,
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

const CHANNEL_LIMIT = 32
const MEMBER_SWEEP_MS = 10_000
const CHANNEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let ui = null
let activeChannel = ''
let tracker = DEFAULT_TRACKER
let nickname = ''
let autoAddChannels = loadAutoAddChannels()
let relaySettings = loadRelaySettings()

const channels = new Set()
const discoveredChannels = new Set(loadDiscoveredChannels())
const sessions = new Map()
const startingSessions = new Map()
const channelStates = new Map()
const runtimeCapabilities = new RuntimeCapabilities()
const relayLimiter = new RelayLimiter()

const torrentMedia = new TorrentMediaController({
  trackers: DEFAULT_TORRENT_TRACKERS,
  autoPreload: loadTorrentPreload()
})
const moduleRegistry = new MessageModuleRegistry().register(
  createTorrentMediaModule(torrentMedia)
)

function isChannelId(value) {
  return CHANNEL_ID_RE.test(String(value || '').trim())
}

function stateFor(channelId) {
  if (!channelStates.has(channelId)) {
    channelStates.set(channelId, {
      status: 'offline',
      directPeers: new Set(),
      members: new Map(),
      pendingJoins: new Set(),
      unread: 0,
      selfId: ''
    })
  }
  return channelStates.get(channelId)
}

function advertisedChannels() {
  return [...new Set([...channels, ...discoveredChannels])].slice(0, 100)
}

function applyHash(channelId, mode = 'replace') {
  const hash = encodeRoomHash({ roomId: channelId, tracker })
  const url = `${location.pathname}${location.search}#${hash}`
  if (location.hash === `#${hash}`) return
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}

function shareUrl(channelId = activeChannel) {
  return buildShareUrl({ roomId: channelId, tracker })
}

function persistChannelSets() {
  saveChannels([...channels])
  saveDiscoveredChannels([...discoveredChannels])
}

function renderChannels() {
  ui?.setChannels({
    channels: [...channels],
    discovered: [...discoveredChannels].filter((id) => !channels.has(id)),
    activeChannel,
    unread: Object.fromEntries([...channelStates].map(([id, state]) => [id, state.unread]))
  })
}

function renderMembers() {
  const state = stateFor(activeChannel)
  const now = Date.now()
  const peers = [...state.members]
    .filter(([, member]) => member.direct || member.expiresAt > now)
    .map(([id, member]) => ({ id, nickname: member.nickname, direct: member.direct }))
  ui?.setOnlinePeers({ id: state.selfId, nickname }, peers)
}

function renderActiveChannel({ clearMessages = false } = {}) {
  if (!activeChannel) return
  const state = stateFor(activeChannel)
  ui?.setRoomId(activeChannel)
  ui?.setShareUrl(shareUrl())
  ui?.setPeerCount(state.directPeers.size)
  ui?.setStatus(state.status)
  state.unread = 0
  renderChannels()
  renderMembers()
  if (clearMessages) {
    ui?.clearMessages()
    for (const message of loadMessages(activeChannel)) ui?.addMessage(message)
  }
}

function systemMessage(channelId, id, text) {
  if (channelId !== activeChannel) return
  ui?.addMessage({ id, type: 'system', nickname: 'system', ts: Date.now(), text })
}

function updatePublicStatus(status = runtimeCapabilities.publicStatus) {
  ui?.setPublicStatus(status)
  ui?.setUpnpSupported(runtimeCapabilities.upnpSupported)
}

function receiveChannels(values) {
  const incoming = [...new Set(values)].filter(isChannelId)
  let changed = false
  for (const channelId of incoming) {
    if (channels.has(channelId) || discoveredChannels.has(channelId)) continue
    changed = true
    if (autoAddChannels && channels.size < CHANNEL_LIMIT) {
      channels.add(channelId)
      startChannel(channelId)
    } else {
      discoveredChannels.add(channelId)
    }
  }
  if (!changed) return
  persistChannelSets()
  renderChannels()
  for (const session of sessions.values()) session.broadcastChannels()
}

async function startChannel(channelId) {
  if (sessions.has(channelId)) return sessions.get(channelId)
  if (startingSessions.has(channelId)) return startingSessions.get(channelId)
  const state = stateFor(channelId)
  state.status = 'connecting'
  if (channelId === activeChannel) renderActiveChannel()

  const promise = createMeshSession({
    roomId: channelId,
    tracker,
    nickname,
    getHistory: () => loadMessages(channelId),
    getChannels: advertisedChannels,
    getRelayPolicy: () => relaySettings,
    runtimeCapabilities,
    relayLimiter,
    events: {
      onPeerJoin(peerId) {
        state.directPeers.add(peerId)
        state.pendingJoins.add(peerId)
        state.members.set(peerId, {
          nickname: `Peer ${peerId.slice(0, 6)}`,
          direct: true,
          expiresAt: Date.now() + 60_000
        })
        if (channelId === activeChannel) renderActiveChannel()
      },
      onPeerNickname(peerId, peerNickname) {
        const existing = state.members.get(peerId) || {}
        state.members.set(peerId, {
          ...existing,
          nickname: peerNickname,
          direct: true,
          expiresAt: Date.now() + 60_000
        })
        if (state.pendingJoins.delete(peerId)) {
          systemMessage(channelId, `join:${peerId}:${Date.now()}`, `${peerNickname} joined`)
        }
        if (channelId === activeChannel) renderMembers()
      },
      onPeerLeave(peerId) {
        state.directPeers.delete(peerId)
        state.pendingJoins.delete(peerId)
        const member = state.members.get(peerId)
        if (member) state.members.set(peerId, { ...member, direct: false })
        if (channelId === activeChannel) renderActiveChannel()
      },
      onPresence(member) {
        if (member.id === state.selfId) return
        const existing = state.members.get(member.id)
        state.members.set(member.id, {
          nickname: member.nickname,
          direct: state.directPeers.has(member.id),
          expiresAt: member.expiresAt
        })
        if (!existing && !state.pendingJoins.has(member.id)) {
          systemMessage(channelId, `mesh-join:${member.id}:${Date.now()}`, `${member.nickname} joined via mesh`)
        }
        if (channelId === activeChannel) renderMembers()
      },
      onPeersChanged(peers) {
        state.directPeers = new Set(peers)
        if (channelId === activeChannel) renderActiveChannel()
      },
      onMessage(message) {
        appendMessage(channelId, message)
        if (channelId === activeChannel) ui?.addMessage(message)
        else {
          state.unread += 1
          renderChannels()
        }
      },
      onChannels(channelIds) {
        receiveChannels(channelIds)
      },
      onPublicStatus(status) {
        updatePublicStatus(status)
      },
      onError(error) {
        console.error(`[${channelId}]`, error)
        const pathFailure = /could not connect to peer|configure TURN servers/i.test(error.message)
        state.status = pathFailure
          ? state.directPeers.size
            ? `partial mesh: ${state.directPeers.size} direct; another path failed`
            : 'waiting for a reachable peer or mesh relay'
          : `error: ${error.message}`
        if (channelId === activeChannel) ui?.setStatus(state.status)
      },
      onStatus(status) {
        state.status = status
        if (channelId === activeChannel) ui?.setStatus(status)
      }
    }
  }).then((session) => {
    sessions.set(channelId, session)
    state.selfId = session.selfId || ''
    if (channelId === activeChannel) renderActiveChannel()
    return session
  }).finally(() => startingSessions.delete(channelId))

  startingSessions.set(channelId, promise)
  return promise
}

async function restartChannels() {
  for (const session of sessions.values()) session.leave()
  sessions.clear()
  startingSessions.clear()
  for (const state of channelStates.values()) {
    state.directPeers.clear()
    state.members.clear()
    state.pendingJoins.clear()
    state.status = 'connecting'
  }
  renderActiveChannel()
  await Promise.allSettled([...channels].map(startChannel))
}

async function addChannel(channelId, { activate = true } = {}) {
  const id = String(channelId || '').trim().toLowerCase()
  if (!isChannelId(id)) throw new Error('channel must be a valid UUID')
  if (!channels.has(id) && channels.size >= CHANNEL_LIMIT) {
    throw new Error(`channel limit reached (${CHANNEL_LIMIT})`)
  }
  channels.add(id)
  discoveredChannels.delete(id)
  persistChannelSets()
  renderChannels()
  const start = startChannel(id)
  for (const session of sessions.values()) session.broadcastChannels()
  if (activate) switchChannel(id)
  await start
  return id
}

function switchChannel(channelId, { historyMode = 'push' } = {}) {
  if (!channels.has(channelId)) return
  activeChannel = channelId
  stateFor(channelId).unread = 0
  applyHash(channelId, historyMode)
  renderActiveChannel({ clearMessages: true })
  startChannel(channelId)
}

function removeChannel(channelId) {
  if (!channels.has(channelId)) return
  sessions.get(channelId)?.leave()
  sessions.delete(channelId)
  channels.delete(channelId)
  channelStates.delete(channelId)
  discoveredChannels.delete(channelId)
  if (!channels.size) channels.add(generateRoomId())
  persistChannelSets()
  if (activeChannel === channelId) {
    switchChannel([...channels][0], { historyMode: 'replace' })
  } else {
    renderChannels()
  }
  for (const session of sessions.values()) session.broadcastChannels()
}

function activeSession() {
  return sessions.get(activeChannel)
}

async function boot() {
  const resolved = resolveRoomFromHash(location.hash)
  activeChannel = resolved.roomId
  const savedTracker = validateTrackerUrl(loadPreferredTracker() || DEFAULT_TRACKER)
  tracker = !isDefaultTracker(resolved.tracker) || location.hash.includes('tracker=')
    ? resolved.tracker
    : savedTracker.ok ? savedTracker.tracker : DEFAULT_TRACKER
  nickname = resolveNickname(loadNickname())
  saveNickname(nickname)

  for (const channelId of loadChannels()) if (isChannelId(channelId)) channels.add(channelId)
  channels.add(activeChannel)
  discoveredChannels.delete(activeChannel)
  persistChannelSets()
  applyHash(activeChannel)

  ui = bindUi(document, {
    onSwitchChannel: switchChannel,
    onDeleteChannel: removeChannel,
    async onAddChannel(value) {
      try {
        await addChannel(value)
        ui?.setStatus('channel added')
      } catch (error) {
        ui?.setChannelError(error.message)
      }
    },
    onAddDiscoveredChannel(channelId) {
      addChannel(channelId).catch((error) => ui?.setChannelError(error.message))
    },
    onCopyLink() {
      const url = shareUrl()
      navigator.clipboard?.writeText(url).then(
        () => ui?.setStatus('link copied'),
        () => ui?.setStatus('copy failed; select the share URL')
      )
    },
    onTrackerChange(value) {
      const validated = validateTrackerUrl(value || DEFAULT_TRACKER)
      if (!validated.ok) {
        ui?.setSettingsError(validated.error)
        return
      }
      tracker = validated.tracker
      savePreferredTracker(tracker)
      applyHash(activeChannel)
      ui?.setTracker(tracker)
      ui?.setShareUrl(shareUrl())
      restartChannels()
    },
    onNicknameChange(value) {
      const result = normalizeNickname(value)
      if (!result.ok) {
        ui?.setSettingsError(result.error)
        return
      }
      nickname = result.nickname
      saveNickname(nickname)
      for (const session of sessions.values()) session.setNickname(nickname)
      ui?.setNickname(nickname)
      renderMembers()
    },
    async onSendText(text) {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      const trimmed = text.trim()
      if (!trimmed) return
      if (isMagnetUri(trimmed)) {
        await session.sendModule(TORRENT_MEDIA_MODULE, {
          magnet: trimmed,
          title: 'Shared magnet link'
        })
      } else {
        await session.sendText(text)
      }
    },
    async onSeedFiles(files) {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      ui?.setStatus('creating torrent')
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
      ui?.setStatus('torrent published; keep this tab open to seed')
    },
    onTorrentPreloadChange(enabled) {
      torrentMedia.setAutoPreload(enabled)
      saveTorrentPreload(enabled)
    },
    onAutoAddChannelsChange(enabled) {
      autoAddChannels = enabled
      saveAutoAddChannels(enabled)
      if (enabled) {
        for (const channelId of [...discoveredChannels]) {
          if (channels.size >= CHANNEL_LIMIT) break
          addChannel(channelId, { activate: false })
        }
      }
    },
    onRelaySettingsChange(settings) {
      relaySettings = settings
      saveRelaySettings(settings)
      ui?.setRelaySettings(settings, runtimeCapabilities.publicStatus.public)
    },
    async onEnableUpnp() {
      try {
        ui?.setPublicStatus({ state: 'checking', public: false, detail: 'Opening a temporary UPnP mapping and probing it.' })
        const status = await runtimeCapabilities.enableUpnp()
        updatePublicStatus(status)
        for (const session of sessions.values()) session.refreshPublicStatus()
      } catch (error) {
        ui?.setSettingsError(error.message)
      }
    }
  }, { moduleRegistry })

  ui.setTracker(tracker)
  ui.setNickname(nickname)
  ui.setTorrentPreload(torrentMedia.autoPreload)
  ui.setAutoAddChannels(autoAddChannels)
  ui.setRelaySettings(relaySettings, runtimeCapabilities.publicStatus.public)
  updatePublicStatus()
  renderActiveChannel({ clearMessages: true })

  window.addEventListener('hashchange', () => {
    const next = resolveRoomFromHash(location.hash)
    if (next.roomId === activeChannel && normalizeTracker(next.tracker) === tracker) return
    tracker = next.tracker
    addChannel(next.roomId, { activate: false }).then(() => {
      switchChannel(next.roomId, { historyMode: 'replace' })
    })
  })

  await Promise.allSettled([...channels].map(startChannel))
  renderActiveChannel()

  setInterval(() => {
    const now = Date.now()
    for (const [channelId, state] of channelStates) {
      for (const [peerId, member] of state.members) {
        if (member.direct || member.expiresAt > now) continue
        state.members.delete(peerId)
        systemMessage(channelId, `left:${peerId}:${now}`, `${member.nickname} left`)
      }
    }
    renderMembers()
  }, MEMBER_SWEEP_MS)
}

boot().catch((error) => {
  console.error('boot failed', error)
  const status = document.getElementById('status')
  if (status) status.textContent = `boot failed: ${error?.message || error}`
})
