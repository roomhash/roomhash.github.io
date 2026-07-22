import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePortableScene } from '../src/modules/portable-surface.js'

test('portable surface accepts bounded responsive scenes', () => {
  const scene = {
    width: 375,
    height: 667,
    background: '#0b1220',
    draw: [
      { op: 'rect', x: 0, y: 0, width: 375, height: 667, fill: '#ffffff' },
      { op: 'text', text: 'Portable', x: 16, y: 16, size: 16, color: '#111827' },
      { op: 'line', points: [[10, 10], [20, 20]], stroke: '#2563eb', lineWidth: 3 }
    ]
  }
  assert.equal(validatePortableScene(scene), scene)
})

test('portable surface fails closed on malformed and oversized scenes', () => {
  assert.throws(() => validatePortableScene({ width: 0, height: 10, draw: [] }), /dimensions/)
  assert.throws(() => validatePortableScene({ width: 10, height: 10, draw: [null] }), /operation/)
  assert.throws(() => validatePortableScene({ width: 10, height: 10, draw: [{ op: 'line', points: Array.from({ length: 8193 }, () => [0, 0]) }] }), /content limit/)
})
