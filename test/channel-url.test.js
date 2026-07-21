import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  encodeNamedRoomHash,
  normalizeChannelName,
  resolveNamedRoomFromHash
} from '../src/channel-url.js'

describe('named channel URLs', () => {
  const roomId = '550e8400-e29b-41d4-a716-446655440000'

  it('places an optional encoded name after the UUID', () => {
    const hash = encodeNamedRoomHash({ roomId, channelName: 'Media Room' })
    assert.equal(hash, `${roomId}/Media%20Room`)
    const resolved = resolveNamedRoomFromHash(`#${hash}`)
    assert.equal(resolved.roomId, roomId)
    assert.equal(resolved.channelName, 'Media Room')
  })

  it('preserves tracker parameters and validates name length', () => {
    const hash = encodeNamedRoomHash({
      roomId,
      channelName: 'General',
      tracker: 'wss://tracker.example.com/announce'
    })
    const resolved = resolveNamedRoomFromHash(`#${hash}`)
    assert.equal(resolved.channelName, 'General')
    assert.equal(resolved.tracker, 'wss://tracker.example.com/announce')
    assert.equal(normalizeChannelName('x'.repeat(41)).ok, false)
  })
})
