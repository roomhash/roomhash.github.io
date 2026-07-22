/** RoomHash application shell: multi-channel mesh chat and torrent media. */

import { DEFAULT_TRACKER, DEFAULT_TORRENT_TRACKERS } from './config.js'
import {
  generateRoomId,
  isDefaultTracker,
  normalizeTracker,
  validateTrackerUrl
} from './room-url.js'
import {
  buildNamedShareUrl,
  encodeNamedRoomHash,
  normalizeChannelName,
  resolveNamedRoomFromHash
} from './channel-url.js'
import { normalizeNickname, resolveNickname } from './nickname.js'
import { createMeshSession } from './network/mesh-session.js'
import { RelayLimiter } from './network/gossip.js'
import { RuntimeCapabilities } from './network/runtime-capabilities.js'
import { DEMO_PIXEL_GARDEN, DEMO_VIDEO } from './demo-content.js'
import { appstoreArtifactUrl, appstoreRuntimeMagnet } from './appstore.js'
import {
  appendMessage,
  loadAutoAddChannels,
  loadChannelNames,
  loadChannels,
  loadDiscoveredChannels,
  loadMessages,
  loadNickname,
  loadPreferredTracker,
  loadRelaySettings,
  loadTorrentPreload,
  saveAutoAddChannels,
  saveChannelNames,
  saveChannels,
  saveDiscoveredChannels,
  saveNickname,
  savePreferredTracker,
  saveRelaySettings,
  saveTorrentPreload
} from './storage.js'
import { bindUi } from './ui.js'
import { clientLog } from './client-log.js'
import { localizeError, setLanguagePreference, t } from './i18n.js'
import { MessageModuleRegistry } from './modules/registry.js'
import {
  TORRENT_MEDIA_MODULE,
  TorrentMediaController,
  createTorrentMediaModule,
  isMagnetUri
} from './modules/torrent-media.js'
import {
  WASM_APP_EVENT_MODULE,
  WASM_APP_MODULE,
  WasmAppController,
  createWasmAppModule,
  detectWasmAppManifest
} from './modules/wasm-app.js'

const CHANNEL_LIMIT = 32
const MEMBER_SWEEP_MS = 10_000
const PRESENCE_AGGREGATE_MS = 2 * 60 * 1000
const CHANNEL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

let ui = null
let activeChannel = ''
let tracker = DEFAULT_TRACKER
let nickname = ''
let autoAddChannels = loadAutoAddChannels()
let relaySettings = loadRelaySettings()

const channels = new Set()
const channelNames = loadChannelNames()
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
const wasmApps = new WasmAppController({
  torrentMedia,
  getActiveChannel: () => activeChannel,
  getIdentity: () => ({ nickname, peerId: stateFor(activeChannel).selfId }),
  sendEvent: async (channelId, payload) => {
    const session = sessions.get(channelId)
    if (session) await session.sendModule(WASM_APP_EVENT_MODULE, payload)
  }
})
const moduleRegistry = new MessageModuleRegistry().register(
  createTorrentMediaModule(torrentMedia)
).register(createWasmAppModule(wasmApps))
torrentMedia.onSeedsChanged((seeds) => ui?.setLocalSeeds(seeds))

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
      presenceSummary: null,
      unread: 0,
      selfId: ''
    })
  }
  return channelStates.get(channelId)
}

function advertisedChannels() {
  return [...new Set([...channels, ...discoveredChannels])].slice(0, 100).map((id) => ({
    id,
    name: channelNames[id] || ''
  }))
}

function applyHash(channelId, mode = 'replace') {
  const hash = encodeNamedRoomHash({
    roomId: channelId,
    tracker,
    channelName: channelNames[channelId] || ''
  })
  const url = `${location.pathname}${location.search}#${hash}`
  if (location.hash === `#${hash}`) return
  if (mode === 'push') history.pushState(null, '', url)
  else history.replaceState(null, '', url)
}

function shareUrl(channelId = activeChannel) {
  return buildNamedShareUrl({
    roomId: channelId,
    tracker,
    channelName: channelNames[channelId] || ''
  })
}

function persistChannelSets() {
  saveChannels([...channels])
  saveChannelNames(channelNames)
  saveDiscoveredChannels([...discoveredChannels])
}

