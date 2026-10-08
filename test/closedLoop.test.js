import test from 'node:test'
import assert from 'node:assert/strict'
import { createSimulationWorld } from '../src/sim/worldModel.js'
import { decideSimulationIntent, INTENTS } from '../src/sim/brain.js'
import { createSimulationPathPlanner } from '../src/sim/pathPlanner.js'
import { createSimulationRouteExecutor } from '../src/sim/routeExecutor.js'
import { createAutonomyController } from '../src/sim/autonomy.js'

test('closed-loop robot stack explores without collision', () => {
  const world = createSimulationWorld()
  const planner = createSimulationPathPlanner()
  const route = createSimulationRouteExecutor()
  const autonomy = createAutonomyController()

  let now = Date.now()
  world.update('STOP', 0, world.snapshot().frontDistance, now)

  const initial = world.snapshot()
  const intent = decideSimulationIntent({
    battery: 100,
    collision: initial.collision,
  })

  assert.equal(intent.intent, INTENTS.EXPLORE)

  const start = {
    x: Math.round(initial.robot.x / initial.grid.cellSizeCm),
    y: Math.round(initial.robot.y / initial.grid.cellSizeCm),
  }
  const target = { x: start.x + 1, y: start.y }
  const path = planner.plan(initial.grid, start, target)

  assert.ok(path.length >= 2)
  route.setRoute(path, initial.robot.heading)

  let commands = 0
  let moved = false

  for (let i = 0; i < 8; i++) {
    const snapshot = world.snapshot()
    const decision = autonomy.decide({
      battery: 100,
      speed: 40,
      sensors: { front_distance: snapshot.frontDistance },
      camera: { world: snapshot },
    })

    const step = route.next(snapshot.robot)
    const selected = decision.command === 'FORWARD' ? step : decision

    if (selected.command !== 'STOP') {
      commands++
      const before = world.snapshot().robot
      now += 600
      world.update(selected.command, selected.arg, world.snapshot().frontDistance, now)
      const after = world.snapshot().robot
      if (Math.hypot(after.x - before.x, after.y - before.y) > 0) moved = true
    }

    if (world.snapshot().collision) break
  }

  const finalState = world.snapshot()
  assert.ok(commands > 0)
  assert.equal(finalState.collision, false)
  assert.ok(moved)
  assert.ok(finalState.path.length >= 1)
  assert.ok(finalState.grid.cells.length >= 1)
})
