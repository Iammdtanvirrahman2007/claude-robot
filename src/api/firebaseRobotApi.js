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
  sensors: [
    { id: 'front_distance', type: 'ultrasonic', v: 250, min: 0, max: 250 },
    { id: 'collision', type: 'digital', v: false },
    { id: 'battery', type: 'battery', v: 100, min: 0, max: 100 }
  ],
  actuators: [
    { id: 'motor_l', type: 'motor', v: 0 },
    { id: 'motor_r', type: 'motor', v: 0 }
  ],
  camera: false,
  api: [{ group: 'drive', fns: ['forward', 'backward', 'turnLeft', 'turnRight', 'stop'] }]
}

const baseState = {
  connected: true,
  battery: 100,
  currentCommand: 'IDLE',
  speed: 0,
  sensors: { front_distance: 250, collision: false, battery: 100 },
  actuators: { motor_l: 0, motor_r: 0 },
  camera: null,
  errors: [],
  link: { latency: 0, rssi: null, tx: 0, rx: 0 },
  heartbeat: Date.now(),
  pose: { x: 60, y: 60, heading: 0 }
}

function stateDoc(id) { return doc(db, 'robots', id, 'state', 'current') }
function commandDoc(id) { return doc(db, 'robots', id, 'control', 'current') }

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
  if (!live[id]) live[id] = { subs: new Set(), seq: 0, unsub: null, runTimer: null }
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
  r.subs.forEach(fn => fn({ kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'info', text: 'Cloud command: '+cmd+(arg ? ' '+arg : '') } }))
}

async function build() {
  return { ok: true, errors: [] }
}

async function run(id) {
  const r = live[id] ||= { subs: new Set(), seq: 0 }
  if (r.runTimer) return
  r.runTimer = setInterval(async () => {
    const s = r.last
    if (!s) return
    const front = Number(s.sensors?.front_distance ?? 250)
    const collision = Boolean(s.sensors?.collision)
    if (collision) await sendCommand(id, 'STOP', 0)
    else if (front < 35) await sendCommand(id, 'TURN_RIGHT', 45)
    else await sendCommand(id, 'FORWARD', 40)
  }, 700)
  r.subs.forEach(fn => fn({ kind: 'exec', status: 'RUNNING' }))
}

async function stop(id) {
  const r = live[id]
  if (r?.runTimer) { clearInterval(r.runTimer); r.runTimer = null }
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
  connect,
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
