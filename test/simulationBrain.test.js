import test from 'node:test'
import assert from 'node:assert/strict'
import { INTENTS, decideSimulationIntent } from '../src/sim/brain.js'

test('simulation brain selects exploration by default', () => {
  assert.deepEqual(decideSimulationIntent({ battery: 90, collision: false }), {
    intent: INTENTS.EXPLORE,
    reason: 'autonomous exploration',
  })
})

test('simulation brain holds on critical battery', () => {
  assert.equal(decideSimulationIntent({ battery: 5 }).intent, INTENTS.HOLD)
})

test('simulation brain holds on collision state', () => {
  assert.equal(decideSimulationIntent({ battery: 90, collision: true }).intent, INTENTS.HOLD)
})
