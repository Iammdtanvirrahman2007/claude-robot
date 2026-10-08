import test from 'node:test'
import assert from 'node:assert/strict'
import { highLevelIntents, commandForFunction } from '../server/aiBrain.js'

test('AI exposes navigation intents without mapping them to motor commands', () => {
  assert.equal(highLevelIntents.explore, 'EXPLORE')
  assert.equal(commandForFunction('EXPLORE'), null)
  assert.equal(commandForFunction('forward'), 'FORWARD')
})
