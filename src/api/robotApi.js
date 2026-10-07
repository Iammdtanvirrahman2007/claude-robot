// FRONTEND SERVICE LAYER — the UI talks only to `robotApi`. Everything below is a simulation of
// "the robot + the laptop backend". To go live, export an object with the same methods (see bottom).
//
//   connect({type,id,ip,port}) -> Promise<robot>   robot = hardware description reported by the ESP32
//   subscribe(id, fn)          -> unsubscribe       fn gets {kind:'telemetry',state} | {kind:'log',line} | {kind:'exec',status}
//   sendCommand(id, cmd, arg)                       manual control
//   build(id, code)            -> Promise<{ok,errors:[{line,msg}]}>
//   run(id) / stop(id)                              run the robot-brain program (on the laptop)
import { CATALOG } from '../robots/catalog.js'
import { toRobot } from '../models/robot.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rnd = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const IDLE = /STOP|IDLE|STAND|SIT|LAND|HOME|OPEN|CLOSE/
const live = {} // id -> simulated remote robot { cfg, state, subs, timer, token }

const emit = (id, ev) => live[id]?.subs.forEach(fn => fn(ev))
const log = (id, text, level = 'info') => emit(id, { kind: 'log', line: { t: new Date().toTimeString().slice(0, 8), level, text } })
const setExec = (id, status) => emit(id, { kind: 'exec', status })

function initState(cfg) {
  const sensors = {}, actuators = {}
  cfg.sensors.forEach(s => { sensors[s.id] = s.type === 'imu' ? { x: 0.12, y: -0.03, z: 1.01 } : s.type === 'gps' ? { lat: 47.3769, lon: 8.5417 } : s.v })
  cfg.actuators.forEach(a => { actuators[a.id] = a.v })
  return {
    connected: true, battery: sensors.battery ?? null, currentCommand: 'IDLE', speed: 0, sensors, actuators,
    camera: cfg.camera ? { ...cfg.camera, status: 'Streaming' } : null, errors: [],
    link: { latency: 12, rssi: -52, tx: 0, rx: 0 },
  }
}

function tick(id) {
  const { cfg, state: s } = live[id], t = Date.now()
  cfg.sensors.forEach(d => {
    const v = s.sensors[d.id]
    s.sensors[d.id] = d.type === 'imu' ? { x: rnd(-0.2, 0.2), y: rnd(-0.2, 0.2), z: 1 + rnd(-0.04, 0.04) }
      : d.type === 'gps' ? { lat: v.lat + rnd(-1, 1) * 1e-5, lon: v.lon + rnd(-1, 1) * 1e-5 }
      : clamp(v + rnd(-1, 1) * (d.max - d.min) * (d.drift ?? 0.05), d.min, d.max)
  })
  const moving = s.speed > 0, dir = /BACK|DECREASE/.test(s.currentCommand) ? -1 : 1
  cfg.actuators.forEach((a, i) => {
    s.actuators[a.id] = a.type === 'motor' ? (moving ? dir * s.speed + rnd(-2, 2) : 0)
      : clamp(a.v + Math.sin(t / 350 + i * 0.9) * (moving ? 14 : 1.5), 0, a.type === 'gripper' ? 100 : 180)
  })
  if (s.camera) s.camera.fps = cfg.camera.fps - Math.round(rnd(0, 2))
  s.battery = s.sensors.battery ?? null
  s.link = { latency: Math.round(rnd(8, 22)), rssi: -52 + Math.round(rnd(-4, 4)), tx: s.link.tx + 1, rx: s.link.rx + 1 }
  emit(id, { kind: 'telemetry', state: structuredClone(s) })
}

function command(id, cmd, arg) {
  const s = live[id].state
  s.currentCommand = cmd
  s.speed = IDLE.test(cmd) ? 0 : (arg ?? 50)
  s.link.tx++
}

