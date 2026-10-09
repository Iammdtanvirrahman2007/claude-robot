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

test('rectangular obstacles mark every covered map cell', () => {
  const map = createNavigationMap({ cellSizeCm: 20 })
  const s = map.observe({
    robot: { x: 0, y: 0 },
    obstacles: [{ x: 40, y: 20, w: 60, h: 40, confidence: 0.9 }],
  })
  for (const cell of [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 2 }, { x: 4, y: 2 }]) {
    assert.ok(s.blocked.some(c => c.x === cell.x && c.y === cell.y), `expected blocked cell ${cell.x},${cell.y}`)
  }
})
