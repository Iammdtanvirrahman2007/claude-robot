import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldModel } from '../server/worldModel.js'
import { createNavigationMap } from '../server/navigationMap.js'

test('vision and sensor fusion feeds navigation map', () => {
  const world = createWorldModel()
  const navigation = createNavigationMap({ cellSizeCm: 20 })
  const vision = {
    objects: [{
      label: 'box',
      confidence: 0.95,
      position: 'center',
      distance: 'near',
      sensorDistance: 25,
    }],
    fused: { blocked: false, distanceCm: 25 },
  }

  world.observe(vision, 25, Date.now())
  const snapshot = world.snapshot()
  navigation.observe(snapshot)
  const nav = navigation.snapshot()

  assert.equal(snapshot.objects.length, 1)
  assert.equal(snapshot.obstacles.length, 1)
  assert.ok(nav.cells.length >= 1)
})
