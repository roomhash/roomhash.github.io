/** RoomHash DOM rendering and workspace controls. */

import { normalizeMimeType } from './message.js'
import { applyDocumentTranslations, getLanguage, getLanguagePreference, localizeError, statusText, t } from './i18n.js'

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function safeDataUrl(value, expectedMime) {
  if (typeof value !== 'string') return ''
  const comma = value.indexOf(',')
  if (comma < 0 || comma > 160) return ''
  const match = /^data:([^;,]+);base64$/i.exec(value.slice(0, comma))
  if (!match || normalizeMimeType(match[1]) !== normalizeMimeType(expectedMime)) return ''
  return /^[a-z0-9+/]*={0,2}$/i.test(value.slice(comma + 1)) ? value : ''
}

export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString(getLanguage(), { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

export function shortHash(value, length = 6) {
  return String(value || '').replace(/-/g, '').slice(0, length)
}

export function renderMessageHtml(msg) {
  const time = formatTime(msg.ts)
  const who = escapeHtml(msg.nickname || t('members.peer'))
  const cls = [
    'msg',
    msg.local ? 'msg-local' : 'msg-remote',
    msg.type === 'file' ? 'msg-file' : '',
    msg.type === 'system' ? 'msg-system' : ''
  ].filter(Boolean).join(' ')

  if (msg.type === 'system') {
    const timeHtml = msg.omitTime ? '' : `<span class="msg-time">${time}</span> `
    return `<div class="${cls}" data-id="${escapeHtml(msg.id)}">${timeHtml}<span class="msg-system-text">${escapeHtml(msg.text || '')}</span></div>`
  }

  if (msg.type === 'file' && msg.file) {
    const name = escapeHtml(msg.file.name)
    const mime = normalizeMimeType(msg.file.mime)
    const dataUrl = safeDataUrl(msg.dataUrl, mime)
    const safeUrl = escapeHtml(dataUrl)
    const body = mime.startsWith('image/') && dataUrl
      ? `<img class="msg-image" src="${safeUrl}" alt="${name}" />`
      : dataUrl
        ? `<a class="msg-file-link" href="${safeUrl}" download="${name}">${name}</a> <span class="msg-meta">${escapeHtml(t('message.bytes', { size: msg.file.size }))}</span>`
        : `<span class="msg-file-link">${name}</span> <span class="msg-meta">${escapeHtml(t('message.bytes', { size: msg.file.size }))}</span>`
    return `<article class="${cls}" data-id="${escapeHtml(msg.id)}">
      <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
      <div class="msg-body">${body}</div>
    </article>`
  }

  if (msg.type === 'module') {
    return `<article class="${cls}" data-id="${escapeHtml(msg.id)}">
      <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
      <div class="msg-body msg-module-fallback">${escapeHtml(t('message.unsupportedModule', { module: msg.module || 'unknown' }))}</div>
    </article>`
  }

  return `<article class="${cls}" data-id="${escapeHtml(msg.id)}">
    <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
    <div class="msg-body">${escapeHtml(msg.text || '')}</div>
  </article>`
}

export function appendMessageToList(listEl, msg, moduleRegistry = null) {
  if (!listEl || [...listEl.children].some((child) => child.dataset?.id === String(msg.id))) return
  const wrap = listEl.ownerDocument.createElement('div')
  wrap.innerHTML = renderMessageHtml(msg)
  const node = wrap.firstElementChild
  if (node && msg.type === 'module' && moduleRegistry?.canRender(msg)) {
    const body = node.querySelector('.msg-body')
    const rendered = moduleRegistry.render(msg, { document: listEl.ownerDocument, message: msg })
    if (body && rendered) body.replaceChildren(rendered)
  }
  if (node) listEl.appendChild(node)
  listEl.scrollTop = listEl.scrollHeight
}

function setDialogOpen(dialog, open) {
  if (!dialog) return
  if (open && !dialog.open) dialog.showModal()
  if (!open && dialog.open) dialog.close()
}

export function bindUi(doc, handlers, { moduleRegistry = null } = {}) {
  const byId = (id) => doc.getElementById(id)
  const els = {
    channelList: byId('channel-list'),
    discoveredList: byId('discovered-list'),
    channelInput: byId('channel-input'),
    addChannel: byId('add-channel'),
    channelError: byId('channel-error'),
    roomId: byId('room-id'),
    roomContext: byId('room-context'),
    shareUrl: byId('share-url'),
    copyLink: byId('copy-link'),
    channelNameInput: byId('channel-name-input'),
    applyChannelName: byId('apply-channel-name'),
    trackerInput: byId('tracker-input'),
    applyTracker: byId('apply-tracker'),
    nickInput: byId('nick-input'),
    applyNick: byId('apply-nick'),
    peerCount: byId('peer-count'),
    status: byId('status'),
    messages: byId('messages'),
    messageInput: byId('message-input'),
    sendBtn: byId('send-btn'),
    fileInput: byId('file-input'),
    attachBtn: byId('attach-btn'),
    torrentPreload: byId('torrent-preload'),
    onlineList: byId('online-list'),
    settingsDialog: byId('settings-dialog'),
    openSettings: byId('open-settings'),
    closeSettings: byId('close-settings'),
    settingsError: byId('settings-error'),
    autoAddChannels: byId('auto-add-channels'),
    relayBandwidth: byId('relay-bandwidth'),
    relayFrequency: byId('relay-frequency'),
    applyRelay: byId('apply-relay'),
    relayEffective: byId('relay-effective'),
    publicState: byId('public-state'),
    publicDetail: byId('public-detail'),
    enableUpnp: byId('enable-upnp'),
    navToggle: byId('nav-toggle'),
    membersToggle: byId('members-toggle')
    ,collapseSidebar: byId('collapse-sidebar')
    ,collapseChannelList: byId('collapse-channel-list')
    ,collapseMembers: byId('collapse-members')
    ,languageSelect: byId('language-select')
  }

  applyDocumentTranslations(doc)
  if (els.languageSelect) els.languageSelect.value = getLanguagePreference()

  const layoutStore = doc.defaultView?.localStorage
  const isNarrow = () => doc.defaultView?.matchMedia?.('(max-width: 720px)').matches
  const isCompact = () => doc.defaultView?.matchMedia?.('(max-width: 1050px)').matches
  const persistLayout = (key, enabled) => {
    try { layoutStore?.setItem(`roomhash:layout:${key}`, String(enabled)) } catch { /* ignore */ }
  }
  const restoreLayout = (key) => {
    try { return layoutStore?.getItem(`roomhash:layout:${key}`) === 'true' } catch { return false }
  }
  const syncCollapseAria = () => {
    const sidebarExpanded = !doc.body.classList.contains('channel-rail-collapsed')
    const channelListExpanded = !doc.body.classList.contains('channel-list-collapsed')
    const membersExpanded = !doc.body.classList.contains('member-rail-collapsed')
    els.collapseSidebar?.setAttribute('aria-expanded', String(sidebarExpanded))
    els.collapseSidebar?.setAttribute('aria-label', t(sidebarExpanded ? 'aria.collapseChannelSidebar' : 'aria.expandChannelSidebar'))
    els.collapseChannelList?.setAttribute('aria-expanded', String(channelListExpanded))
    els.collapseChannelList?.setAttribute('aria-label', t(channelListExpanded ? 'aria.collapseChannelList' : 'aria.expandChannelList'))
    els.collapseMembers?.setAttribute('aria-expanded', String(membersExpanded))
    els.collapseMembers?.setAttribute('aria-label', t(membersExpanded ? 'aria.collapseMembers' : 'aria.expandMembers'))
  }
  if (!isNarrow() && restoreLayout('channel-rail')) doc.body.classList.add('channel-rail-collapsed')
  if (!isCompact() && restoreLayout('member-rail')) doc.body.classList.add('member-rail-collapsed')
  if (restoreLayout('channel-list')) doc.body.classList.add('channel-list-collapsed')
  syncCollapseAria()

  const run = async (task) => {
    try {
      await task()
    } catch (error) {
      if (els.status) els.status.textContent = t('status.error', { message: localizeError(error) })
    }
  }

  els.addChannel?.addEventListener('click', () => handlers.onAddChannel?.(els.channelInput?.value))
  els.channelInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') handlers.onAddChannel?.(els.channelInput.value)
  })
  els.copyLink?.addEventListener('click', () => handlers.onCopyLink?.())
  els.applyChannelName?.addEventListener('click', () => handlers.onChannelNameChange?.(els.channelNameInput?.value))
  els.applyTracker?.addEventListener('click', () => handlers.onTrackerChange?.(els.trackerInput?.value))
  els.applyNick?.addEventListener('click', () => handlers.onNicknameChange?.(els.nickInput?.value))
  els.languageSelect?.addEventListener('change', () => handlers.onLanguageChange?.(els.languageSelect.value))
  els.openSettings?.addEventListener('click', () => setDialogOpen(els.settingsDialog, true))
  els.closeSettings?.addEventListener('click', () => setDialogOpen(els.settingsDialog, false))
  els.settingsDialog?.addEventListener('click', (event) => {
    if (event.target === els.settingsDialog) setDialogOpen(els.settingsDialog, false)
  })

  const send = () => {
    const text = els.messageInput?.value || ''
    if (!text.trim()) return
    run(() => handlers.onSendText?.(text))
    els.messageInput.value = ''
  }
  els.sendBtn?.addEventListener('click', send)
  els.messageInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  })

  els.attachBtn?.addEventListener('click', () => els.fileInput?.click())
  els.fileInput?.addEventListener('change', () => {
    const files = els.fileInput?.files
    if (files?.length) run(() => handlers.onSeedFiles?.(files))
    els.fileInput.value = ''
  })
  els.torrentPreload?.addEventListener('change', () => handlers.onTorrentPreloadChange?.(els.torrentPreload.checked))
  els.autoAddChannels?.addEventListener('change', () => handlers.onAutoAddChannelsChange?.(els.autoAddChannels.checked))
  els.applyRelay?.addEventListener('click', () => handlers.onRelaySettingsChange?.({
    bandwidthKbps: Number(els.relayBandwidth?.value || 0),
    messagesPerSecond: Number(els.relayFrequency?.value || 0)
  }))
  els.enableUpnp?.addEventListener('click', () => run(() => handlers.onEnableUpnp?.()))
  const toggleChannelRail = () => {
    if (isNarrow()) {
      doc.body.classList.toggle('channels-open')
      return
    }
    const collapsed = doc.body.classList.toggle('channel-rail-collapsed')
    persistLayout('channel-rail', collapsed)
    syncCollapseAria()
  }
  const toggleMemberRail = () => {
    if (isCompact()) {
      doc.body.classList.toggle('members-open')
      return
    }
    const collapsed = doc.body.classList.toggle('member-rail-collapsed')
    persistLayout('member-rail', collapsed)
    syncCollapseAria()
  }
  els.navToggle?.addEventListener('click', toggleChannelRail)
  els.collapseSidebar?.addEventListener('click', toggleChannelRail)
  els.membersToggle?.addEventListener('click', toggleMemberRail)
  els.collapseMembers?.addEventListener('click', toggleMemberRail)
  els.collapseChannelList?.addEventListener('click', () => {
    const collapsed = doc.body.classList.toggle('channel-list-collapsed')
    persistLayout('channel-list', collapsed)
    syncCollapseAria()
  })

  return {
    els,
    setChannels({ channels, discovered, activeChannel, unread, names = {} }) {
      els.channelList?.replaceChildren()
      for (const channelId of channels) {
        const row = doc.createElement('div')
        row.className = `channel-row${channelId === activeChannel ? ' active' : ''}`
        const select = doc.createElement('button')
        select.className = 'channel-select'
        select.type = 'button'
        select.title = channelId
        select.setAttribute('aria-current', channelId === activeChannel ? 'page' : 'false')
        const hash = doc.createElement('span')
        hash.className = 'channel-hash'
        hash.textContent = '#'
        const label = doc.createElement('span')
        label.textContent = names[channelId] || shortHash(channelId, 8)
        select.append(hash, label)
        if (unread?.[channelId]) {
          const badge = doc.createElement('span')
          badge.className = 'unread-badge'
          badge.textContent = unread[channelId] > 99 ? '99+' : String(unread[channelId])
          select.appendChild(badge)
        }
        select.addEventListener('click', () => {
          handlers.onSwitchChannel?.(channelId)
          doc.body.classList.remove('channels-open')
        })
        const copy = doc.createElement('button')
        copy.className = 'channel-copy'
        copy.type = 'button'
        copy.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h11v11H8z"/><path d="M16 8V5H5v11h3"/></svg>'
        copy.setAttribute('aria-label', t('channels.copy', { channel: names[channelId] || channelId }))
        copy.addEventListener('click', () => handlers.onCopyChannelUrl?.(channelId))
        const remove = doc.createElement('button')
        remove.className = 'channel-remove'
        remove.type = 'button'
        remove.textContent = 'x'
        remove.setAttribute('aria-label', t('channels.delete', { channel: names[channelId] || channelId }))
        remove.addEventListener('click', () => handlers.onDeleteChannel?.(channelId))
        row.append(select, copy, remove)
        els.channelList?.appendChild(row)
      }

      els.discoveredList?.replaceChildren()
      for (const channelId of discovered) {
        const button = doc.createElement('button')
        button.className = 'discovered-channel'
        button.type = 'button'
        button.title = channelId
        button.textContent = `+ ${names[channelId] || `#${shortHash(channelId, 8)}`}`
        button.addEventListener('click', () => handlers.onAddDiscoveredChannel?.(channelId))
        els.discoveredList?.appendChild(button)
      }
      if (!discovered.length && els.discoveredList) {
        const empty = doc.createElement('p')
        empty.className = 'empty-hint'
        empty.textContent = t('channels.noneDiscovered')
        els.discoveredList.appendChild(empty)
      }
    },
    setChannelError(value) {
      if (els.channelError) els.channelError.textContent = value ? localizeError(value) : ''
    },
    setSettingsError(value) {
      if (els.settingsError) els.settingsError.textContent = value ? localizeError(value) : ''
    },
    setRoomId(id, name = '') {
      if (els.roomId) els.roomId.textContent = name || `#${shortHash(id, 8)}`
      if (els.roomId) els.roomId.title = id
      if (els.roomContext) els.roomContext.textContent = name
        ? `#${shortHash(id, 8)} · ${t('room.context')}`
        : t('room.context')
    },
    setChannelName(name) {
      if (els.channelNameInput) els.channelNameInput.value = name || ''
    },
    setShareUrl(url) {
      if (els.shareUrl) els.shareUrl.value = url
    },
    setTracker(value) {
      if (els.trackerInput) els.trackerInput.value = value
    },
    setNickname(value) {
      if (els.nickInput) els.nickInput.value = value
    },
    setPeerCount(value) {
      if (els.peerCount) els.peerCount.textContent = String(value)
    },
    setStatus(value) {
      if (els.status) els.status.textContent = statusText(value)
    },
    setOnlinePeers(self, peers) {
      if (!els.onlineList) return
      els.onlineList.replaceChildren()
      const members = [{ ...self, self: true }, ...peers]
      for (const member of members) {
        const item = doc.createElement('div')
        item.className = `member${member.self ? ' member-self' : ''}`
        const avatar = doc.createElement('span')
        avatar.className = 'member-avatar'
        avatar.textContent = String(member.nickname || '?').slice(0, 1).toUpperCase()
        const copy = doc.createElement('span')
        copy.className = 'member-copy'
        const name = doc.createElement('strong')
        name.textContent = member.nickname || t('members.peer')
        const hash = doc.createElement('small')
        hash.textContent = member.self ? `(${t('members.you')}${member.id ? ` / ${shortHash(member.id)}` : ''})` : `(${shortHash(member.id)})`
        copy.append(name, hash)
        const dot = doc.createElement('span')
        dot.className = `member-dot${member.direct || member.self ? ' direct' : ' mesh'}`
        dot.title = member.direct || member.self ? t('members.direct') : t('members.mesh')
        item.append(avatar, copy, dot)
        els.onlineList.appendChild(item)
      }
    },
    setTorrentPreload(enabled) {
      if (els.torrentPreload) els.torrentPreload.checked = Boolean(enabled)
    },
    setAutoAddChannels(enabled) {
      if (els.autoAddChannels) els.autoAddChannels.checked = Boolean(enabled)
    },
    setRelaySettings(settings, effective) {
      if (els.relayBandwidth) els.relayBandwidth.value = String(settings.bandwidthKbps)
      if (els.relayFrequency) els.relayFrequency.value = String(settings.messagesPerSecond)
      if (els.relayEffective) els.relayEffective.textContent = effective
        ? t('settings.relayActive')
        : t('settings.relayInactive')
    },
    setPublicStatus(status) {
      if (els.publicState) {
        els.publicState.textContent = status.public ? t('relay.public') : status.state === 'checking' ? t('relay.checking') : t('relay.private')
        els.publicState.dataset.state = status.public ? 'public' : status.state
      }
      if (els.publicDetail) {
        const detailKey = status.detailKey || (status.public ? 'relay.verified' : status.state === 'browser-limited' ? 'relay.browserLimited' : status.state === 'checking' ? 'relay.waitingProbe' : 'relay.notReachable')
        els.publicDetail.textContent = t(detailKey, {}, status.detail || '')
      }
    },
    setUpnpSupported(supported) {
      if (!els.enableUpnp) return
      els.enableUpnp.disabled = !supported
      els.enableUpnp.title = t(supported ? 'settings.upnpSupported' : 'settings.upnpUnsupported')
    },
    addMessage(message) {
      appendMessageToList(els.messages, message, moduleRegistry)
    },
    upsertSystemMessage(message) {
      const existing = [...(els.messages?.children || [])].find(
        (child) => child.dataset?.id === String(message.id)
      )
      if (existing) {
        const text = existing.querySelector('.msg-system-text')
        if (text) text.textContent = message.text || ''
        els.messages.scrollTop = els.messages.scrollHeight
        return
      }
      appendMessageToList(els.messages, message, moduleRegistry)
    },
    clearMessages() {
      els.messages?.replaceChildren()
    },
    translate() {
      applyDocumentTranslations(doc)
      if (els.languageSelect) els.languageSelect.value = getLanguagePreference()
      syncCollapseAria()
    }
  }
}
