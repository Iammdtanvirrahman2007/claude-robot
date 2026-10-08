import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldModel } from '../server/worldModel.js'

test('turn command is applied once while telemetry repeats the same command', () => {
  const world = createWorldModel()
  const t = Date.now()
  world.updateMovement('TURN_RIGHT', 70, t)
  world.updateMovement('TURN_RIGHT', 70, t + 100)
  assert.equal(world.snapshot().robot.heading, 70)
})

test('forward movement follows heading and records path', () => {
  const world = createWorldModel()
  const t = Date.now()
  world.updateMovement('FORWARD', 70, t)
  world.updateMovement('FORWARD', 70, t + 600)
  const s = world.snapshot()
  assert.ok(s.robot.y > 0)
  assert.ok(s.path.length >= 2)
})

test('front distance creates a persistent map obstacle', () => {
  const world = createWorldModel()
  const s = world.observe({ objects: [], fused: { blocked: true } }, 25, Date.now())
  assert.equal(s.obstacles.length, 1)
  assert.equal(s.obstacles[0].distanceCm, 25)
  assert.equal(s.obstacles[0].position, 'center')
})
