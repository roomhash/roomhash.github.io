import { VotingNode, hashUserIdentity } from './protocol.js'

const poll = {
  id: 'roomhash-lunch-demo-v1',
  title: '今天午饭吃什么？',
  options: [
    { id: 'noodles', label: '面' },
    { id: 'rice', label: '饭' },
    { id: 'salad', label: '沙拉' }
  ]
}

const randomId = () => crypto.randomUUID()
const nodeId = sessionStorage.getItem('roomhash-voting-node') || randomId()
sessionStorage.setItem('roomhash-voting-node', nodeId)
const stateKey = `roomhash-voting:${poll.id}:${nodeId}`
const channel = new BroadcastChannel(`roomhash-voting:${poll.id}`)

const node = new VotingNode({
  nodeId,
  poll,
  send: async (frame) => channel.postMessage({ sender: nodeId, frame }),
  persist: (state) => localStorage.setItem(stateKey, JSON.stringify(state))
})

const $ = (selector) => document.querySelector(selector)
const optionLabels = Object.fromEntries(poll.options.map((option) => [option.id, option.label]))

for (const [index, option] of poll.options.entries()) {
  const label = document.createElement('label')
  label.className = 'option'
  label.innerHTML = `<input type="radio" name="option" value="${option.id}" ${index === 0 ? 'checked' : ''}> ${option.label}`
  $('#options').append(label)
}

function short(value) {
  return `${value.slice(0, 10)}…${value.slice(-6)}`
}

function render() {
  const tally = node.tally()
  $('#collector').textContent = nodeId
  $('#ballot-count').textContent = `${tally.collectedBallots} 票（本地已收集）`
  $('#tally').replaceChildren(...poll.options.map((option) => {
    const count = tally.counts[option.id]
    const percent = tally.collectedBallots ? Math.round(count / tally.collectedBallots * 100) : 0
    const row = document.createElement('div')
    row.className = 'result'
    row.innerHTML = `<span>${option.label}</span><span class="bar"><i style="width:${percent}%"></i></span><strong>${count}</strong>`
    return row
  }))
  $('#audit').replaceChildren(...node.ballots().map((ballot) => {
    const row = document.createElement('tr')
    for (const [value, hash] of [
      [ballot.nick, false], [short(ballot.voterHash), true], [optionLabels[ballot.optionId], false],
      [String(ballot.revision), false], [short(ballot.eventId), true]
    ]) {
      const cell = document.createElement('td')
      cell.textContent = value
      if (hash) cell.className = 'hash'
      if (hash) cell.title = value.includes('…') ? (value === short(ballot.voterHash) ? ballot.voterHash : ballot.eventId) : value
      row.append(cell)
    }
    return row
  }))
}

channel.onmessage = async ({ data }) => {
  if (!data || data.sender === nodeId) return
  await node.receive(data.frame, data.sender)
  render()
}

$('#cast').addEventListener('click', async () => {
  try {
    const voterHash = await hashUserIdentity($('#identity').value)
    const previous = node.ballots().find((ballot) => ballot.voterHash === voterHash)
    await node.cast({
      nick: $('#nick').value,
      voterHash,
      optionId: $('input[name="option"]:checked').value,
      revision: (previous?.revision || 0) + 1
    })
    $('#status').textContent = `已公开提交 · user hash ${short(voterHash)}`
    render()
  } catch (error) {
    $('#status').textContent = error.message
  }
})

$('#sync').addEventListener('click', async () => {
  await node.sync()
  $('#status').textContent = '已广播 inventory，等待其他收集者返回缺票。'
})

try {
  const saved = JSON.parse(localStorage.getItem(stateKey) || 'null')
  await node.importState(saved)
} catch {}
render()
await node.sync()
setInterval(() => node.sync().catch(() => {}), 15_000)
