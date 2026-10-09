// Pure UI model helpers. Nothing here knows about a specific robot type.
export const STATUS = ['BUILDING', 'RUNNING', 'WAITING FOR SENSOR DATA', 'SENDING COMMAND', 'ROBOT EXECUTING', 'STOPPED', 'ERROR']

const ACT_FN = { servo: 'set_servo', motor: 'set_motor', gripper: 'set_gripper' }
const uniq = a => [...new Set(a)]

// Raw ESP32 hardware report -> robot model. Real firmware may omit optional UI metadata.
export function toRobot(raw = {}, { id, ip, port } = {}) {
  const sensors = Array.isArray(raw.sensors) ? raw.sensors : []
  const actuators = Array.isArray(raw.actuators) ? raw.actuators : []
  const controls = Array.isArray(raw.controls) && raw.controls.length
    ? raw.controls
    : (String(raw.type || '').toLowerCase() === 'wheeled'
        ? [
            { label: '↑', fn: 'forward', cmd: 'FORWARD', pos: '1 / 2' },
            { label: '←', fn: 'turn_left', cmd: 'TURN_LEFT', pos: '2 / 1' },
            { label: '■', fn: 'stop', cmd: 'STOP', pos: '2 / 2' },
            { label: '→', fn: 'turn_right', cmd: 'TURN_RIGHT', pos: '2 / 3' },
            { label: '↓', fn: 'backward', cmd: 'BACKWARD', pos: '3 / 2' },
          ]
        : [])
  const core = ['connected', 'stop', 'log']
  const api = [
    { title: 'Core', fns: core },
    { title: 'Movement', fns: uniq(controls.map(c => c.fn).filter(Boolean)).filter(f => !core.includes(f)) },
    { title: 'Sensors', fns: [...sensors.map(s => s.fn || s.id).filter(Boolean), ...(raw.camera ? ['camera.capture', 'camera.detect_obstacle'] : [])] },
    { title: 'Actuators', fns: uniq(actuators.map(a => ACT_FN[a.type]).filter(Boolean)) },
  ].filter(g => g.fns.length)
  return { ...raw, sensors, actuators, controls, id, ip, port, api }
}

const hardwareHeader = c => [
  `// Hardware description reported by ${c.id}`,
  `// robot_type: ${String(c.type || 'unknown').toUpperCase()}   link: ${c.ip}:${c.port}`, '',
  ...(c.sensors || []).map(s => `SENSOR   ${String(s.id || 'unknown').padEnd(16)} ${s.type || 'unknown'}${s.unit ? ' [' + s.unit + ']' : ''}`), '',
  ...(c.actuators || []).map(a => `ACTUATOR ${String(a.id || 'unknown').padEnd(16)} ${a.type || 'unknown'}`),
].join('\n')

export const codeFiles = cfg => [
  { name: 'brain.cpp', code: cfg.code || '' },
  { name: 'hardware.h', code: hardwareHeader(cfg) },
]
export const filesKey = cfg => `files:${cfg.id}:${cfg.type}`