function renderChannels() {
  ui?.setChannels({
    channels: [...channels],
    discovered: [...discoveredChannels].filter((id) => !channels.has(id)),
    activeChannel,
    names: channelNames,
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
  ui?.setRoomId(activeChannel, channelNames[activeChannel] || '')
  ui?.setChannelName(channelNames[activeChannel] || '')
  ui?.setShareUrl(shareUrl())
  ui?.setPeerCount(state.directPeers.size)
  ui?.setStatus(state.status)
  state.unread = 0
  renderChannels()
  renderMembers()
  if (clearMessages) {
    ui?.clearMessages()
    for (const message of loadMessages(activeChannel)) ui?.addMessage(message)
    if (state.presenceSummary) {
      ui?.upsertSystemMessage({
        id: state.presenceSummary.id,
        type: 'system',
        nickname: 'system',
        ts: Date.now(),
        text: presenceSummaryText(state.presenceSummary),
        omitTime: true
      })
    }
  }
}

function presenceSummaryText(summary) {
  const joined = []
  const left = []
  for (const [name, event] of summary.events) {
    const label = event.mesh && event.type === 'joined' ? t('presence.mesh', { name }) : name
    if (event.type === 'joined') joined.push(label)
    else left.push(label)
  }
  return [
    joined.length ? t('presence.joined', { names: joined.join(', ') }) : '',
    left.length ? t('presence.left', { names: left.join(', ') }) : ''
  ].filter(Boolean).join(t('presence.separator'))
}

function queuePresenceChange(channelId, peerNickname, type, mesh = false) {
  const state = stateFor(channelId)
  const now = Date.now()
  if (!state.presenceSummary || now - state.presenceSummary.startedAt >= PRESENCE_AGGREGATE_MS) {
    state.presenceSummary = {
      id: `presence-summary:${channelId}:${now}`,
      startedAt: now,
      events: new Map()
    }
  }
  state.presenceSummary.events.set(peerNickname, { type, mesh, at: now })
  if (channelId !== activeChannel) return
  ui?.upsertSystemMessage({
    id: state.presenceSummary.id,
    type: 'system',
    nickname: 'system',
    ts: now,
    text: presenceSummaryText(state.presenceSummary),
    omitTime: true
  })
}

function updatePublicStatus(status = runtimeCapabilities.publicStatus) {
  ui?.setPublicStatus(status)
  ui?.setUpnpSupported(runtimeCapabilities.upnpSupported)
}

function receiveChannels(values) {
  const incoming = values.map((value) => typeof value === 'string'
    ? { id: value, name: '' }
    : { id: value?.id, name: normalizeChannelName(value?.name).name }
  ).filter((entry) => isChannelId(entry.id))
  let changed = false
  for (const entry of incoming) {
    const channelId = entry.id
    if (entry.name && !channelNames[channelId]) {
      channelNames[channelId] = entry.name
      changed = true
    }
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
          nickname: `${t('members.peer')} ${peerId.slice(0, 6)}`,
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
          queuePresenceChange(channelId, peerNickname, 'joined')
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
          queuePresenceChange(channelId, member.nickname, 'joined', true)
        }
        if (channelId === activeChannel) renderMembers()
      },
      onPeersChanged(peers) {
        state.directPeers = new Set(peers)
        if (channelId === activeChannel) renderActiveChannel()
      },
      onMessage(message) {
        if (wasmApps.handleNetworkMessage(channelId, message)) return
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
            ? { key: 'status.partialMesh', values: { count: state.directPeers.size } }
            : { key: 'status.waitingRelay' }
          : { key: 'status.error', values: { message: localizeError(error) } }
        if (channelId === activeChannel) ui?.setStatus(state.status)
      },
      onStatus(status) {
        clientLog.info('mesh', channelId.slice(0, 8), status)
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

async function addChannel(channelId, { activate = true, name = '' } = {}) {
  const id = String(channelId || '').trim().toLowerCase()
  if (!isChannelId(id)) throw new Error('channel must be a valid UUID')
  if (!channels.has(id) && channels.size >= CHANNEL_LIMIT) {
    throw new Error(`channel limit reached (${CHANNEL_LIMIT})`)
  }
  channels.add(id)
  const normalizedName = normalizeChannelName(name)
  if (normalizedName.ok && normalizedName.name) channelNames[id] = normalizedName.name
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
  delete channelNames[channelId]
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
  const resolved = resolveNamedRoomFromHash(location.hash)
  activeChannel = resolved.roomId
  if (resolved.channelName) channelNames[activeChannel] = resolved.channelName
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
        ui?.setStatus({ key: 'status.channelAdded' })
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
        () => ui?.setStatus({ key: 'status.linkCopied' }),
        () => ui?.setStatus({ key: 'status.copyFailed' })
      )
    },
    onCopyChannelUrl(channelId) {
      navigator.clipboard?.writeText(shareUrl(channelId)).then(
        () => ui?.setStatus({ key: 'status.channelLinkCopied' }),
        () => ui?.setStatus({ key: 'status.channelCopyFailed' })
      )
    },
    onChannelNameChange(value) {
      const result = normalizeChannelName(value)
      if (!result.ok) {
        ui?.setSettingsError(result.error)
        return
      }
      if (result.name) channelNames[activeChannel] = result.name
      else delete channelNames[activeChannel]
      saveChannelNames(channelNames)
      applyHash(activeChannel)
      renderActiveChannel()
      for (const session of sessions.values()) session.broadcastChannels()
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
    onLanguageChange(value) {
      setLanguagePreference(value)
      ui?.translate()
      renderActiveChannel({ clearMessages: true })
      updatePublicStatus()
    },
    async onOpenFileCabinet() {
      ui?.setLocalSeeds(await torrentMedia.getLocalSeeds())
    },
    async onStopSeed(infoHash) {
      ui?.setLocalSeeds(await torrentMedia.stopSeed(infoHash))
    },
    async onResumeSeed(infoHash) {
      ui?.setLocalSeeds(await torrentMedia.resumeSeed(infoHash))
    },
    async onRemoveSeed(infoHash) {
      ui?.setLocalSeeds(await torrentMedia.removeSeed(infoHash))
    },
    async onSendText(text) {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      const trimmed = text.trim()
      if (!trimmed) return
      if (isMagnetUri(trimmed)) {
        await session.sendModule(TORRENT_MEDIA_MODULE, {
          magnet: trimmed,
          title: ''
        })
      } else {
        await session.sendText(text)
      }
    },
    async onShareDemoVideo() {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      await session.sendModule(TORRENT_MEDIA_MODULE, DEMO_VIDEO)
    },
    async onShareDemoGame() {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      await session.sendModule(WASM_APP_MODULE, {
        ...DEMO_PIXEL_GARDEN,
        instanceId: `pixel-garden:${activeChannel}`
      })
    },
    async onShareApp(app) {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      const response = await fetch(appstoreArtifactUrl(app, app.manifest), { cache: 'no-cache' })
      if (!response.ok) throw new Error(`app manifest request failed (${response.status})`)
      const manifest = await response.json()
      if (manifest.id !== app.id || manifest.entry !== app.entry || manifest.runtime !== 'wasm') {
        throw new Error('Roomlet manifest does not match its catalog entry')
      }
      await session.sendModule(WASM_APP_MODULE, {
        magnet: appstoreRuntimeMagnet(app),
        title: `${app.name} - RoomHash WASM app`,
        manifest,
        files: [{ name: app.entry, size: app.entrySize, mime: 'application/wasm' }],
        instanceId: `${manifest.id}:${activeChannel}`
      })
      ui?.setStatus({ key: 'appstore.sent' })
    },
    async onSeedFiles(files) {
      const session = activeSession()
      if (!session) throw new Error('channel is still connecting')
      const input = Array.from(files)
      const appManifest = await detectWasmAppManifest(input)
      ui?.setStatus({ key: 'status.creatingTorrent' })
      const torrent = await torrentMedia.seed(input)
      const payload = {
        magnet: torrent.magnetURI,
        title: torrent.name || input[0]?.name || 'Shared files',
        files: torrent.files.map((file) => ({
          name: file.name,
          size: file.length,
          mime: file.type || ''
        }))
      }
      if (appManifest) {
        await session.sendModule(WASM_APP_MODULE, {
          ...payload,
          manifest: appManifest,
          instanceId: `${appManifest.id}:${activeChannel}`
        })
      } else {
        await session.sendModule(TORRENT_MEDIA_MODULE, payload)
      }
      ui?.setStatus({ key: torrent.roomHashCached ? 'status.torrentPublishedCached' : 'status.torrentCacheFailed' })
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
    onClearClientLogs() {
      clientLog.clear()
    },
    async onEnableUpnp() {
      try {
        ui?.setPublicStatus({ state: 'checking', public: false, detailKey: 'status.upnpChecking' })
        const status = await runtimeCapabilities.enableUpnp()
        updatePublicStatus(status)
        for (const session of sessions.values()) session.refreshPublicStatus()
      } catch (error) {
        ui?.setSettingsError(error.message)
      }
    }
  }, { moduleRegistry })

  clientLog.subscribe((entries) => ui?.setClientLogs(entries))

  ui.setTracker(tracker)
  ui.setNickname(nickname)
  ui.setTorrentPreload(torrentMedia.autoPreload)
  ui.setAutoAddChannels(autoAddChannels)
  ui.setRelaySettings(relaySettings, runtimeCapabilities.publicStatus.public)
  updatePublicStatus()
  renderActiveChannel({ clearMessages: true })

  window.addEventListener('hashchange', () => {
    const next = resolveNamedRoomFromHash(location.hash)
    if (next.roomId === activeChannel && normalizeTracker(next.tracker) === tracker) return
    tracker = next.tracker
    addChannel(next.roomId, { activate: false, name: next.channelName }).then(() => {
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
        queuePresenceChange(channelId, member.nickname, 'left')
      }
    }
    renderMembers()
  }, MEMBER_SWEEP_MS)
}

boot().catch((error) => {
  console.error('boot failed', error)
  const status = document.getElementById('status')
  if (status) status.textContent = t('status.bootFailed', { message: localizeError(error) })
})
