import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore'
import { db, ensureFirebaseAuth } from '../firebase.js'

const live = {}
const ROBOT_ID = 'VESP32-01'

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
    title: 'Robot',
    fns: ['connected', 'front_distance', 'forward', 'backward', 'turnLeft', 'turnRight', 'stop']
  }],
  code: '// Robot Brain commands the ESP32.\\n// The Virtual ESP32 only executes commands and returns telemetry.\\n\\nvoid setup() {}\\n\\nvoid loop() {\\n  // Brain/Behavior Engine runs outside the ESP32 firmware.\\n}'
}

const baseState = {
  connected: true, firmware: 'virtual-esp32', version: 'cloud-1.1',
  battery: 100, currentCommand: 'STOP', speed: 0, speedLimit: 100,
  sensors: { front_distance: 250, collision: false, battery: 100 },
  actuators: { motor_l: 0, motor_r: 0 }, camera: null,
  world: { width: 600, height: 400, robot: { x: 60, y: 60, heading: 0 }, obstacles: [], path: [] },
  errors: [], link: { latency: 0, rssi: -30, tx: 0, rx: 0 }, heartbeat: Date.now(),
  pose: { x: 60, y: 60, heading: 0 }
}

function stateDoc(id) { return doc(db, 'robots', id, 'state', 'current') }
function commandDoc(id) { return doc(db, 'robots', id, 'control', 'current') }

function nowLine() {
  return new Date().toTimeString().slice(0, 8)
}

async function connect() {
  await ensureFirebaseAuth()
  await setDoc(doc(db, 'robots', ROBOT_ID), {
    id: ROBOT_ID, name: 'Virtual ESP32 Rover', type: 'wheeled',
    firmware: 'virtual-esp32', protocol: '1.1', online: true, updatedAt: serverTimestamp()
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
  if (!live[id]) live[id] = { subs: new Set(), seq: 0, unsub: null, stateUnsub: null }
  const r = live[id]
  r.subs.add(fn)
  r.stateUnsub ||= onSnapshot(stateDoc(id), snap => {
    if (!snap.exists()) return
    const state = { ...baseState, ...snap.data(), heartbeat: Date.now() }
    r.last = state
    r.subs.forEach(cb => cb({ kind: 'telemetry', state }))
  }, err => r.subs.forEach(cb => cb({ kind: 'log', line: { t: nowLine(), level: 'error', text: 'Firestore telemetry: ' + err.message } })))
  if (r.last) fn({ kind: 'telemetry', state: r.last })
  return () => {
    r.subs.delete(fn)
    if (!r.subs.size && r.stateUnsub) { r.stateUnsub(); r.stateUnsub = null }
  }
}

async function sendCommand(id, cmd, arg = 0) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  r.seq = (r.seq || 0) + 1
  const value = Number(arg) || 0
  const command = String(cmd || 'STOP').toUpperCase()
  const commandId = `cmd-${Date.now()}-${r.seq}`
  await setDoc(commandDoc(id), {
    seq: r.seq, id: commandId, command, value,
    priority: command === 'STOP' ? 1000 : 100,
    ttl: command === 'STOP' ? 5000 : 1500,
    issuedAt: serverTimestamp(), issuedAtMs: Date.now(), source: 'claude-robot'
  })
  r.subs.forEach(fn => fn({ kind: 'log', line: { t: nowLine(), level: 'info', text: `ESP32 command [${commandId}]: ${command}${value ? ' ' + value : ''}` } }))
}

async function build(id, code) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  const source = String(code || '').trim()
  const errors = []
  if (!source) errors.push({ line: 1, msg: 'No Robot Brain code.' })
  if (source && !/void\\s+setup\\s*\\(/.test(source)) errors.push({ line: 1, msg: 'Missing setup().' })
  if (source && !/void\\s+loop\\s*\\(/.test(source)) errors.push({ line: 1, msg: 'Missing loop().' })
  r.subs?.forEach(fn => fn({ kind: 'exec', status: errors.length ? 'ERROR' : 'STOPPED' }))
  return { ok: !errors.length, errors }
}

async function run(id) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  r.subs.forEach(fn => fn({ kind: 'exec', status: 'RUNNING' }))
  r.subs.forEach(fn => fn({ kind: 'log', line: { t: nowLine(), level: 'ok', text: 'Robot Brain is running in cloud control mode' } }))
  return { ok: true, errors: [] }
}

async function stop(id) {
  if (!live[id]) live[id] = { subs: new Set(), seq: 0 }
  await sendCommand(id, 'STOP', 0)
  live[id].subs.forEach(fn => fn({ kind: 'exec', status: 'STOPPED' }))
}

async function disconnect(id) {
  try { await stop(id) } catch {}
  await setDoc(doc(db, 'robots', id), { online: false, updatedAt: serverTimestamp() }, { merge: true })
  const r = live[id]
  r?.stateUnsub?.()
  delete live[id]
}

export const firebaseRobotApi = {
  mode: 'cloud',
  profiles: () => [{ type: 'wheeled', label: cfg.label, defaults: { id: ROBOT_ID, ip: 'cloud', port: 443, type: 'wheeled' } }],
  discover: async () => ({ devices: [{ kind: 'esp32', ip: 'cloud', robot: { id: ROBOT_ID, name: cfg.label, type: 'wheeled', port: 443 } }], robots: [cfg], method: 'Firestore' }),
  connect: async () => connect(),
  subscribe, sendCommand, build, run, stop, disconnect,
  world: async id => live[id]?.last?.world || null,
  setBase: () => {}, getBase: () => 'Firestore'
}