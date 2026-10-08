import test from 'node:test'
import assert from 'node:assert/strict'
import { createNavigationMap } from '../server/navigationMap.js'

test('navigation map remembers visited and blocked cells', () => {
  const map = createNavigationMap({ cellSizeCm: 20 })
  map.observe({ robot: { x: 0, y: 0 }, obstacles: [{ x: 20, y: 0, confidence: 0.9 }] })
  const s = map.snapshot()
  assert.ok(s.cells.some(c => c.x === 0 && c.y === 0 && c.state === 'free'))
  assert.ok(s.blocked.some(c => c.x === 1 && c.y === 0))
})

test('planner prefers an unexplored safe neighbor', () => {
  const map = createNavigationMap()
  map.observe({ robot: { x: 0, y: 0 }, obstacles: [{ x: 0, y: 20 }] })
  const d = map.plan({ robot: { x: 0, y: 0 } })
  assert.notEqual(d.command, 'STOP')
  assert.ok(['TURN_LEFT','TURN_RIGHT','BACKWARD'].includes(d.command))
})
