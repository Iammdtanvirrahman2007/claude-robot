import test from 'node:test'
import assert from 'node:assert/strict'
import { createRouteExecutor } from '../server/routeExecutor.js'

test('route executor turns then advances', () => {
  const e = createRouteExecutor()
  e.setRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], 0)
  const turn = e.next()
  assert.equal(turn.command, 'TURN_RIGHT')
  assert.equal(turn.arg, 90)
  const forward = e.next({ heading: 90 })
  assert.equal(forward.command, 'FORWARD')
  const turnAgain = e.next()
  assert.equal(turnAgain.command, 'TURN_LEFT')
})

test('route executor stops at the end', () => {
  const e = createRouteExecutor()
  e.setRoute([{ x: 0, y: 0 }], 0)
  assert.equal(e.next().command, 'STOP')
  assert.equal(e.next().done, true)
})


test('route executor waits for telemetry heading after a turn', () => {
  const e = createRouteExecutor()
  e.setRoute([{ x: 0, y: 0 }, { x: 1, y: 0 }], 0)
  assert.equal(e.next().command, 'TURN_RIGHT')
  assert.equal(e.next({ heading: 0 }).command, 'TURN_RIGHT')
  assert.equal(e.next({ heading: 90 }).command, 'FORWARD')
})
