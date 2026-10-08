import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, ensureFirebaseAuth } from '../firebase.js'

const live = {}
const ROBOT_ID = 'VESP32-01'

const DEFAULT_CODE = `// WHEELED ESP32 brain
// This program runs only when ▶ Run is pressed.

void setup() {
  pinMode(25, OUTPUT);
  pinMode(26, OUTPUT);
  pinMode(27, OUTPUT);
  pinMode(14, OUTPUT);
}

void loop() {
  int distance = readUltrasonic();

  if (distance > 35) {
    digitalWrite(26, LOW);
    digitalWrite(14, LOW);
    analogWrite(25, 50);
    analogWrite(27, 50);
  } else {
    analogWrite(25, 0);
    analogWrite(27, 0);
    digitalWrite(26, LOW);
    digitalWrite(14, HIGH);
    analogWrite(25, 55);
    analogWrite(27, 55);
    delay(700);
  }

  delay(50);
}`

const cfg = {
  id: ROBOT_ID,
  label: 'VIRTUAL ESP32',
  type: 'wheeled',
  ip: 'cloud',
  port: 443,
  panels: { sensors: 'SENSORS', actuators: 'DRIVE' },
  pad: true,
  sensors: [
    { id: 'front_distance', name: 'Front Distance', type: 'distance', unit: 'cm', v: 250, min: 0, max: 250 },
    { id: 'collision', name: 'Collision', type: 'digital', unit: '', v: false },
    { id: 'battery', name: 'Battery', type: 'battery', unit: '%', v: 100, min: 0, max: 100 }
  ],
  actuators: [
    { id: 'motor_l', name: 'Left Motor', type: 'motor', unit: '%', v: 0 },
    { id: 'motor_r', name: 'Right Motor', type: 'motor', unit: '%', v: 0 }
  ],
  camera: false,
  controls: [
    { label: '↑', fn: 'forward', cmd: 'FORWARD', pos: '1 / 2' },
    { label: '←', fn: 'turn_left', cmd: 'TURN_LEFT', pos: '2 / 1' },
    { label: '■', fn: 'stop', cmd: 'STOP', pos: '2 / 2' },
    { label: '→', fn: 'turn_right', cmd: 'TURN_RIGHT', pos: '2 / 3' },
    { label: '↓', fn: 'backward', cmd: 'BACKWARD', pos: '3 / 2' }
  ],
  api: [{
    title: 'Arduino / ESP32',
    fns: ['readUltrasonic', 'pinMode', 'digitalWrite', 'analogWrite', 'delay', 'setup', 'loop']
  }, {
    title: 'Robot',
    fns: ['connected', 'front_distance', 'forward', 'backward', 'turnLeft', 'turnRight', 'stop']
  }],
  code: DEFAULT_CODE
}

const baseState = {
  connected: true,
  firmware: 'virtual-esp32',
  version: 'cloud-1.0',
  battery: 100,
  currentCommand: 'STOP',
  speed: 0,
  speedLimit: 100,
  sensors: { front_distance: 250, collision: false, battery: 100 },
  actuators: { motor_l: 0, motor_r: 0 },
  camera: null,
  world: {
    width: 600, height: 400,
    robot: { x: 60, y: 60, heading: 0 },
    obstacles: [], path: []
  },
  errors: [],
  link: { latency: 0, rssi: -30, tx: 0, rx: 0 },
  heartbeat: Date.now(),
  pose: { x: 60, y: 60, heading: 0 }
}

function stateDoc(id) { return doc(db, 'robots', id, 'state', 'current') }
function commandDoc(id) { return doc(db, 'robots', id, 'control', 'current') }

function extractFunction(code, name) {
  const marker = new RegExp('\\b(?:void|int|float|double|bool|long|auto)?\\s*' + name + '\\s*\\([^)]*\\)\\s*\\{')
  const m = marker.exec(code)
  if (!m) return ''
  const start = code.indexOf('{', m.index)
  let depth = 0
  for (let i = start; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}' && --depth === 0) return code.slice(start + 1, i)
  }
  throw new Error(name + '(): unmatched braces')
}

