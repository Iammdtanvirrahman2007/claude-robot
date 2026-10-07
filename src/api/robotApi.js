// Service facade. The React UI talks only to this object.
// "simulation" uses the built-in simulator; "bridge" talks to the optional local Node bridge.

import { CATALOG } from '../robots/catalog.js'
import { toRobot } from '../models/robot.js'
import { realRobotApi } from './realRobotApi.js'

const sleep = ms => new Promise(r => setTimeout(r, ms))
const rnd = (a, b) => a + Math.random() * (b - a)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v))
const IDLE = /STOP|IDLE|STAND|SIT|LAND|HOME|OPEN|CLOSE/
const live = {}

const emit = (id, ev) => live[id]?.subs.forEach(fn => fn(ev))
const log = (id, text, level = 'info') => emit(id, {
  kind: 'log',
  line: { t: new Date().toTimeString().slice(0, 8), level, text }
})
const setExec = (id, status) => emit(id, { kind: 'exec', status })

function profiles() {
  return Object.entries(CATALOG).map(([type, e]) => ({
    type, label: e.label, defaults: { ...e.defaults, type }
  }))
}

function initState(cfg) {
  const sensors = {}, actuators = {}
  cfg.sensors.forEach(s => {
    sensors[s.id] = s.type === 'imu' ? { x: 0.12, y: -0.03, z: 1.01 }
      : s.type === 'gps' ? { lat: 47.3769, lon: 8.5417 }
      : s.v
  })
  cfg.actuators.forEach(a => { actuators[a.id] = a.v })
  return {
    connected: true, battery: sensors.battery ?? null, currentCommand: 'IDLE', speed: 0,
    sensors, actuators, camera: cfg.camera ? { ...cfg.camera, status: 'Streaming' } : null,
    errors: [], link: { latency: 12, rssi: -52, tx: 0, rx: 0 }, heartbeat: Date.now(),
  }
}

function tick(id) {
  const r = live[id]
  if (!r) return
  const { cfg, state: s } = r
  const t = Date.now()

  cfg.sensors.forEach(d => {
    const v = s.sensors[d.id]
    s.sensors[d.id] = d.type === 'imu'
      ? { x: rnd(-0.2, 0.2), y: rnd(-0.2, 0.2), z: 1 + rnd(-0.04, 0.04) }
      : d.type === 'gps'
        ? { lat: v.lat + rnd(-1, 1) * 1e-5, lon: v.lon + rnd(-1, 1) * 1e-5 }
        : clamp(v + rnd(-1, 1) * (d.max - d.min) * (d.drift ?? 0.05), d.min, d.max)
  })

  const moving = s.speed > 0
  const dir = /BACK|DECREASE/.test(s.currentCommand) ? -1 : 1
  cfg.actuators.forEach((a, i) => {
    s.actuators[a.id] = a.type === 'motor'
      ? (moving ? dir * s.speed + rnd(-2, 2) : 0)
      : clamp(a.v + Math.sin(t / 350 + i * 0.9) * (moving ? 14 : 1.5), 0,
          a.type === 'gripper' ? 100 : 180)
  })

  if (s.camera) s.camera.fps = Math.max(1, cfg.camera.fps - Math.round(rnd(0, 2)))
  s.battery = s.sensors.battery ?? null
  s.heartbeat = t
  s.link = {
    latency: Math.round(rnd(8, 22)),
    rssi: -52 + Math.round(rnd(-4, 4)),
    tx: s.link.tx,
    rx: s.link.rx + 1,
  }
  emit(id, { kind: 'telemetry', state: structuredClone(s) })
}

function command(id, cmd, arg) {
  const r = live[id]
  if (!r) throw new Error('Robot is not connected')
  r.state.currentCommand = cmd
  r.state.speed = IDLE.test(cmd) ? 0 : (arg ?? 50)
  r.state.link.tx++
  emit(id, { kind: 'telemetry', state: structuredClone(r.state) })
}

async function connect({ type, id, ip, port }) {
  if (!id?.trim()) throw new Error('Robot ID is required')
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip || '')) throw new Error('Enter a valid IPv4 address')
  const raw = CATALOG[type]
  if (!raw) throw new Error('Unknown robot firmware: ' + type)

  await sleep(450)
  const cfg = toRobot(raw, { id: id.trim(), ip, port: Number(port) || 5000 })
  if (live[cfg.id]?.timer) clearInterval(live[cfg.id].timer)
  live[cfg.id] = { cfg, state: initState(cfg), subs: new Set(), timer: null, token: null }
  live[cfg.id].timer = setInterval(() => tick(cfg.id), 600)
  return cfg
}

function subscribe(id, fn) {
  const r = live[id]
  if (!r) return () => {}
  r.subs.add(fn)
  fn({ kind: 'telemetry', state: structuredClone(r.state) })
  return () => r.subs.delete(fn)
}

