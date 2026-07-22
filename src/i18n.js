const LANGUAGE_KEY = 'roomhash:language'

// Each entry is [English, Simplified Chinese]. Keeping one compact catalog makes
// adding another locale mechanical without coupling translations to the UI.
const catalog = {
  'meta.description': ['RoomHash is a decentralized multi-channel chat and media mesh.', 'RoomHash 是一个去中心化的多频道聊天与媒体 Mesh 网络。'],
  'nav.skipMessages': ['Skip to messages', '跳到消息列表'],
  'brand.tagline': ['Peer mesh workspace', '点对点 Mesh 工作区'],
  'channels.label': ['Channels', '频道'],
  'channels.local': ['local', '本地'],
  'channels.addLabel': ['Add channel UUID', '添加频道 UUID'],
  'channels.add': ['Add channel', '添加频道'],
  'channels.discovered': ['Discovered', '发现的频道'],
  'channels.noneDiscovered': ['No channels discovered yet.', '暂未发现其他频道。'],
  'channels.copy': ['Copy link for {channel}', '复制 {channel} 的链接'],
  'channels.delete': ['Delete channel {channel}', '删除频道 {channel}'],
  'channels.rename': ['Rename channel', '重命名频道'],
  'channels.saveName': ['Save channel name', '保存频道名称'],
  'common.mesh': ['mesh', 'Mesh'],
  'common.settings': ['Settings', '设置'],
  'common.apply': ['Apply', '应用'],
  'common.copy': ['Copy', '复制'],
  'common.rename': ['Rename', '重命名'],
  'common.optional': ['(optional)', '（可选）'],
  'common.send': ['Send', '发送'],
  'common.saveRelay': ['Save relay limits', '保存转发限制'],
  'common.cancel': ['Cancel', '取消'],
  'aria.channels': ['Channels', '频道'],
  'aria.membersNetwork': ['Members and network', '成员与网络'],
  'aria.collapseChannelSidebar': ['Collapse channel sidebar', '折叠频道侧栏'],
  'aria.expandChannelSidebar': ['Expand channel sidebar', '展开频道侧栏'],
  'aria.collapseChannelList': ['Collapse channel list', '折叠频道列表'],
  'aria.expandChannelList': ['Expand channel list', '展开频道列表'],
  'aria.openChannels': ['Open channels', '打开频道'],
  'aria.openMembers': ['Open members', '打开成员列表'],
  'aria.collapseMembers': ['Collapse member sidebar', '折叠成员侧栏'],
  'aria.expandMembers': ['Expand member sidebar', '展开成员侧栏'],
  'aria.composer': ['Message composer', '消息输入区'],
  'aria.message': ['Message', '消息'],
  'aria.closeSettings': ['Close settings', '关闭设置'],
  'room.context': ['A room carried by its peers', '由在线节点共同承载的房间'],
  'connection.direct': ['direct', '直连'],
  'composer.placeholder': ['Message this channel', '发送消息到此频道'],
  'composer.attach': ['Seed and share files', '做种并分享文件'],
  'appstore.open': ['Open AppStore', '打开应用商店'],
  'appstore.eyebrow': ['RoomHash apps', 'RoomHash 应用'],
  'appstore.title': ['Send an app', '发送应用'],
  'appstore.close': ['Close AppStore', '关闭应用商店'],
  'appstore.help': ['Choose an app to share with this channel.', '选择一个应用发送到当前频道。'],
  'appstore.loading': ['Loading apps...', '正在加载应用…'],
  'appstore.empty': ['No apps are available.', '暂无可用应用。'],
  'appstore.unavailable': ['AppStore is unavailable: {message}', '应用商店暂不可用：{message}'],
  'appstore.send': ['Send', '发送'],
  'appstore.sending': ['Sending...', '发送中…'],
  'appstore.wasm': ['WASM app', 'WASM 应用'],
  'appstore.web': ['Web app', '网页应用'],
  'appstore.sent': ['app sent to this channel', '应用已发送到当前频道'],
  'demo.label': ['RoomHash demos', 'RoomHash 演示'],
  'demo.title': ['Try RoomHash together', '一起试试 RoomHash'],
  'demo.description': ['Share a streamable video or invite the room into a peer-to-peer Pixel Garden.', '分享可流式播放的视频，或邀请聊天室加入点对点像素花园。'],
  'demo.shareVideo': ['Share video', '分享视频'],
  'demo.playGame': ['Play game', '开始游戏'],
  'demo.dismiss': ['Permanently dismiss demo notice', '永久关闭演示提示'],
  'demo.restore': ['Show demo notice again', '重新显示演示提示'],
  'wasm.type': ['RoomHash WASM App', 'RoomHash WASM 应用'],
  'wasm.appId': ['App ID', '应用 ID'],
  'wasm.file': ['Entry file', '入口文件'],
  'wasm.infoHash': ['Torrent InfoHash', 'Torrent InfoHash'],
  'wasm.sha256': ['WASM SHA-256', 'WASM SHA-256'],
  'wasm.run': ['Download and run', '下载并运行'],
  'wasm.running': ['Running in an isolated worker', '正在隔离 Worker 中运行'],
  'wasm.downloading': ['Downloading and verifying app...', '正在下载并校验应用...'],
  'wasm.unsupported': ['This client does not support {abi}. The WASM remains downloadable as a file.', '当前客户端不支持 {abi}，该 WASM 仍可作为普通文件下载。'],
  'wasm.invalid': ['App validation failed: {message}', '应用校验失败：{message}'],
  'wasm.permissionTitle': ['Run {name}?', '运行 {name}？'],
  'wasm.permissionSource': ['This unsigned app came from a chat peer.', '这个未签名应用来自聊天节点。'],
  'wasm.permissionHash': ['Code fingerprint: {hash}', '代码指纹：{hash}'],
  'wasm.permissionList': ['Requested capabilities', '申请的能力'],
  'wasm.permissionIsolation': ['The app cannot access the DOM, files, camera, microphone, or arbitrary network connections.', '应用无法访问 DOM、文件、摄像头、麦克风或任意网络连接。'],
  'wasm.runOnce': ['Run once', '仅运行一次'],
  'wasm.trustVersion': ['Trust this version', '信任此版本'],
  'wasm.stop': ['Stop app', '停止应用'],
  'wasm.fullscreen': ['Full screen', '全屏'],
  'wasm.exitFullscreen': ['Exit full screen', '退出全屏'],
  'wasm.fullscreenUnavailable': ['Full screen unavailable', '无法进入全屏'],
  'wasm.flower': ['Flower {number}', '花朵 {number}'],
  'members.online': ['Online', '在线成员'],
  'members.peer': ['Peer', '节点'],
  'members.you': ['you', '你'],
  'members.direct': ['Directly connected', '已直接连接'],
  'members.mesh': ['Reachable through mesh', '可通过 Mesh 到达'],
  'cabinet.title': ['Local seeds', '本地文件柜'],
  'cabinet.open': ['Open local file cabinet', '打开本地文件柜'],
  'cabinet.close': ['Close file cabinet', '关闭文件柜'],
  'cabinet.empty': ['No locally cached seeds.', '暂无本地缓存的种子。'],
  'cabinet.seeding': ['Seeding', '做种中'],
  'cabinet.stopped': ['Stopped', '已停止'],
  'cabinet.stop': ['Stop', '停止做种'],
  'cabinet.resume': ['Resume', '恢复做种'],
  'cabinet.remove': ['Remove', '移除'],
  'logs.tools': ['Client tools', '客户端工具'],
  'logs.open': ['Client log', '客户端日志'],
  'logs.title': ['Client log', '客户端日志'],
  'logs.close': ['Close client log', '关闭客户端日志'],
  'logs.search': ['Filter logs', '筛选日志'],
  'logs.level': ['Log level', '日志级别'],
  'logs.all': ['All', '全部'],
  'logs.info': ['Info', '信息'],
  'logs.warn': ['Warnings', '警告'],
  'logs.error': ['Errors', '错误'],
  'logs.empty': ['No matching log entries.', '没有匹配的日志。'],
  'logs.clear': ['Clear log', '清空日志'],
  'cabinet.meta': ['{files} files · {size}', '{files} 个文件 · {size}'],
  'relay.state': ['Relay state', '转发状态'],
  'relay.private': ['Private / unknown', '私有 / 未知'],
  'relay.public': ['Public relay', '公网转发节点'],
  'relay.checking': ['Checking', '检测中'],
  'relay.browserDetail': ['Browser reachability is inferred conservatively.', '浏览器环境下会保守判断公网可达性。'],
  'relay.browserLimited': ['The browser sandbox cannot open or externally probe a raw port.', '浏览器沙箱无法开放原始端口或从外网探测端口。'],
  'relay.waitingProbe': ['Waiting for the host reachability probe.', '正在等待宿主进行公网可达性探测。'],
  'relay.verified': ['This node is publicly reachable and can relay mesh traffic.', '该节点已确认公网可达，可以转发 Mesh 流量。'],
  'relay.notReachable': ['No publicly reachable path has been verified.', '尚未确认任何公网可达路径。'],
  'settings.node': ['RoomHash node', 'RoomHash 节点'],
  'settings.categories': ['Settings categories', '设置分类'],
  'settings.general': ['General', '通用'],
  'settings.media': ['Media', '媒体'],
  'settings.network': ['Network', '网络'],
  'settings.identity': ['Identity and discovery', '身份与发现'],
  'settings.nickname': ['Nickname', '昵称'],
  'settings.tracker': ['Signaling tracker', '信令 Tracker'],
  'settings.currentLink': ['Current channel link', '当前频道链接'],
  'settings.channelName': ['Channel name', '频道名称'],
  'settings.channelNamePlaceholder': ['e.g. general', '例如：闲聊'],
  'settings.language': ['Language', '语言'],
  'settings.languageAuto': ['Auto (browser)', '自动（浏览器）'],
  'settings.channelExchange': ['Channel exchange', '频道交换'],
  'settings.autoAdd': ['Automatically add channels received from the mesh', '自动添加从 Mesh 收到的频道'],
  'settings.autoAddHelp': ['Off by default. Discovered UUIDs remain reviewable in the channel rail.', '默认关闭。发现的 UUID 会保留在频道侧栏中，供你确认后添加。'],
  'settings.mediaSwarm': ['Media swarm', '媒体群组'],
  'settings.autoPreload': ['Automatically preload shared torrents', '自动预加载分享的 Torrent'],
  'settings.mediaHelp': ['Attachments selected beside the composer are seeded and shared as torrent media cards.', '通过输入框旁的附件按钮选择文件后，文件会被做种并作为 Torrent 媒体卡片分享。'],
  'settings.relayLimits': ['Public relay limits', '公网转发限制'],
  'settings.bandwidth': ['Bandwidth', '带宽'],
  'settings.frequency': ['Frequency', '频率'],
  'settings.messagesPerSecond': ['messages/s', '条/秒'],
  'settings.relayActive': ['Active: this node is publicly reachable.', '已生效：该节点已确认公网可达。'],
  'settings.relayInactive': ['Saved but inactive until this node is verified public.', '已保存；确认该节点公网可达后才会生效。'],
  'settings.upnp': ['UPnP capability module', 'UPnP 能力模块'],
  'settings.upnpHelp': ['Available only when a desktop or headless RoomHash host supplies port mapping and an external reachability probe.', '仅在桌面端或 Headless RoomHash 宿主提供端口映射和外部可达性探测时可用。'],
  'settings.upnpOpen': ['Open temporary port and probe', '打开临时端口并探测'],
  'settings.upnpSupported': ['Open a temporary router mapping', '打开临时路由器端口映射'],
  'settings.upnpUnsupported': ['Requires a RoomHash desktop or headless host adapter', '需要 RoomHash 桌面端或 Headless 宿主适配器'],
  'status.initializing': ['initializing', '初始化中'],
  'status.offline': ['offline', '离线'],
  'status.connecting': ['connecting', '连接中'],
  'status.connected': ['connected', '已连接'],
  'status.left': ['left', '已离开'],
  'status.connectedTracker': ['connected · tracker {tracker}', '已连接 · Tracker {tracker}'],
  'status.partialMesh': ['partial mesh: {count} direct; another path failed', '部分连接：{count} 个直连，另一路径失败'],
  'status.waitingRelay': ['waiting for a reachable peer or mesh relay', '正在等待可达节点或 Mesh 转发节点'],
  'status.error': ['error: {message}', '错误：{message}'],
  'status.channelAdded': ['channel added', '频道已添加'],
  'status.linkCopied': ['link copied', '链接已复制'],
  'status.copyFailed': ['copy failed; select the share URL', '复制失败，请手动选择分享链接'],
  'status.channelLinkCopied': ['channel link copied', '频道链接已复制'],
  'status.channelCopyFailed': ['unable to copy channel link', '无法复制频道链接'],
  'status.creatingTorrent': ['creating torrent', '正在创建 Torrent'],
  'status.torrentPublished': ['torrent published; keep this tab open to seed', 'Torrent 已发布；请保持此标签页打开以继续做种'],
  'status.torrentPublishedCached': ['torrent published and cached for automatic reseeding', 'Torrent 已发布并缓存，刷新后会自动恢复做种'],
  'status.torrentCacheFailed': ['torrent published, but browser storage could not cache it', 'Torrent 已发布，但浏览器存储无法缓存该文件'],
  'status.upnpChecking': ['Opening a temporary UPnP mapping and probing it.', '正在打开临时 UPnP 映射并探测。'],
  'status.bootFailed': ['boot failed: {message}', '启动失败：{message}'],
  'presence.mesh': ['{name} (mesh)', '{name}（Mesh）'],
  'presence.joined': ['{names} joined', '{names} 加入了频道'],
  'presence.left': ['{names} left', '{names} 离开了频道'],
  'presence.separator': [' & ', '；'],
  'message.bytes': ['{size} bytes', '{size} 字节'],
  'message.unsupportedModule': ['Unsupported message module: {module}', '不支持的消息模块：{module}'],
  'torrent.shared': ['Shared torrent', '分享的 Torrent'],
  'torrent.loading': ['Loading torrent metadata...', '正在加载 Torrent 元数据...'],
  'torrent.tracker': ['Tracker: {tracker}', 'Tracker：{tracker}'],
  'torrent.peers': ['Peers: {count}', '节点：{count}'],
  'torrent.connection': ['State: {state}', '状态：{state}'],
  'torrent.connecting': ['connecting', '连接中'],
  'torrent.connected': ['connected', '已连接'],
  'torrent.metadataReady': ['metadata ready', '元数据已就绪'],
  'torrent.noPeers': ['waiting for WebRTC peers', '等待 WebRTC 节点'],
  'torrent.trackerWarning': ['tracker warning', 'Tracker 警告'],
  'torrent.trackerError': ['tracker unavailable', 'Tracker 不可用'],
  'torrent.seeding': ['seeding', '做种中'],
  'torrent.failed': ['failed', '失败'],
  'torrent.invalidState': ['invalid magnet', '磁力链无效'],
  'torrent.noWebRtcSeed': ['No WebRTC seed is currently available. Retry when a seeder is online.', '暂无可用 WebRTC 做种节点，请等待做种者上线后重试。'],
  'torrent.retry': ['Retry', '重试'],
  'torrent.preload': ['Preload', '预加载'],
  'torrent.preloading': ['Preloading', '预加载中'],
  'torrent.copyMagnet': ['Copy magnet', '复制磁力链'],
  'torrent.copied': ['Copied', '已复制'],
  'torrent.invalid': ['Invalid magnet link.', '磁力链无效。'],
  'torrent.progress': ['{progress}% · {peers} peers · {speed}/s', '{progress}% · {peers} 个节点 · {speed}/秒'],
  'torrent.opening': ['Opening...', '正在打开...'],
  'torrent.unavailable': ['Torrent unavailable: {message}', 'Torrent 不可用：{message}'],
  'torrent.openFailed': ['Unable to open file: {message}', '无法打开文件：{message}'],
  'torrent.download': ['Download {name}', '下载 {name}'],
  'torrent.previewLarge': ['Preview disabled for text files larger than 5 MB.', '超过 5 MB 的文本文件不提供预览。'],
  'torrent.rendered': ['Rendered', '渲染'],
  'torrent.raw': ['Raw', '原文'],
  'torrent.markdownFailed': ['Markdown render failed: {message}', 'Markdown 渲染失败：{message}'],
  'torrent.videoFallbackFailed': ['Video fallback failed: {message}', '视频备用加载失败：{message}'],
  'error.validUuid': ['Channel must be a valid UUID.', '频道必须是有效的 UUID。'],
  'error.channelLimit': ['Channel limit reached ({count}).', '已达到频道数量上限（{count}）。'],
  'error.channelConnecting': ['This channel is still connecting.', '频道仍在连接中。'],
  'error.invalidMagnet': ['Invalid magnet link.', '磁力链无效。'],
  'error.selectFile': ['Select at least one file.', '请至少选择一个文件。']
  ,'error.cachedSeedUnavailable': ['Cached seed is unavailable.', '本地缓存的种子不可用。']
}