function extractLoopBody(code) {
  const body = extractFunction(code, 'loop')
  const trimmed = body.trim()
  if (!/^while\s*\(/.test(trimmed)) return body
  const brace = trimmed.indexOf('{', trimmed.indexOf(')'))
  if (brace < 0) return body
  let depth = 0
  for (let i = brace; i < trimmed.length; i++) {
    if (trimmed[i] === '{') depth++
    else if (trimmed[i] === '}' && --depth === 0) return trimmed.slice(brace + 1, i)
  }
  throw new Error('loop(): unmatched while braces')
}

function sanitizeSketch(code) {
  const blocked = /\b(?:window|document|globalThis|localStorage|sessionStorage|fetch|XMLHttpRequest|WebSocket|indexedDB|eval|Function|import|firebase|location|cookie|navigator)\b/i
  if (blocked.test(code)) throw new Error('Sketch contains a blocked browser API')
  return String(code || '')
    .replace(/#include[^\n]*\n/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/\b(?:int|float|double|bool|long|short|unsigned|byte|auto|const)\s+/g, '')
    .replace(/\bHIGH\b/g, '1')
    .replace(/\bLOW\b/g, '0')
    .replace(/\bOUTPUT\b/g, '1')
    .replace(/\bINPUT(?:_PULLUP)?\b/g, '0')
}

async function runSketch(id, code) {
  const r = live[id]
  const source = String(code || '').trim()
  if (!source) throw new Error('No ESP32 code. Add code before pressing Run.')
  const setupBody = extractFunction(source, 'setup')
  const loopBody = extractLoopBody(source)
  if (!loopBody.trim()) throw new Error('loop() is empty')

  const motors = { l: 0, r: 0, dirL: 1, dirR: 1 }
  const sendMotor = async side => {
    const raw = motors[side] * (side === 'l' ? motors.dirL : motors.dirR)
    await sendCommand(id, side === 'l' ? 'SET_MOTOR_L' : 'SET_MOTOR_R', raw)
  }

  const readUltrasonic = () => Number(r.last?.sensors?.front_distance ?? r.last?.world?.frontDistance ?? 250)
  const robot = {
    connected: () => true,
    front_distance: readUltrasonic,
    forward: v => sendCommand(id, 'FORWARD', Number(v) || 0),
    backward: v => sendCommand(id, 'BACKWARD', Number(v) || 0),
    turnLeft: v => sendCommand(id, 'TURN_LEFT', Number(v) || 90),
    turnRight: v => sendCommand(id, 'TURN_RIGHT', Number(v) || 90),
    stop: () => sendCommand(id, 'STOP', 0),
  }

  const pinMode = () => {}
  const digitalWrite = async (pin, value) => {
    if (Number(pin) === 26) motors.dirL = Number(value) ? -1 : 1
    if (Number(pin) === 14) motors.dirR = Number(value) ? -1 : 1
  }
  const analogWrite = async (pin, value) => {
    const v = Math.max(0, Math.min(100, Number(value) || 0))
    if (Number(pin) === 25) { motors.l = v; await sendMotor('l') }
    if (Number(pin) === 27) { motors.r = v; await sendMotor('r') }
  }
  const delay = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(3000, Number(ms) || 0))))
  const Serial = { begin: () => {}, print: (...a) => log(id, a.join(' ')), println: (...a) => log(id, a.join(' ')) }

  const execute = async body => {
    const js = sanitizeSketch(body)
      .replace(/\\bdelay\\s*\\(/g, 'await delay(')
    const fn = new Function(
      'readUltrasonic', 'pinMode', 'digitalWrite', 'analogWrite', 'delay',
      'robot', 'Serial', 'sendCommand', 'console',
      'return (async () => {' + js + '\\n})()'
    )
    return fn(readUltrasonic, pinMode, digitalWrite, analogWrite, delay, robot, Serial, sendCommand, undefined)
  }

  await execute(setupBody)
  while (!r.token?.stop) {
    await execute(loopBody)
    await delay(20)
  }
}

async function connect() {
  await ensureFirebaseAuth()
  await setDoc(doc(db, 'robots', ROBOT_ID), {
    id: ROBOT_ID, name: 'Virtual ESP32 Rover', type: 'wheeled',
    firmware: 'virtual-esp32', online: true, updatedAt: serverTimestamp()
  }, { merge: true })
  const existing = await new Promise(resolve => {
    let done = false
    const unsub = onSnapshot(stateDoc(ROBOT_ID), snap => {
      if (!done) { done = true; unsub(); resolve(snap.exists() ? snap.data() : null) }
    }, () => { if (!done) { done = true; unsub(); resolve(null) } })
  })
  return { ...cfg, initialState: existing ? { ...baseState, ...existing } : baseState }
}

