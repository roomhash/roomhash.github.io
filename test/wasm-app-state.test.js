import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  WasmAppController,
  createWasmAppModule,
  isWasmAppTrusted,
  normalizedWasmPermissions,
  permissionPrompt,
  rememberWasmAppTrust,
  wasmTrustKey
} from '../src/modules/wasm-app.js'

const SHA = 'ABCDEF0123456789'.repeat(4)
const INFO_HASH = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01'

function manifest(overrides = {}) {
  return {
    schema: 'roomhash.app/v1',
    runtime: 'wasm',
    abi: 'portable-surface-v1',
    id: 'example.roomlet',
    name: 'Example',
    entry: 'example.wasm',
    sha256: SHA,
    permissions: ['storage:256kb', 'channel.messages'],
    ...overrides
  }
}

class MemoryStorage {
  constructor() { this.values = new Map() }
  getItem(key) { return this.values.get(key) ?? null }
  setItem(key, value) { this.values.set(key, String(value)) }
  removeItem(key) { this.values.delete(key) }
}

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName.toUpperCase()
    this.children = []
    this.dataset = {}
    this.listeners = new Map()
    this.textContent = ''
    this.disabled = false
    this.showModal = () => { this.open = true }
  }

  append(...children) { this.children.push(...children) }
  appendChild(child) { this.children.push(child); return child }
  addEventListener(type, listener) { this.listeners.set(type, listener) }
  close() { this.open = false }
  remove() { this.removed = true }
  click() { return this.listeners.get('click')?.({ preventDefault() {} }) }
}

function fakeDocument(storage = new MemoryStorage()) {
  const body = new FakeElement('body')
  return {
    body,
    defaultView: { localStorage: storage, confirm: () => true },
    createElement: (tagName) => new FakeElement(tagName)
  }
}

function payload(overrides = {}) {
  return {
    magnet: `magnet:?xt=urn:btih:${INFO_HASH}`,
    manifest: manifest(),
    files: [{ name: 'example.wasm', size: 123 }],
    ...overrides
  }
}

describe('Roomlet cached and trusted launch state', () => {
  it('canonicalizes permission order without allowing permission expansion', () => {
    const doc = fakeDocument()
    const original = manifest({ permissions: ['storage:256kb', 'channel.messages', 'storage:256kb'] })
    const reordered = manifest({ sha256: SHA.toLowerCase(), permissions: ['channel.messages', 'storage:256kb'] })
    const expanded = manifest({ permissions: ['channel.messages', 'storage:256kb', 'file.download'] })

    assert.deepEqual(normalizedWasmPermissions(original), ['channel.messages', 'storage:256kb'])
    assert.equal(wasmTrustKey(original), wasmTrustKey(reordered))
    assert.equal(rememberWasmAppTrust(doc, original), true)
    assert.equal(isWasmAppTrusted(doc, reordered), true)
    assert.equal(isWasmAppTrusted(doc, expanded), false)
  })

  it('does not migrate unsafe legacy SHA-only trust records', () => {
    const storage = new MemoryStorage()
    const doc = fakeDocument(storage)
    storage.setItem(`roomhash:wasm-trust:${SHA.toLowerCase()}`, '1')

    assert.equal(isWasmAppTrusted(doc, manifest()), false)
  })

  it('keeps run-once ephemeral and persists only trust-version', async () => {
    const doc = fakeDocument()
    const runOnce = permissionPrompt(doc, manifest())
    doc.body.children.at(-1).children[1].children[1].click()
    assert.equal(await runOnce, true)
    assert.equal(isWasmAppTrusted(doc, manifest()), false)

    const trustVersion = permissionPrompt(doc, manifest())
    doc.body.children.at(-1).children[1].children[2].click()
    assert.equal(await trustVersion, true)
    assert.equal(isWasmAppTrusted(doc, manifest()), true)
  })

  it('reports direct-open only when the exact release is cached and trusted', async () => {
    const doc = fakeDocument()
    rememberWasmAppTrust(doc, manifest())
    const calls = []
    const controller = new WasmAppController({
      torrentMedia: {
        async hasCached(infoHash, descriptor) {
          calls.push({ infoHash, descriptor })
          return true
        }
      },
      getActiveChannel: () => 'channel',
      getIdentity: () => ({}),
      sendEvent: async () => {}
    })

    assert.deepEqual(await controller.getLaunchState(payload(), doc), {
      cached: true,
      trusted: true,
      canOpen: true
    })
    assert.deepEqual(calls, [{
      infoHash: INFO_HASH.toLowerCase(),
      descriptor: { entry: 'example.wasm', size: 123 }
    }])

    assert.deepEqual(await controller.getLaunchState(payload({
      manifest: manifest({ permissions: [...manifest().permissions, 'file.download'] })
    }), doc), {
      cached: true,
      trusted: false,
      canOpen: false
    })
  })

  it('exposes the direct-open state to the rendered action', async () => {
    const doc = fakeDocument()
    const controller = {
      getLaunchState: async () => ({ cached: true, trusted: true, canOpen: true }),
      launch: async () => false
    }
    const card = createWasmAppModule(controller).render({ payload: payload() }, { document: doc })
    await new Promise((resolve) => setImmediate(resolve))

    const actions = card.children[4]
    assert.equal(actions.children[0].dataset.launchState, 'open')
  })

  it('still verifies SHA-256 bytes before asking for permission or starting a worker', async () => {
    const controller = new WasmAppController({
      torrentMedia: {
        add: async () => ({
          files: [{
            name: 'example.wasm',
            length: 3,
            blob: async () => new Blob([new Uint8Array([1, 2, 3])])
          }]
        })
      },
      getActiveChannel: () => 'channel',
      getIdentity: () => ({}),
      sendEvent: async () => {}
    })

    await assert.rejects(
      controller.launch(payload(), new FakeElement('div'), fakeDocument()),
      /SHA-256 fingerprint mismatch/
    )
  })
})