function sendCommand(id, cmd, arg) {
  command(id, cmd, arg)
  log(id, `Manual command: ${cmd}`)
}

async function build(id, code) {
  const r = live[id]
  if (!r) throw new Error('Robot is not connected')
  const names = new Set(r.cfg.api.flatMap(g => g.fns)), errors = []

  setExec(id, 'BUILDING')
  log(id, `Building brain.cpp against the ${r.cfg.type.toUpperCase()} API…`)
  await sleep(450)

  let braces = 0, parens = 0, brackets = 0
  code.split('\n').forEach((line, i) => {
    const txt = line.replace(/\/\/.*$/, '')
    for (const m of txt.matchAll(/robot\.([\w.]+)\(/g)) {
      if (!names.has(m[1])) {
        errors.push({ line: i + 1, msg: `'robot.${m[1]}()' is not part of the ${r.cfg.type.toUpperCase()} API` })
      }
    }
    braces += (txt.match(/{/g) || []).length - (txt.match(/}/g) || []).length
    parens += (txt.match(/\(/g) || []).length - (txt.match(/\)/g) || []).length
    brackets += (txt.match(/\[/g) || []).length - (txt.match(/\]/g) || []).length
    if (braces < 0) errors.push({ line: i + 1, msg: "unexpected '}'" })
    if (parens < 0) errors.push({ line: i + 1, msg: "unexpected ')'" })
    if (brackets < 0) errors.push({ line: i + 1, msg: "unexpected ']'" })
  })

  const last = code.split('\n').length
  if (braces > 0) errors.push({ line: last, msg: "expected '}' before end of file" })
  if (parens > 0) errors.push({ line: last, msg: "expected ')' before end of file" })
  if (brackets > 0) errors.push({ line: last, msg: "expected ']' before end of file" })

  errors.forEach(e => log(id, `brain.cpp:${e.line}: error: ${e.msg}`, 'error'))
  log(id, errors.length ? `Build failed — ${errors.length} error(s)` : 'Build succeeded — 0 errors',
    errors.length ? 'error' : 'ok')
  setExec(id, errors.length ? 'ERROR' : 'STOPPED')
  return { ok: !errors.length, errors }
}

async function run(id) {
  const r = live[id]
  if (!r) throw new Error('Robot is not connected')
  if (r.token) return

  const tk = (r.token = { stop: false })
  const b = r.cfg.brain
  const d = r.cfg.sensors.find(s => s.id === b.sensor)
  const nap = async ms => { await sleep(ms); return tk.stop }

  setExec(id, 'RUNNING')
  log(id, 'Program started')
  log(id, 'Mode: SIMULATION')

  while (!tk.stop) {
    setExec(id, 'WAITING FOR SENSOR DATA')
    if (await nap(650)) return

    const v = r.state.sensors[b.sensor]
    const hit = v < b.lt
    const [cmd, arg] = hit ? b.hit : b.miss
    log(id, `${d.name} = ${Math.round(v)} ${d.unit}`)
    if (hit) log(id, `Decision: ${cmd}`)

    setExec(id, 'SENDING COMMAND')
    if (await nap(250)) return

    command(id, cmd, arg)
    log(id, `Command: ${cmd} ${arg}`)

    setExec(id, 'ROBOT EXECUTING')
    if (await nap(900)) return

    if (hit) r.state.sensors[b.sensor] = b.lt + rnd(25, 70)
  }
}

function stop(id) {
  const r = live[id]
  if (!r) return
  if (r.token) r.token.stop = true
  r.token = null
  command(id, 'STOP')
  setExec(id, 'STOPPED')
  log(id, 'Program stopped', 'warn')
}

function disconnect(id) {
  const r = live[id]
  if (!r) return
  stop(id)
  if (r.timer) clearInterval(r.timer)
  r.subs.clear()
  delete live[id]
}

export const mockRobotApi = { mode: 'simulation', profiles, connect, subscribe, sendCommand, build, run, stop, disconnect }

let active = localStorage.getItem('robotApiMode') === 'bridge' ? realRobotApi : mockRobotApi

export const robotApi = {
  get mode() { return active === realRobotApi ? 'bridge' : 'simulation' },
  profiles,
  setMode(mode, bridgeUrl) {
    if (bridgeUrl) realRobotApi.setBase(bridgeUrl)
    active = mode === 'bridge' ? realRobotApi : mockRobotApi
    localStorage.setItem('robotApiMode', active === realRobotApi ? 'bridge' : 'simulation')
  },
  getBridgeUrl: () => realRobotApi.getBase(),
  connect: (...a) => active.connect(...a),
  subscribe: (...a) => active.subscribe(...a),
  sendCommand: (...a) => active.sendCommand(...a),
  build: (...a) => active.build(...a),
  run: (...a) => active.run(...a),
  stop: (...a) => active.stop(...a),
  disconnect: (...a) => active.disconnect(...a),
}
