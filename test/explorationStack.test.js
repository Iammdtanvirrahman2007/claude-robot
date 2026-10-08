import test from 'node:test'
import assert from 'node:assert/strict'
import { createNavigationMap } from '../server/navigationMap.js'
import { createPathPlanner } from '../server/pathPlanner.js'
import { createRouteExecutor } from '../server/routeExecutor.js'

test('exploration intent stack produces an executable planned route', () => {
  const map = createNavigationMap({ cellSizeCm: 20 })
  const planner = createPathPlanner({ maxNodes: 100 })
  const route = createRouteExecutor()

  map.observe({
    robot: { x: 0, y: 0, heading: 90 },
    obstacles: [{ x: 0, y: 20, confidence: 1 }],
  })

  const world = { robot: { x: 0, y: 0, heading: 90 } }
  const target = map.chooseTarget(world)
  assert.ok(target)

  const nav = map.snapshot()
  const path = planner.plan(
    nav,
    { x: 0, y: 0 },
    { x: target.x, y: target.y },
  )

  assert.ok(path.length >= 2)
  route.setRoute(path, world.robot.heading)

  const decision = route.next(world.robot)
  assert.notEqual(decision.command, 'STOP')
  assert.ok(['FORWARD', 'BACKWARD', 'TURN_LEFT', 'TURN_RIGHT'].includes(decision.command))
})
