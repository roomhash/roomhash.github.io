import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  generateNickname,
  normalizeNickname,
  resolveNickname
} from '../src/nickname.js'

describe('nickname (shipped)', () => {
  it('generateNickname returns non-empty string', () => {
    const n = generateNickname()
    assert.equal(typeof n, 'string')
    assert.ok(n.length >= 4)
    assert.equal(normalizeNickname(n).ok, true)
  })

  it('normalizeNickname accepts valid override', () => {
    const r = normalizeNickname('  Alice  ')
    assert.equal(r.ok, true)
    assert.equal(r.nickname, 'Alice')
  })

  it('normalizeNickname rejects empty and too long', () => {
    assert.equal(normalizeNickname('').ok, false)
    assert.equal(normalizeNickname('   ').ok, false)
    assert.equal(normalizeNickname('x'.repeat(33)).ok, false)
  })

  it('resolveNickname uses preferred when valid else random', () => {
    assert.equal(resolveNickname('Bob'), 'Bob')
    const rand = resolveNickname(null)
    assert.equal(normalizeNickname(rand).ok, true)
  })
})
