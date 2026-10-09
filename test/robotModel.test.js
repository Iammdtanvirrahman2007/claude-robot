import test from 'node:test'
import assert from 'node:assert/strict'
import { toRobot, codeFiles } from '../src/models/robot.js'

test('normalizes minimal virtual ESP32 hardware report', () => {
  const robot = toRobot({
    type: 'wheeled',
    name: 'Virtual ESP32 Rover',
    sensors: [{ id: 'front_distance', type: 'ultrasonic', unit: 'cm' }],
    actuators: [{ id: 'motor_l', type: 'motor', unit: 'percent' }],
  }, { id: 'VESP32-01', ip: '127.0.0.1', port: 5000 })

  assert.equal(robot.id, 'VESP32-01')
  assert.equal(robot.controls.length, 5)
  assert.ok(robot.controls.some(control => control.cmd === 'STOP'))
  assert.ok(robot.api.some(group => group.title === 'Sensors' && group.fns.includes('front_distance')))
  assert.ok(codeFiles(robot).some(file => file.name === 'hardware.h'))
})

test('normalizes absent optional hardware arrays without throwing', () => {
  const robot = toRobot({ type: 'unknown' }, { id: 'test', ip: 'localhost', port: 5000 })
  assert.deepEqual(robot.sensors, [])
  assert.deepEqual(robot.actuators, [])
  assert.deepEqual(robot.controls, [])
})
