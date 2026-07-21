/**
 * Minimal chat UI bindings (DOM).
 */

import { normalizeMimeType } from './message.js'

/**
 * Escape HTML text content.
 * @param {string} s
 */
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Accept only the base64 data URLs produced by the shipped file path.
 * @param {unknown} value
 * @param {string} expectedMime
 */
export function safeDataUrl(value, expectedMime) {
  if (typeof value !== 'string') return ''
  const comma = value.indexOf(',')
  if (comma < 0 || comma > 160) return ''
  const match = /^data:([^;,]+);base64$/i.exec(value.slice(0, comma))
  if (!match || normalizeMimeType(match[1]) !== normalizeMimeType(expectedMime)) {
    return ''
  }
  return /^[a-z0-9+/]*={0,2}$/i.test(value.slice(comma + 1)) ? value : ''
}

/**
 * Format timestamp for message list.
 * @param {number} ts
 */
export function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  } catch {
    return ''
  }
}

/**
 * Render a single message into HTML string.
 * @param {import('./message.js').ChatMessage} msg
 */
export function renderMessageHtml(msg) {
  const time = formatTime(msg.ts)
  const who = escapeHtml(msg.nickname || 'Peer')
  const cls = [
    'msg',
    msg.local ? 'msg-local' : 'msg-remote',
    msg.type === 'file' ? 'msg-file' : '',
    msg.type === 'system' ? 'msg-system' : ''
  ]
    .filter(Boolean)
    .join(' ')

  if (msg.type === 'system') {
    return `<div class="${cls}" data-id="${escapeHtml(msg.id)}"><span class="msg-time">${time}</span> ${escapeHtml(msg.text || '')}</div>`
  }

  if (msg.type === 'file' && msg.file) {
    const name = escapeHtml(msg.file.name)
    const mime = normalizeMimeType(msg.file.mime)
    const dataUrl = safeDataUrl(msg.dataUrl, mime)
    const safeUrl = escapeHtml(dataUrl)
    const isImage = mime.startsWith('image/') && dataUrl
    const body = isImage
      ? `<img class="msg-image" src="${safeUrl}" alt="${name}" />`
      : dataUrl
        ? `<a class="msg-file-link" href="${safeUrl}" download="${name}">📎 ${name}</a> <span class="msg-meta">(${msg.file.size} bytes)</span>`
        : `<span class="msg-file-link">📎 ${name}</span> <span class="msg-meta">(${msg.file.size} bytes)</span>`
    return `<div class="${cls}" data-id="${escapeHtml(msg.id)}">
      <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
      <div class="msg-body">${body}</div>
    </div>`
  }

  if (msg.type === 'module') {
    return `<div class="${cls}" data-id="${escapeHtml(msg.id)}">
      <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
      <div class="msg-body msg-module-fallback">Unsupported message module: ${escapeHtml(msg.module || 'unknown')}</div>
    </div>`
  }

  return `<div class="${cls}" data-id="${escapeHtml(msg.id)}">
    <div class="msg-head"><span class="msg-nick">${who}</span><span class="msg-time">${time}</span></div>
    <div class="msg-body">${escapeHtml(msg.text || '')}</div>
  </div>`
}

/**
 * Append message element to list and scroll.
 * @param {HTMLElement} listEl
 * @param {import('./message.js').ChatMessage} msg
 */
export function appendMessageToList(listEl, msg, moduleRegistry = null) {
  if (!listEl) return
  const duplicate = [...listEl.children].some(
    (child) => child.dataset?.id === String(msg.id)
  )
  if (duplicate) {
    return
  }
  const wrap = document.createElement('div')
  wrap.innerHTML = renderMessageHtml(msg)
  const node = wrap.firstElementChild
  if (node && msg.type === 'module' && moduleRegistry?.canRender(msg)) {
    const body = node.querySelector('.msg-body')
    const rendered = moduleRegistry.render(msg, {
      document: listEl.ownerDocument,
      message: msg
    })
    if (body && rendered) body.replaceChildren(rendered)
  }
  if (node) listEl.appendChild(node)
  listEl.scrollTop = listEl.scrollHeight
}

/**
 * Bind primary UI controls. Returns controllers.
 * @param {Document} doc
 * @param {object} handlers
 */
export function bindUi(doc, handlers, { moduleRegistry = null } = {}) {
  const els = {
    roomId: doc.getElementById('room-id'),
    shareUrl: doc.getElementById('share-url'),
    copyLink: doc.getElementById('copy-link'),
    trackerInput: doc.getElementById('tracker-input'),
    applyTracker: doc.getElementById('apply-tracker'),
    nickInput: doc.getElementById('nick-input'),
    applyNick: doc.getElementById('apply-nick'),
    peerCount: doc.getElementById('peer-count'),
    status: doc.getElementById('status'),
    messages: doc.getElementById('messages'),
    messageInput: doc.getElementById('message-input'),
    sendBtn: doc.getElementById('send-btn'),
    fileInput: doc.getElementById('file-input'),
    attachBtn: doc.getElementById('attach-btn'),
    torrentSeedBtn: doc.getElementById('torrent-seed-btn'),
    torrentFileInput: doc.getElementById('torrent-file-input'),
    torrentPreload: doc.getElementById('torrent-preload')
  }

  els.copyLink?.addEventListener('click', () => {
    handlers.onCopyLink?.()
  })

  els.applyTracker?.addEventListener('click', () => {
    handlers.onTrackerChange?.(els.trackerInput?.value || '')
  })

  els.applyNick?.addEventListener('click', () => {
    handlers.onNicknameChange?.(els.nickInput?.value || '')
  })

  els.nickInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handlers.onNicknameChange?.(els.nickInput.value)
  })

  const send = () => {
    const text = els.messageInput?.value || ''
    handlers.onSendText?.(text)
    if (els.messageInput) els.messageInput.value = ''
  }

  els.sendBtn?.addEventListener('click', send)
  els.messageInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send()
    }
  })

  els.attachBtn?.addEventListener('click', () => els.fileInput?.click())
  els.fileInput?.addEventListener('change', () => {
    const file = els.fileInput?.files?.[0]
    if (file) handlers.onSendFile?.(file)
    if (els.fileInput) els.fileInput.value = ''
  })

  els.torrentSeedBtn?.addEventListener('click', () => els.torrentFileInput?.click())
  els.torrentFileInput?.addEventListener('change', () => {
    const files = els.torrentFileInput?.files
    if (files?.length) handlers.onSeedFiles?.(files)
    if (els.torrentFileInput) els.torrentFileInput.value = ''
  })
  els.torrentPreload?.addEventListener('change', () => {
    handlers.onTorrentPreloadChange?.(Boolean(els.torrentPreload.checked))
  })

  return {
    els,
    setRoomId(id) {
      if (els.roomId) els.roomId.textContent = id
    },
    setShareUrl(url) {
      if (els.shareUrl) {
        els.shareUrl.value = url
        els.shareUrl.title = url
      }
    },
    setTracker(t) {
      if (els.trackerInput) els.trackerInput.value = t
    },
    setNickname(n) {
      if (els.nickInput) els.nickInput.value = n
    },
    setPeerCount(n) {
      if (els.peerCount) els.peerCount.textContent = String(n)
    },
    setStatus(s) {
      if (els.status) els.status.textContent = s
    },
    setTorrentPreload(enabled) {
      if (els.torrentPreload) els.torrentPreload.checked = Boolean(enabled)
    },
    addMessage(msg) {
      appendMessageToList(els.messages, msg, moduleRegistry)
    },
    clearMessages() {
      if (els.messages) els.messages.innerHTML = ''
    }
  }
}
