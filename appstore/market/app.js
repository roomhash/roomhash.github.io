import { decryptPurchaseIntent, generateIdentity, sha256File, validateMedia } from './protocol.js'
import { createBroadcastChannelTransport, createMarketRuntime } from './host-adapter.js'

const $ = (selector) => document.querySelector(selector)
const identityKey = 'roomhash-market-identity-v1'
const nodeKey = 'roomhash-market-node-v1'
const stateKey = 'roomhash-market-state-v1'
const roomId = new URLSearchParams(location.search).get('room') || location.hash.slice(1) || 'default'
let identity = JSON.parse(sessionStorage.getItem(identityKey) || 'null')
const nodeId = sessionStorage.getItem(nodeKey) || crypto.randomUUID()
sessionStorage.setItem(nodeKey, nodeId)
let previewUrls = []
let node = null

function toast(message) {
  $('#toast').textContent = message
  $('#toast').classList.add('show')
  setTimeout(() => $('#toast').classList.remove('show'), 2400)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[character])
}

const transport = createBroadcastChannelTransport(roomId, nodeId)
const runtime = createMarketRuntime({
  nodeId,
  roomId,
  transport,
  initialState: JSON.parse(sessionStorage.getItem(stateKey) || 'null'),
  persist(state) {
    sessionStorage.setItem(stateKey, JSON.stringify(state))
    if (node) queueMicrotask(render)
  }
})
await runtime.ready
node = runtime.node
$('#network').textContent = `Mesh / ${roomId} / ${nodeId.slice(0, 8)}`

function renderIdentity() {
  $('#identity-form').hidden = Boolean(identity)
  $('#identity-card').hidden = !identity
  if (identity) $('#identity-card').innerHTML = `<strong>${escapeHtml(identity.nick)}</strong><p class="meta">${escapeHtml(identity.userHash)}<br>公开身份：${escapeHtml(identity.publicContact || '未填写')}</p><button id="new-identity" class="secondary">换一个标签页身份</button>`
  $('#new-identity')?.addEventListener('click', () => {
    sessionStorage.removeItem(identityKey)
    location.reload()
  })
}

function mediaHtml(media) {
  if (!media.length) return ''
  return `<div class="media-list">${media.map((item) => {
    const url = item.webSeed || item.magnet
    return `<div><a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(item.kind)} · ${escapeHtml(item.name)}</a> <span class="meta">${Math.ceil(item.size / 1024)} KiB · ${item.sha256.slice(0, 10)}…</span></div>`
  }).join('')}</div>`
}

function renderListings() {
  const items = node.listings()
  $('#listings').innerHTML = items.length ? items.map((listing) => {
    const mine = identity?.userHash === listing.seller.userHash
    return `<article class="card" data-id="${escapeHtml(listing.listingId)}"><span class="meta">rev ${listing.revision}</span><h3>${escapeHtml(listing.title)}</h3><div class="price">${escapeHtml(listing.price.amount)} ${escapeHtml(listing.price.currency)}</div><p>${escapeHtml(listing.description)}</p>${mediaHtml(listing.media)}<div class="seller"><strong>${escapeHtml(listing.seller.nick)}</strong><div class="meta">${escapeHtml(listing.seller.userHash)}<br>${escapeHtml(listing.seller.publicContact || '无公开联系身份')}</div></div><div class="actions"><button data-buy>确认购买 / 发出意向</button>${mine ? '<button data-edit class="secondary">编辑</button><button data-withdraw class="secondary">撤下</button>' : ''}</div></article>`
  }).join('') : '<p class="meta">本节点还没有收集到在售物品。可在另一个标签页发布并点击同步。</p>'
  for (const card of document.querySelectorAll('.card')) {
    const listing = node.listingsById.get(card.dataset.id)
    card.querySelector('[data-buy]')?.addEventListener('click', () => openBuy(listing))
    card.querySelector('[data-edit]')?.addEventListener('click', () => editListing(listing))
    card.querySelector('[data-withdraw]')?.addEventListener('click', () => withdrawListing(listing))
  }
}

