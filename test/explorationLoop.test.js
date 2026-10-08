import test from 'node:test'
import assert from 'node:assert/strict'
import { chooseExplorationRoute } from '../src/sim/explorationLoop.js'
import { createSimulationPathPlanner } from '../src/sim/pathPlanner.js'
import { createSimulationRouteExecutor } from '../src/sim/routeExecutor.js'

test('exploration loop creates a route from the current world', () => {
  const planner = createSimulationPathPlanner()
  const route = createSimulationRouteExecutor()
  const world = {
    robot: { x: 0, y: 0, heading: 0 },
    grid: { cellSizeCm: 20, cells: [{ x: 0, y: 0, state: 'free' }] },
  }
  const step = chooseExplorationRoute(world, planner, route)
  assert.notEqual(step.command, 'STOP')
  assert.ok(route.status().length >= 2)
})