function detectBrowserLanguage() {
  const languages = typeof navigator === 'undefined'
    ? []
    : [...(navigator.languages || []), navigator.language].filter(Boolean)
  return languages.some((value) => String(value).toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en'
}

function readPreference() {
  try {
    const value = localStorage.getItem(LANGUAGE_KEY)
    return value === 'en' || value === 'zh-CN' ? value : 'auto'
  } catch {
    return 'auto'
  }
}

let preference = readPreference()
let language = preference === 'auto' ? detectBrowserLanguage() : preference

export function getLanguage() { return language }
export function getLanguagePreference() { return preference }

export function setLanguagePreference(value) {
  preference = value === 'en' || value === 'zh-CN' ? value : 'auto'
  language = preference === 'auto' ? detectBrowserLanguage() : preference
  try {
    if (preference === 'auto') localStorage.removeItem(LANGUAGE_KEY)
    else localStorage.setItem(LANGUAGE_KEY, preference)
  } catch {
    // Keep the in-memory preference when storage is unavailable.
  }
  return language
}

export function t(key, values = {}, fallback = '') {
  const pair = catalog[key]
  const template = pair ? pair[language === 'zh-CN' ? 1 : 0] : (fallback || key)
  return String(template).replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''))
}

export function localizeError(value) {
  const message = String(value?.message || value || '')
  if (/channel must be a valid uuid/i.test(message)) return t('error.validUuid')
  const limit = /channel limit reached \((\d+)\)/i.exec(message)
  if (limit) return t('error.channelLimit', { count: limit[1] })
  if (/channel is still connecting/i.test(message)) return t('error.channelConnecting')
  if (/invalid magnet link/i.test(message)) return t('error.invalidMagnet')
  if (/select at least one file/i.test(message)) return t('error.selectFile')
  if (/cached seed is unavailable/i.test(message)) return t('error.cachedSeedUnavailable')
  return message
}

