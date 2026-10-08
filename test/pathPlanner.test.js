import test from 'node:test'
import assert from 'node:assert/strict'
import { createPathPlanner } from '../server/pathPlanner.js'

test('A-star finds a route around a blocked cell', () => {
  const planner = createPathPlanner()
  const map = {
    cells: [],
    blocked: [{ x: 1, y: 0 }],
  }
  const path = planner.plan(map, { x: 0, y: 0 }, { x: 2, y: 0 })
  assert.ok(path.length > 0)
  assert.deepEqual(path[0], { x: 0, y: 0 })
  assert.deepEqual(path.at(-1), { x: 2, y: 0 })
  assert.equal(path.some(p => p.x === 1 && p.y === 0), false)
})

test('planner returns empty route for blocked goal', () => {
  const planner = createPathPlanner()
  assert.deepEqual(planner.plan({ cells: [], blocked: [{ x: 2, y: 0 }] }, { x: 0, y: 0 }, { x: 2, y: 0 }), [])
})
