import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { LocalBusTransport, PeerSession } from '../src/session.js'
import { deserializeMessage } from '../src/message.js'

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - start > timeoutMs) {
        return reject(new Error('waitFor timeout'))
      }
      setTimeout(tick, intervalMs)
    }
    tick()
  })
}

describe('peer session protocol (shipped PeerSession + LocalBus)', () => {
  it('uses the redundant default tracker pool and pins custom trackers', () => {
    const base = {
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      nickname: 'Alice'
    }
    const defaultSession = new PeerSession(base)
    assert.equal(defaultSession.buildTrysteroConfig().relayConfig, undefined)

    const custom = new PeerSession({
      ...base,
      tracker: 'wss://tracker.example.com/announce'
    })
    assert.deepEqual(custom.buildTrysteroConfig().relayConfig, {
      urls: ['wss://tracker.example.com/announce']
    })
  })

  it('two peers exchange text with same message shape UI renders', async () => {
    const bus = new LocalBusTransport()
    const received = []

    const a = new PeerSession({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      nickname: 'Alice',
      joinRoom: bus.joinRoom,
      events: {
        onMessage(msg) {
          if (!msg.local) received.push(msg)
        }
      }
    })
    const b = new PeerSession({
      roomId: '550e8400-e29b-41d4-a716-446655440000',
      nickname: 'Bob',
      joinRoom: bus.joinRoom,
      events: {}
    })

    await a.start()
    await b.start()
    await waitFor(() => a.getPeers().length >= 1 && b.getPeers().length >= 1)

    const sent = await b.sendText('hello from bob')
    assert.equal(sent.type, 'text')
    assert.equal(sent.text, 'hello from bob')
    assert.equal(sent.nickname, 'Bob')

    await waitFor(() => received.length >= 1)
    const got = received[0]
    assert.equal(got.type, 'text')
    assert.equal(got.text, 'hello from bob')
    assert.equal(got.nickname, 'Bob')
    assert.equal(got.local, false)
    // wire path uses real serialize/deserialize
    assert.equal(deserializeMessage(JSON.stringify({
      id: got.id,
      type: got.type,
      nickname: got.nickname,
      ts: got.ts,
      text: got.text
    })).text, 'hello from bob')

    a.leave()
    b.leave()
  })

  it('file/blob chunk assembly path yields renderable file message', async () => {
    const bus = new LocalBusTransport()
    /** @type {import('../src/message.js').ChatMessage[]} */
    const received = []

    const a = new PeerSession({
      roomId: '123e4567-e89b-12d3-a456-426614174000',
      nickname: 'Recv',
      joinRoom: bus.joinRoom,
      useFileActions: false,
      events: {
        onMessage(msg) {
          if (!msg.local && msg.type === 'file') received.push(msg)
        }
      }
    })
    const b = new PeerSession({
      roomId: '123e4567-e89b-12d3-a456-426614174000',
      nickname: 'Send',
      joinRoom: bus.joinRoom,
      useFileActions: false,
      events: {}
    })

    await a.start()
    await b.start()
    await waitFor(() => a.getPeers().length >= 1)

    const bytes = new TextEncoder().encode('png-ish-bytes')
    const sent = await b.sendFile(
      {
        name: 'tiny.bin',
        mime: 'application/octet-stream',
        size: bytes.length,
        bytes
      },
      { mode: 'wire' }
    )

    assert.equal(sent.type, 'file')
    assert.equal(sent.file.name, 'tiny.bin')
    assert.ok(sent.dataUrl?.startsWith('data:'))

    await waitFor(() => received.length >= 1)
    const got = received[0]
    assert.equal(got.type, 'file')
    assert.equal(got.file.name, 'tiny.bin')
    assert.equal(got.file.size, bytes.length)
    assert.ok(got.dataUrl?.startsWith('data:application/octet-stream;base64,'))
    assert.equal(got.local, false)

    a.leave()
    b.leave()
  })

  it('nickname change broadcasts to peers', async () => {
    const bus = new LocalBusTransport()
    const a = new PeerSession({
      roomId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      nickname: 'A1',
      joinRoom: bus.joinRoom
    })
    const b = new PeerSession({
      roomId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      nickname: 'B1',
      joinRoom: bus.joinRoom
    })
    await a.start()
    await b.start()
    await waitFor(() => a.getPeers().length >= 1)
    const peerB = a.getPeers()[0]
    b.setNickname('B-renamed')
    await waitFor(() => a.getPeerNickname(peerB) === 'B-renamed')
    assert.equal(a.getPeerNickname(peerB), 'B-renamed')
    a.leave()
    b.leave()
  })

  it('exchanges registered module payloads', async () => {
    const bus = new LocalBusTransport()
    const received = []
    const a = new PeerSession({
      roomId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      nickname: 'A',
      joinRoom: bus.joinRoom,
      events: { onMessage: (msg) => !msg.local && received.push(msg) }
    })
    const b = new PeerSession({
      roomId: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
      nickname: 'B',
      joinRoom: bus.joinRoom
    })
    await a.start()
    await b.start()
    await waitFor(() => a.getPeers().length === 1)
    await b.sendModule('torrent.media', { magnet: 'magnet:?xt=urn:btih:abc' })
    await waitFor(() => received.length === 1)
    assert.equal(received[0].module, 'torrent.media')
    assert.equal(received[0].payload.magnet, 'magnet:?xt=urn:btih:abc')
    a.leave()
    b.leave()
  })
})
