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

test('vision objects become positioned world tracks', () => {
  const world = createWorldModel()
  const s = world.observe({
    objects: [{
      label: 'chair',
      confidence: 0.9,
      position: 'right',
      distance: 'medium',
      sensorDistance: 80,
    }],
  }, null, Date.now())
  assert.equal(s.objects.length, 1)
  assert.equal(s.objects[0].label, 'chair')
  assert.equal(s.objects[0].position, 'right')
  assert.ok(s.objects[0].x > 0)
  assert.ok(s.objects[0].distanceCm === 80)
})

test('near vision objects enter obstacle layer', () => {
  const world = createWorldModel()
  const s = world.observe({
    objects: [{
      label: 'box',
      confidence: 0.8,
      position: 'center',
      distance: 'near',
    }],
  }, null, Date.now())
  assert.equal(s.obstacles.length, 1)
  assert.equal(s.obstacles[0].label, 'box')
})