function subscribe(id, fn) {
  if (!live[id]) live[id] = { subs: new Set(), seq: 0, unsub: null, token: null, runPromise: null }
  const r = live[id]
  r.subs.add(fn)
  r.unsub ||= onSnapshot(stateDoc(id), snap => {
    if (!snap.exists()) return
    const state = { ...baseState, ...snap.data(), heartbeat: Date.now() }
    r.last = state
    r.subs.forEach(cb => cb({ kind: 'telemetry', state }))
  }, err => r.subs.forEach(cb => cb({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'error', text: 'Firestore: '+err.message } })))
  if (r.last) fn({ kind: 'telemetry', state: r.last })
  return () => {
    r.subs.delete(fn)
    if (!r.subs.size && r.unsub) { r.unsub(); r.unsub = null }
  }
}

async function sendCommand(id, cmd, arg=0) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  r.seq = (r.seq || 0) + 1
  await setDoc(commandDoc(id), {
    seq: r.seq, command: cmd, value: Number(arg) || 0,
    issuedAt: serverTimestamp(), source: 'claude-robot'
  })
  r.subs.forEach(fn => fn({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'info', text: 'ESP32 command: '+cmd+(arg ? ' '+arg : '') } }))
}

async function build(id, code) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  const source = String(code || '').trim()
  if (!source) {
    const error = { line: 1, msg: 'No ESP32 code. Nothing to run.' }
    r.subs.forEach(fn => fn({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'error', text: error.msg } }))
    return { ok: false, errors: [error] }
  }
  try {
    extractFunction(source, 'loop')
    sanitizeSketch(source)
  } catch (e) {
    return { ok: false, errors: [{ line: 1, msg: e.message || String(e) }] }
  }
  return { ok: true, errors: [] }
}

async function run(id, code) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  if (r.token) return
  const source = String(code || '').trim()
  const built = await build(id, source)
  if (!built.ok) {
    r.subs.forEach(fn => fn({ kind: 'exec', status: 'ERROR' }))
    return built
  }

  r.token = { stop: false }
  r.subs.forEach(fn => fn({ kind: 'exec', status: 'RUNNING' }))
  r.subs.forEach(fn => fn({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'ok', text: 'ESP32 sketch running in Virtual ESP32' } }))
  r.runPromise = runSketch(id, source).catch(e => {
    r.subs.forEach(fn => fn({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'error', text: 'Sketch runtime: '+(e.message || String(e)) } }))
    r.subs.forEach(fn => fn({ kind: 'exec', status: 'ERROR' }))
  }).finally(() => {
    r.token = null
    r.runPromise = null
  })
  return { ok: true, errors: [] }
}

async function stop(id) {
  const r = live[id]
  if (!r) return
  if (r.token) r.token.stop = true
  await sendCommand(id, 'STOP', 0)
  r?.subs.forEach(fn => fn({ kind: 'exec', status: 'STOPPED' }))
}

async function disconnect(id) {
  await stop(id)
  await setDoc(doc(db, 'robots', id), { online: false, updatedAt: serverTimestamp() }, { merge: true })
  const r = live[id]
  if (r?.unsub) r.unsub()
  delete live[id]
}

export const firebaseRobotApi = {
  mode: 'cloud',
  profiles: () => [{ type: 'wheeled', label: cfg.label, defaults: { id: ROBOT_ID, ip: 'cloud', port: 443, type: 'wheeled' } }],
  discover: async () => ({ devices: [{ kind: 'esp32', ip: 'cloud', robot: { id: ROBOT_ID, name: cfg.label, type: 'wheeled', port: 443 } }], robots: [cfg], method: 'Firestore' }),
  connect: async () => connect(),
  subscribe,
  sendCommand,
  build,
  run,
  stop,
  disconnect,
  world: async id => live[id]?.last?.world || null,
  setBase: () => {},
  getBase: () => 'Firestore'
}