async function renderInbox() {
  if (!identity) { $('#inbox').innerHTML = '<p class="meta">创建身份后显示发给该卖家 hash 的密文。</p>'; return }
  const intents = node.intentsForSeller(identity.userHash)
  if (!intents.length) { $('#inbox').innerHTML = '<p class="meta">尚未收到购买意向。</p>'; return }
  const blocks = await Promise.all(intents.map(async (intent) => {
    try {
      const secret = await decryptPurchaseIntent(intent, identity)
      const title = node.listingsById.get(intent.listingId)?.title || intent.listingId
      return `<article class="intent"><strong>${escapeHtml(title)}</strong><div class="meta">意向 ${escapeHtml(intent.orderIntentId)}<br>买家 hash：${escapeHtml(secret.buyerHash)}</div><div class="secret"><b>${escapeHtml(secret.buyerNick)}</b><p>联系方式：${escapeHtml(secret.contact)}<br>收货/交付：${escapeHtml(secret.delivery)}<br>备注：${escapeHtml(secret.note || '无')}</p><strong>请卖家主动联系买家商讨交付。</strong></div></article>`
    } catch {
      return `<article class="intent"><span class="meta">收到一条无法用当前私钥解密的意向：${escapeHtml(intent.orderIntentId)}</span></article>`
    }
  }))
  $('#inbox').innerHTML = blocks.join('')
}

function render() {
  renderIdentity()
  renderListings()
  renderInbox().catch(() => {})
}

$('#identity-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  identity = await generateIdentity({ nick: data.get('nick'), publicContact: data.get('publicContact') })
  sessionStorage.setItem(identityKey, JSON.stringify(identity))
  render()
  toast('身份密钥已在本标签页生成')
})

$('#files').addEventListener('change', async (event) => {
  for (const url of previewUrls) URL.revokeObjectURL(url)
  previewUrls = []
  const descriptors = []
  const previews = []
  for (const file of event.target.files) {
    const url = URL.createObjectURL(file)
    previewUrls.push(url)
    previews.push(file.type.startsWith('video/') ? `<video src="${url}" controls></video>` : `<img src="${url}" alt="">`)
    descriptors.push({ name: file.name, mime: file.type, size: file.size, sha256: await sha256File(file), magnet: '', webSeed: '' })
  }
  $('#previews').innerHTML = previews.join('')
  if (descriptors.length) toast('已计算 SHA-256；需宿主发布后补入 magnet/webSeed')
})

$('#listing-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!identity) return toast('请先生成卖家身份')
  try {
    const form = event.currentTarget
    const data = new FormData(form)
    const existing = data.get('listingId') ? node.listingsById.get(data.get('listingId')) : null
    const slug = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
    const media = validateMedia(JSON.parse(data.get('media') || '[]'))
    await node.publishListing({
      listingId: existing?.listingId || `${identity.userHash}:${slug}`,
      title: data.get('title'), price: { amount: data.get('amount'), currency: data.get('currency') },
      description: data.get('description'), media, status: 'active', revision: (existing?.revision || 0) + 1
    }, identity)
    form.reset(); form.elements.currency.value = 'CNY'; form.elements.media.value = '[]'
    toast(existing ? '更新已签名并广播' : '物品已签名并广播')
  } catch (error) { toast(error.message) }
})

function editListing(listing) {
  const form = $('#listing-form')
  form.elements.listingId.value = listing.listingId
  form.elements.title.value = listing.title
  form.elements.amount.value = listing.price.amount
  form.elements.currency.value = listing.price.currency
  form.elements.description.value = listing.description
  form.elements.media.value = JSON.stringify(listing.media, null, 2)
  form.scrollIntoView({ behavior: 'smooth' })
}

async function withdrawListing(listing) {
  if (!identity || listing.seller.userHash !== identity.userHash) return
  await node.publishListing({ ...listing, status: 'withdrawn', revision: listing.revision + 1, media: listing.media }, identity)
  toast('物品已撤下；撤下事件会继续公开同步')
}

function openBuy(listing) {
  if (!identity) return toast('请先生成买家身份')
  $('#buy-form').elements.listingId.value = listing.listingId
  $('#buy-form').elements.buyerNick.value = identity.nick
  $('#buy-title').textContent = `${listing.title} · ${listing.price.amount} ${listing.price.currency}`
  $('#buy-dialog').showModal()
}

$('#cancel-buy').addEventListener('click', () => $('#buy-dialog').close())
$('#buy-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  const data = new FormData(event.currentTarget)
  const listing = node.listingsById.get(data.get('listingId'))
  try {
    await node.publishPurchaseIntent({ listing, buyerIdentity: identity, buyerNick: data.get('buyerNick'), contact: data.get('contact'), delivery: data.get('delivery'), note: data.get('note') })
    $('#buy-dialog').close()
    event.currentTarget.reset()
    toast('购买意向已端到端加密并广播，请等待卖家主动联系')
  } catch (error) { toast(error.message) }
})

$('#sync').addEventListener('click', async () => { await node.sync(); toast('已广播 anti-entropy 清单') })
window.addEventListener('beforeunload', () => { previewUrls.forEach(URL.revokeObjectURL); runtime.close(); transport.close() })
setTimeout(() => node.sync().catch(() => {}), 250)
render()
