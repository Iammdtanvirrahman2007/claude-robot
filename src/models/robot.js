// Pure UI model helpers. Nothing here knows about a specific robot type.
export const STATUS = ['BUILDING', 'RUNNING', 'WAITING FOR SENSOR DATA', 'SENDING COMMAND', 'ROBOT EXECUTING', 'STOPPED', 'ERROR']

const ACT_FN = { servo: 'set_servo', motor: 'set_motor', gripper: 'set_gripper' }
const uniq = a => [...new Set(a)]

// Raw ESP32 hardware report -> robot model. Panels, manual controls and the code API list are all derived from it.
export function toRobot(raw, { id, ip, port }) {
  const core = ['connected', 'stop', 'log']
  const api = [
    { title: 'Core', fns: core },
    { title: 'Movement', fns: uniq(raw.controls.map(c => c.fn)).filter(f => !core.includes(f)) },
    { title: 'Sensors', fns: [...raw.sensors.map(s => s.fn || s.id), ...(raw.camera ? ['camera.capture', 'camera.detect_obstacle'] : [])] },
    { title: 'Actuators', fns: uniq(raw.actuators.map(a => ACT_FN[a.type])) },
  ].filter(g => g.fns.length)
  return { ...raw, id, ip, port, api }
}

const hardwareHeader = c => [
  `// Hardware description reported by ${c.id} firmware`,
  `// robot_type: ${c.type.toUpperCase()}   link: ${c.ip}:${c.port}`, '',
  ...c.sensors.map(s => `SENSOR   ${s.id.padEnd(16)} ${s.type}${s.unit ? ' [' + s.unit + ']' : ''}`), '',
  ...c.actuators.map(a => `ACTUATOR ${a.id.padEnd(16)} ${a.type}`),
].join('\n')

export const codeFiles = cfg => [
  { name: 'brain.cpp', code: cfg.code },
  { name: 'hardware.h', code: hardwareHeader(cfg) },
]
export const filesKey = cfg => `files:${cfg.id}:${cfg.type}`
