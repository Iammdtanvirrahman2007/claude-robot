import test from 'node:test'
import assert from 'node:assert/strict'
import { createAutonomyController } from '../server/autonomy.js'

const state = (front, x, y, command='FORWARD', speed=45) => ({
  battery: 90, currentCommand: command, speed,
  sensors: { front_distance: front },
  camera: { world: { robot: { x, y, heading: 0 } } },
})

test('autonomy stops for emergency obstacle', () => {
  const a = createAutonomyController()
  assert.equal(a.decide(state(7,0,0)).command, 'STOP')
})

test('autonomy turns when obstacle is near', () => {
  const a = createAutonomyController()
  const d = a.decide(state(20,0,0))
  assert.ok(['TURN_LEFT','TURN_RIGHT'].includes(d.command))
})

test('autonomy recovers from a stuck robot', () => {
  const a = createAutonomyController({ stuckWindowMs: 0, minProgressCm: 3, recoveryCooldownMs: 0 })
  a.observe(state(100,0,0))
  const d = a.observe(state(100,0,0,'FORWARD',45))
  assert.ok(['TURN_LEFT','TURN_RIGHT'].includes(d.command))
})

test('autonomy stops when world model reports collision', () => {
  const a = createAutonomyController()
  const s = state(100, 0, 0)
  s.camera.world.collision = true
  const d = a.decide(s)
  assert.equal(d.command, 'STOP')
  assert.equal(d.priority, 100)
})

test('autonomy marks critical battery as highest safety stop', () => {
  const a = createAutonomyController()
  const s = state(100, 0, 0)
  s.battery = 5
  const d = a.decide(s)
  assert.equal(d.command, 'STOP')
  assert.equal(d.priority, 100)
})