export function statusText(value) {
  if (value && typeof value === 'object' && value.key) {
    return t(value.key, value.values || {}, value.fallback || '')
  }
  const status = String(value || '')
  const exact = { initializing: 'status.initializing', offline: 'status.offline', connecting: 'status.connecting', connected: 'status.connected', left: 'status.left' }
  if (exact[status]) return t(exact[status])
  if (status.startsWith('connected · tracker ')) return t('status.connectedTracker', { tracker: status.slice(20) })
  if (status.startsWith('error: ')) return t('status.error', { message: localizeError(status.slice(7)) })
  return status
}

export function applyDocumentTranslations(root = document) {
  const doc = root.nodeType === 9 ? root : root.ownerDocument
  if (doc?.documentElement) doc.documentElement.lang = language
  root.querySelectorAll?.('[data-i18n]').forEach((node) => { node.textContent = t(node.dataset.i18n) })
  const attributes = [
    ['placeholder', 'i18nPlaceholder', '[data-i18n-placeholder]'],
    ['aria-label', 'i18nAriaLabel', '[data-i18n-aria-label]'],
    ['title', 'i18nTitle', '[data-i18n-title]'],
    ['content', 'i18nContent', '[data-i18n-content]']
  ]
  for (const [attribute, dataKey, selector] of attributes) {
    root.querySelectorAll?.(selector).forEach((node) => node.setAttribute(attribute, t(node.dataset[dataKey])))
  }
}
