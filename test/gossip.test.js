import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MESSAGE_LIFETIME_MS,
  SeenMessageCache,
  createGossipEnvelope,
  validateGossipEnvelope
} from '../src/network/gossip.js'

describe('gossip envelope', () => {
  it('uses a time lifetime without hop limits', () => {
    const envelope = createGossipEnvelope({
      id: 'message:m1',
      kind: 'message',
      originId: 'peer-a',
      payload: '{}',
      createdAt: 1000
    })
    assert.equal(envelope.expiresAt, 1000 + MESSAGE_LIFETIME_MS)
    assert.equal('maxHops' in envelope, false)
    assert.equal(validateGossipEnvelope(envelope, 2000), true)
    assert.equal(validateGossipEnvelope(envelope, envelope.expiresAt), false)
  })

  it('deduplicates until expiry and bounds memory', () => {
    const seen = new SeenMessageCache({ maxEntries: 2 })
    seen.add('a', 100)
    seen.add('b', 200)
    seen.add('c', 300)
    assert.equal(seen.entries.has('a'), false)
    assert.equal(seen.has('b', 150), true)
    assert.equal(seen.has('b', 250), false)
  })
})