async function connect({ type, id, ip, port }) {
  await sleep(900) // TCP connect + handshake
  const raw = CATALOG[type]
  if (!raw) throw new Error('Unknown robot firmware: ' + type)
  await sleep(500) // firmware sends its hardware description
  const cfg = toRobot(raw, { id, ip, port })
  if (live[id]) clearInterval(live[id].timer)
  live[id] = { cfg, state: initState(cfg), subs: new Set(), token: null }
  live[id].timer = setInterval(() => tick(id), 600)
  return cfg
}

function subscribe(id, fn) {
  const r = live[id]
  r.subs.add(fn)
  fn({ kind: 'telemetry', state: structuredClone(r.state) })
  return () => r.subs.delete(fn)
}

function sendCommand(id, cmd, arg) {
  command(id, cmd, arg)
  log(id, `Manual command: ${cmd}`)
}

// Mock "compiler": checks every robot.xxx() call against this robot's own API and balances braces.
async function build(id, code) {
  const { cfg } = live[id], names = new Set(cfg.api.flatMap(g => g.fns)), errors = []
  setExec(id, 'BUILDING'); log(id, `Building brain.cpp against the ${cfg.type.toUpperCase()} API…`)
  await sleep(700)
  let depth = 0
  code.split('\n').forEach((ln, i) => {
    const txt = ln.replace(/\/\/.*$/, '')
    for (const m of txt.matchAll(/robot\.([\w.]+)\(/g))
      if (!names.has(m[1])) errors.push({ line: i + 1, msg: `'robot.${m[1]}()' is not part of the ${cfg.type.toUpperCase()} API` })
    depth += (txt.match(/{/g) || []).length - (txt.match(/}/g) || []).length
  })
  if (depth) errors.push({ line: code.split('\n').length, msg: depth > 0 ? "expected '}' before end of file" : "unexpected '}'" })
  errors.forEach(e => log(id, `brain.cpp:${e.line}: error: ${e.msg}`, 'error'))
  log(id, errors.length ? `Build failed — ${errors.length} error(s)` : 'Build succeeded — 0 errors', errors.length ? 'error' : 'ok')
  setExec(id, errors.length ? 'ERROR' : 'STOPPED')
  return { ok: !errors.length, errors }
}

// Mock runtime: read sensor -> decide -> send command -> robot executes. Real backend streams the same events.
async function run(id) {
  const r = live[id]
  if (r.token) return
  const tk = (r.token = { stop: false }), b = r.cfg.brain, d = r.cfg.sensors.find(s => s.id === b.sensor)
  const nap = async ms => { await sleep(ms); return tk.stop }
  setExec(id, 'RUNNING'); log(id, 'Program started'); log(id, `Connected to ${id}`)
  while (!tk.stop) {
    setExec(id, 'WAITING FOR SENSOR DATA'); if (await nap(650)) return
    const v = r.state.sensors[b.sensor], hit = v < b.lt, [cmd, arg] = hit ? b.hit : b.miss
    log(id, `${d.name} = ${Math.round(v)} ${d.unit}`)
    if (hit) log(id, `Decision: ${cmd}`)
    setExec(id, 'SENDING COMMAND'); if (await nap(250)) return
    command(id, cmd, arg); log(id, `Command: ${cmd} ${arg}`); log(id, `Command sent to ${id}`)
    if (hit) r.state.sensors[b.sensor] = b.lt + rnd(25, 70) // path is clear after the turn
    setExec(id, 'ROBOT EXECUTING'); if (await nap(900)) return
  }
}

function stop(id) {
  const r = live[id]
  if (!r?.token) return
  r.token.stop = true; r.token = null
  command(id, 'STOP'); setExec(id, 'STOPPED'); log(id, 'Program stopped', 'warn')
}

const profiles = () => Object.entries(CATALOG).map(([type, e]) => ({ type, label: e.label, defaults: { ...e.defaults, type } }))

export const mockRobotApi = { profiles, connect, subscribe, sendCommand, build, run, stop }

// Later: export const realRobotApi = createBackendApi('ws://localhost:8000')   // same methods, real TCP/Wi-Fi backend
export const robotApi = mockRobotApi
