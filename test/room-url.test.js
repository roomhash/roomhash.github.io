import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildShareUrl,
  decodeRoomHash,
  encodeRoomHash,
  generateRoomId,
  isDefaultTracker,
  isValidRoomId,
  normalizeTracker,
  resolveRoomFromHash,
  validateTrackerUrl
} from '../src/room-url.js'
import { DEFAULT_TRACKER } from '../src/config.js'

describe('room-url (shipped)', () => {
  it('generateRoomId produces valid UUID form', () => {
    const id = generateRoomId()
    assert.equal(isValidRoomId(id), true)
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('missing room → new UUID via resolveRoomFromHash', () => {
    const a = resolveRoomFromHash('')
    const b = resolveRoomFromHash('#')
    assert.equal(a.created, true)
    assert.equal(b.created, true)
    assert.equal(isValidRoomId(a.roomId), true)
    assert.equal(isValidRoomId(b.roomId), true)
    // independent calls mint independent ids
    assert.notEqual(a.roomId, b.roomId)
  })

  it('same inputs → same room id (decode + re-encode)', () => {
    const id = '550e8400-e29b-41d4-a716-446655440000'
    const hash = encodeRoomHash({ roomId: id, tracker: DEFAULT_TRACKER })
    const parsed = decodeRoomHash(`#${hash}`)
    assert.equal(parsed.roomId, id)
    assert.equal(isDefaultTracker(parsed.tracker), true)
    const again = resolveRoomFromHash(`#${id}`)
    assert.equal(again.roomId, id)
    assert.equal(again.created, false)
  })

  it('custom tracker round-trips in shareable URL', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const custom = 'wss://tracker.example.com/announce'
    const hash = encodeRoomHash({ roomId: id, tracker: custom })
    assert.ok(hash.includes('tracker='))
    const parsed = decodeRoomHash(`#${hash}`)
    assert.equal(parsed.roomId, id)
    assert.equal(parsed.tracker, normalizeTracker(custom))

    const share = buildShareUrl({
      roomId: id,
      tracker: custom,
      origin: 'https://user.github.io',
      pathname: '/roomhash/'
    })
    assert.ok(share.startsWith('https://user.github.io/roomhash/#'))
    const frag = share.split('#')[1]
    const fromShare = decodeRoomHash(`#${frag}`)
    assert.equal(fromShare.roomId, id)
    assert.equal(fromShare.tracker, normalizeTracker(custom))
  })

  it('preserves encoded tracker query values without double-decoding', () => {
    const id = '123e4567-e89b-12d3-a456-426614174000'
    const tracker = 'wss://tracker.example.com/announce?token=a%2Fb'
    const parsed = decodeRoomHash(`#${encodeRoomHash({ roomId: id, tracker })}`)
    assert.equal(parsed.tracker, tracker)
  })

  it('rejects insecure trackers and ignores invalid tracker hashes', () => {
    assert.deepEqual(validateTrackerUrl('http://tracker.example.com'), {
      ok: false,
      error: 'tracker must use wss://'
    })
    assert.throws(() =>
      encodeRoomHash({
        roomId: '123e4567-e89b-12d3-a456-426614174000',
        tracker: 'not-a-url'
      })
    )
    const parsed = decodeRoomHash(
      '#123e4567-e89b-12d3-a456-426614174000?tracker=http%3A%2F%2Finsecure.example'
    )
    assert.equal(parsed.tracker, DEFAULT_TRACKER)
  })

  it('default tracker is omitted from hash', () => {
    const id = generateRoomId()
    const hash = encodeRoomHash({ roomId: id, tracker: DEFAULT_TRACKER })
    assert.equal(hash, id.toLowerCase())
    assert.equal(hash.includes('tracker'), false)
  })

  it('normalizeTracker trims and strips trailing slashes', () => {
    assert.equal(
      normalizeTracker('  wss://tracker.openwebtorrent.com/  '),
      'wss://tracker.openwebtorrent.com'
    )
  })
})
