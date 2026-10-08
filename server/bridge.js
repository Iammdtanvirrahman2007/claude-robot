import http from 'node:http'
import net from 'node:net'
import dgram from 'node:dgram'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { buildBrain, startBrain } from './brainRunner.js'
import { startAIBrain, stopAIBrain, aiBrainRunning, decide, personalityProfiles, commandForFunction, highLevelIntents } from './aiBrain.js'
import { analyzeFrame } from './vision.js'
import { createWorldModel } from './worldModel.js'
import { createNavigationMap } from './navigationMap.js'
import { createRouteExecutor } from './routeExecutor.js'
import { createPathPlanner } from './pathPlanner.js'
import { CATALOG } from '../src/robots/catalog.js'
import { toRobot } from '../src/models/robot.js'

const HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const PORT = Number(process.env.BRIDGE_PORT || 8000)
const DISCOVERY_PORT = Number(process.env.DISCOVERY_PORT || 4210)
const DISCOVERY_WAIT = 1400
const exec = promisify(execFile)
const robots = new Map()
const discoverySocket = dgram.createSocket('udp4')
const discoveredRobots = new Map()

const json = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  })
  res.end(JSON.stringify(data))
}

const sseHeaders = {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  Connection: 'keep-alive',
  'Access-Control-Allow-Origin': '*',
}

discoverySocket.on('message', (buf, rinfo) => {
  try {
    const msg = JSON.parse(buf.toString())
    if (msg.type !== 'robot' || msg.protocol !== 1) return
    const port = Number(msg.tcp_port || 5000)
    if (!msg.id || !msg.robot_type) return
    discoveredRobots.set(msg.id, {
      kind: 'esp32',
      name: msg.name || msg.id,
      id: msg.id,
      type: msg.robot_type,
      ip: rinfo.address,
      port,
      firmware: msg.firmware || 'unknown',
      version: msg.version || '1',
      lastSeen: Date.now(),
    })
  } catch {}
})

discoverySocket.bind(DISCOVERY_PORT, '0.0.0.0', () => {
  try { discoverySocket.setBroadcast(true) } catch {}
  console.log(`ESP32 discovery listening on UDP ${DISCOVERY_PORT}`)
})

const body = req => new Promise((resolve, reject) => {
  let raw = ''
  req.on('data', c => { raw += c })
  req.on('end', () => {
    try { resolve(raw ? JSON.parse(raw) : {}) } catch (e) { reject(new Error('Invalid JSON body')) }
  })
  req.on('error', reject)
})

const broadcast = (id, event) => {
  const r = robots.get(id)
  if (!r) return
  const line = `data: ${JSON.stringify(event)}\n\n`
  for (const res of r.clients) res.write(line)
}

function fuseVisionWithSensors(vision, state) {
  const sensors = state?.sensors || {}
  const raw = sensors.front_distance ?? sensors.obstacle ?? null
  const numeric = Number(raw)
  const unit = sensors.obstacle != null && sensors.front_distance == null ? 'm' : 'cm'
  const distanceCm = Number.isFinite(numeric) ? (unit === 'm' ? numeric * 100 : numeric) : null
  if (distanceCm == null) return vision

  const objects = [...(vision.objects || [])]
  const center = objects.find(o => o.position === 'center')
  if (center) {
    center.sensorDistance = Math.round(distanceCm * 10) / 10
    center.sensorDistanceUnit = 'cm'
    if (distanceCm <= 20) center.distance = 'near'
    else if (distanceCm <= 80) center.distance = 'medium'
    else center.distance = 'far'
  } else if (distanceCm <= 80) {
    objects.push({
      label: 'sensor-detected obstacle',
      confidence: 0.65,
      position: 'center',
      distance: distanceCm <= 20 ? 'near' : 'medium',
      sensorDistance: Math.round(distanceCm * 10) / 10,
      sensorDistanceUnit: 'cm',
    })
  }

  const sensorBlocked = distanceCm <= 15
  return {
    ...vision,
    objects,
    fused: {
      sensor: unit === 'm' ? 'obstacle' : 'front_distance',
      distanceCm: Math.round(distanceCm * 10) / 10,
      blocked: sensorBlocked,
      at: new Date().toISOString(),
    },
    path: sensorBlocked ? { clear: false, direction: 'blocked' } : vision.path,
  }
}

const updateWorldFromState = (r, state) => {
  if (!r.world) return
  r.world.updateMovement(state?.currentCommand || 'IDLE', state?.speed ?? 0, Date.now())
  const sensors = state?.sensors || {}
  const raw = sensors.front_distance ?? sensors.obstacle
  const n = Number(raw)
  const distanceCm = Number.isFinite(n) ? (sensors.obstacle != null && sensors.front_distance == null ? n * 100 : n) : null
  if (state?.camera?.vision) r.world.observe(state.camera.vision, distanceCm)
  r.navigation?.observe(r.world.snapshot())
  state.camera = state.camera ? { ...state.camera, world: { ...r.world.snapshot(), navigation: r.navigation?.snapshot() } } : { world: { ...r.world.snapshot(), navigation: r.navigation?.snapshot() } }
}

const validateCommand = (r, rawCmd, rawArg) => {
  const cmd = String(rawCmd || 'STOP').trim().toUpperCase()
  const controls = r.robot?.controls?.length ? r.robot.controls : (CATALOG[r.params.type]?.controls || [])
  const allowed = new Set(controls.map(x => String(x.cmd || '').toUpperCase()))
  if (!allowed.has(cmd)) throw new Error('Command is not supported by this robot: ' + cmd)
  const n = Number(rawArg)
  const arg = Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
  return { cmd, arg }
}

const sendTcp = (r, message) => {
  if (!r.socket || r.socket.destroyed) throw new Error('ESP32 TCP connection is not open')
  r.socket.write(JSON.stringify(message) + '\n')
  r.tx++
}

const normalizeRobot = (r, raw) => {
  try {
    const cfg = toRobot(raw, r.params)
    r.robot = cfg
    broadcast(r.params.id, { kind: 'log', line: {
      t: new Date().toTimeString().slice(0, 8),
      level: 'ok',
      text: 'Hardware description received from ESP32',
    }})
    return cfg
  } catch {
    return null
  }
}

function attachSocket(r) {
  const socket = r.socket = net.createConnection({
    host: r.params.ip,
    port: Number(r.params.port) || 5000,
  })
  socket.setEncoding('utf8')
  let buffer = ''

  socket.on('connect', () => {
    r.connected = true
    r.lastSeen = Date.now()
    const sensors = Object.fromEntries(r.robot.sensors.map(s => [s.id, s.v ?? null]))
    const actuators = Object.fromEntries(r.robot.actuators.map(a => [a.id, a.v ?? 0]))
    r.lastState = {
      connected: true, battery: sensors.battery ?? null, currentCommand: 'IDLE', speed: 0,
      sensors, actuators, camera: r.robot.camera ? { ...r.robot.camera, status: 'Waiting for frames' } : null,
      errors: [], link: { latency: 0, rssi: 0, tx: r.tx, rx: r.rx }, heartbeat: r.lastSeen
    }
    try { sendTcp(r, { type: 'hello', id: r.params.id, protocol: 1 }) } catch {}
    broadcast(r.params.id, { kind: 'telemetry', state: r.lastState })
    broadcast(r.params.id, { kind: 'log', line: {
      t: new Date().toTimeString().slice(0, 8), level: 'ok',
      text: `TCP connected to ${r.params.ip}:${r.params.port}`,
    }})
  })

  socket.on('data', chunk => {
    buffer += chunk
    let cut
    while ((cut = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, cut).trim()
      buffer = buffer.slice(cut + 1)
      if (!line) continue
      try {
        const msg = JSON.parse(line)
        r.lastSeen = Date.now()
        r.rx++
        if (msg.type === 'hardware' && msg.robot) normalizeRobot(r, { ...msg.robot, type: msg.robot.type || r.params.type })
        else if (msg.type === 'telemetry' && msg.state) {
          r.lastState = { ...msg.state, connected: true, heartbeat: r.lastSeen,
            link: { ...(msg.state.link || {}), tx: r.tx, rx: r.rx } }
          updateWorldFromState(r, r.lastState)
          broadcast(r.params.id, { kind: 'telemetry', state: r.lastState })
          r.brain?.feed(r.lastState)
        }
        else if (msg.type === 'log') broadcast(r.params.id, { kind: 'log', line: msg.line || {
          t: new Date().toTimeString().slice(0, 8), level: 'info', text: String(msg.text || '')
        }})
        else if (msg.type === 'exec') broadcast(r.params.id, { kind: 'exec', status: msg.status })
      } catch {
        broadcast(r.params.id, { kind: 'log', line: {
          t: new Date().toTimeString().slice(0, 8), level: 'warn', text: 'Ignored malformed ESP32 packet'
        }})
      }
    }
  })

  socket.on('error', err => {
    broadcast(r.params.id, { kind: 'log', line: {
      t: new Date().toTimeString().slice(0, 8), level: 'error', text: `TCP error: ${err.message}`
    }})
  })

  socket.on('close', () => {
    r.connected = false
    broadcast(r.params.id, { kind: 'log', line: {
      t: new Date().toTimeString().slice(0, 8), level: 'warn',
      text: 'ESP32 TCP connection closed',
    }})
    broadcast(r.params.id, { kind: 'telemetry', state: {
      ...(r.lastState || {}), connected: false,
      link: { latency: 0, rssi: 0, tx: r.tx, rx: r.rx }
    }})
  })
}

function baseRobot(params) {
  const raw = CATALOG[params.type]
  if (!raw) throw new Error('Unknown robot type')
  return toRobot(raw, { id: params.id, ip: params.ip, port: Number(params.port) || 5000 })
}

function parseNeighbors(text) {
  const out = new Map()
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(?:^|\s)(\d{1,3}(?:\.\d{1,3}){3})\s+(?:dev\s+\S+\s+)?(?:lladdr\s+)?([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s*(\w+)?/i)
    if (m) out.set(m[1], { ip: m[1], mac: m[2].toUpperCase(), state: m[3] || 'UNKNOWN' })
  }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/(?:^|\()(\d{1,3}(?:\.\d{1,3}){3})\)?\s+at\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})/i)
    if (m && !out.has(m[1])) out.set(m[1], { ip: m[1], mac: m[2].toUpperCase(), state: 'ARP' })
  }
  return [...out.values()]
}

async function getLocalNetwork() {
  try {
    const r = await exec('ip', ['-4', '-o', 'addr', 'show', 'scope', 'global'], { timeout: 1500 })
    const rows = (r.stdout || '').split(/\r?\n/).filter(Boolean)
    for (const line of rows) {
      const m = line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+).*?brd\s+(\d+\.\d+\.\d+\.\d+)/)
      if (m) return { host: m[1], prefix: Number(m[2]), broadcast: m[3] }
    }
  } catch {}
  return null
}

function parseNmap(text) {
  const out = new Map()
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^Nmap scan report for (?:[^\s]+\s+)?(\d{1,3}(?:\.\d{1,3}){3})$/)
    if (h) {
      current = { ip: h[1], mac: null, state: 'UP' }
      out.set(current.ip, current)
      continue
    }
    const mac = line.match(/MAC Address:\s*([0-9A-F:]{17})\s*(?:\(([^)]+)\))?/i)
    if (mac && current) {
      current.mac = mac[1].toUpperCase()
      current.vendor = mac[2] || null
    }
  }
  return [...out.values()]
}

async function scanWithNmap(cidr) {
  try {
    const r = await exec('nmap', ['-sn', '-PR', '-n', cidr], {
      timeout: 8000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return parseNmap(r.stdout || '')
  } catch {
    return null
  }
}

async function scan24(host, prefix) {
  if (prefix !== 24) return []
  const octets = host.split('.').map(Number)
  const ips = Array.from({ length: 254 }, (_, i) => [...octets.slice(0, 3), i + 1].join('.'))
  let cursor = 0
  const alive = new Map()
  const workers = Array.from({ length: 48 }, async () => {
    while (cursor < ips.length) {
      const ip = ips[cursor++]
      if (ip === host) continue
      try {
        await exec('ping', ['-c', '1', '-W', '1', ip], { timeout: 1400 })
        alive.set(ip, { ip, mac: null, state: 'UP' })
      } catch {}
    }
  })
  await Promise.all(workers)
  return [...alive.values()]
}

async function getLanDevices() {
  const local = await getLocalNetwork()
  let devices = []
  let method = 'neighbor-table'

  if (local) {
    const cidr = `${local.host}/${local.prefix}`
    const nmap = await scanWithNmap(cidr)
    if (nmap?.length) {
      devices = nmap
      method = 'nmap-arp'
    } else {
      devices = await scan24(local.host, local.prefix)
      if (devices.length) method = 'icmp-scan'
    }
  }

  let neighborText = ''
  try {
    const r = await exec('ip', ['-4', 'neigh', 'show'], { timeout: 1500 })
    neighborText = r.stdout || ''
  } catch {}

  const neighbors = parseNeighbors(neighborText)
  const byIp = new Map(devices.map(d => [d.ip, d]))
  for (const n of neighbors) {
    const current = byIp.get(n.ip)
    if (current) {
      current.mac = current.mac || n.mac
      current.state = current.state || n.state
    } else if (n.state !== 'INCOMPLETE') {
      byIp.set(n.ip, n)
    }
  }

  return { devices: [...byIp.values()], method, local }
}
const tcpProbe = (host, port, timeout = 250) => new Promise(resolve => {
  const s = net.createConnection({ host, port })
  let done = false
  const finish = ok => {
    if (done) return
    done = true
    s.destroy()
    resolve(ok)
  }
  s.setTimeout(timeout, () => finish(false))
  s.on('connect', () => finish(true))
  s.on('error', () => finish(false))
})

async function discoverNetwork() {
  discoveredRobots.clear()
  const scan = await getLanDevices()
  const devices = scan.devices || []
  const extra = []
  const candidateIps = devices.map(d => d.ip)

  const queue = candidateIps.filter(ip => ip !== '127.0.0.1').map(ip => async () => {
    const ports = []
    for (const port of [5000, 80, 81, 8080]) {
      if (await tcpProbe(ip, port)) ports.push(port)
    }
    return { ip, ports }
  })

  let cursor = 0
  const workers = Array.from({ length: Math.min(24, queue.length) }, async () => {
    while (cursor < queue.length) {
      const i = cursor++
      extra[i] = await queue[i]()
    }
  })
  await Promise.all(workers)

  const byIp = new Map(devices.map(d => [d.ip, d]))
  for (const p of extra) {
    const d = byIp.get(p.ip)
    if (d) d.services = p.ports.map(port => ({ port, protocol: 'tcp' }))
  }

  const broadcastAddress = scan.local?.broadcast || '255.255.255.255'
  const message = Buffer.from(JSON.stringify({ type: 'discover', protocol: 1 }))
  try {
    discoverySocket.setBroadcast(true)
    discoverySocket.send(message, 0, message.length, DISCOVERY_PORT, broadcastAddress)
  } catch {}
  if (broadcastAddress !== '255.255.255.255') {
    try { discoverySocket.send(message, 0, message.length, DISCOVERY_PORT, '255.255.255.255') } catch {}
  }

  await new Promise(r => setTimeout(r, DISCOVERY_WAIT))

  const robotsFound = [...discoveredRobots.values()].map(r => ({
    ...r,
    mac: byIp.get(r.ip)?.mac || null,
  }))

  const robotByIp = new Map(robotsFound.map(r => [r.ip, r]))
  const network = [...byIp.values()]
    .filter(d => d.state !== 'INCOMPLETE')
    .map(d => ({
      ...d,
      name: robotByIp.get(d.ip)?.name || d.vendor || d.ip,
      kind: robotByIp.has(d.ip) ? 'esp32' : 'device',
      robot: robotByIp.get(d.ip) || null,
    }))

  for (const robot of robotsFound) {
    if (!byIp.has(robot.ip)) {
      network.push({
        ip: robot.ip, mac: robot.mac, state: 'DISCOVERED',
        name: robot.name, kind: 'esp32', robot,
        services: [{ port: robot.port, protocol: 'tcp' }],
      })
    }
  }

  network.sort((a, b) => (a.kind === 'esp32' ? -1 : 1) - (b.kind === 'esp32' ? -1 : 1) || a.ip.localeCompare(b.ip, undefined, { numeric: true }))
  return {
    devices: network,
    robots: robotsFound,
    scannedAt: new Date().toISOString(),
    method: scan.method,
    subnet: scan.local ? `${scan.local.host}/${scan.local.prefix}` : null,
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return json(res, 204, {})
  const url = new URL(req.url, `http://${HOST}:${PORT}`)
  const id = url.searchParams.get('id')

  try {
    if (req.method === 'GET' && url.pathname === '/api/profiles') {
      return json(res, 200, Object.entries(CATALOG).map(([type, e]) => ({
        type, label: e.label, defaults: { ...e.defaults, type }
      })))
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, bridge: 'robot-control', version: 2, robots: robots.size, discoveryPort: DISCOVERY_PORT })
    }

    if (req.method === 'GET' && url.pathname === '/api/discover') {
      return json(res, 200, await discoverNetwork())
    }

    if (req.method === 'GET' && url.pathname === '/api/robot/events') {
      if (!id || !robots.has(id)) return json(res, 404, { error: 'Robot not connected' })
      const r = robots.get(id)
      res.writeHead(200, sseHeaders)
      res.write(`data: ${JSON.stringify({ kind: 'telemetry', state: r.lastState || {
        connected: r.connected, battery: null, currentCommand: 'IDLE', speed: 0,
        sensors: {}, actuators: {}, camera: null, errors: [],
        link: { latency: 0, rssi: 0, tx: r.tx, rx: r.rx }, heartbeat: r.lastSeen
      }})}\n\n`)
      r.clients.add(res)
      req.on('close', () => r.clients.delete(res))
      return
    }

    if (req.method === 'GET' && url.pathname === '/api/robot/world') {
      const r = robots.get(id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      return json(res, 200, r.world?.snapshot() || null)
    }

    const data = req.method === 'POST' ? await body(req) : {}
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found' })

    if (url.pathname === '/api/robot/connect') {
      const params = { ...data, id: String(data.id || '').trim(), type: String(data.type || ''), port: Number(data.port) || 5000 }
      if (!params.id || !params.ip) return json(res, 400, { error: 'Robot ID and IP are required' })
      if (robots.has(params.id)) {
    const old = robots.get(params.id)
    old.brain?.stop()
    stopAIBrain(params.id)
    old.socket?.destroy()
  }
      const r = { params, robot: baseRobot(params), socket: null, clients: new Set(), connected: false, tx: 0, rx: 0, lastSeen: Date.now(), lastState: null, code: '', brain: null, aiBrain: false, buildDir: null, buildBinary: null, world: createWorldModel(), navigation: createNavigationMap(), planner: createPathPlanner(), route: createRouteExecutor() }
      robots.set(params.id, r)
      attachSocket(r)
      return json(res, 200, { robot: r.robot, transport: 'tcp', status: 'connecting' })
    }

    if (url.pathname === '/api/robot/disconnect') {
      const r = robots.get(data.id)
      if (r) {
        r.brain?.stop()
        stopAIBrain(data.id)
        r.socket?.destroy()
        for (const client of r.clients) client.end()
        robots.delete(data.id)
      }
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/robot/navigate') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      const world = r.world?.snapshot() || { robot: { x: 0, y: 0 } }
      const map = r.navigation?.snapshot() || { cells: [], blocked: [] }
      const goal = { x: Number(data.x), y: Number(data.y) }
      if (!Number.isFinite(goal.x) || !Number.isFinite(goal.y)) return json(res, 400, { error: 'Goal x and y are required' })
      const path = r.planner.plan(map, {
        x: Math.round((world.robot?.x || 0) / (map.cellSizeCm || 20)),
        y: Math.round((world.robot?.y || 0) / (map.cellSizeCm || 20)),
      }, goal)
      if (!path.length) return json(res, 409, { error: 'No safe route to goal', path: [] })
      r.route.setRoute(path, world.robot?.heading || 0)
      return json(res, 200, { ok: true, path, route: r.route.status() })
    }

    if (url.pathname === '/api/robot/navigate/next') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      const decision = r.route.next(r.world?.snapshot()?.robot || {})
      if (decision.command !== 'STOP') {
        const command = validateCommand(r, decision.command, decision.arg)
        sendTcp(r, { type: 'command', cmd: command.cmd, arg: command.arg })
      }
      broadcast(r.params.id, { kind: 'navigation', decision, route: r.route.status() })
      return json(res, 200, { ok: true, decision, route: r.route.status() })
    }

    if (url.pathname === '/api/robot/command') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      let command
      try { command = validateCommand(r, data.cmd, data.arg) }
      catch (e) { return json(res, 400, { error: e.message }) }
      sendTcp(r, { type: 'command', cmd: command.cmd, arg: command.arg })
      return json(res, 200, { ok: true, command })
    }

    if (url.pathname === '/api/robot/vision/status') {
      return json(res, 200, { model: process.env.ROBOT_VISION_MODEL || 'gpt-6-astra', apiConfigured: Boolean(process.env.OPENAI_API_KEY) })
    }

    if (url.pathname === '/api/robot/vision/analyze') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      const rawVision = await analyzeFrame(String(data.image || ''), r.lastState || {})
      const vision = fuseVisionWithSensors(rawVision, r.lastState || {})
      r.lastState = { ...r.lastState, camera: { ...(r.lastState?.camera || {}), status: 'Vision active', vision } }
      r.world.observe(vision, vision.fused?.distanceCm ?? null)
      r.lastState.camera.world = r.world.snapshot()
      broadcast(r.params.id, { kind: 'telemetry', state: r.lastState })
      broadcast(r.params.id, { kind: 'vision', vision })
      return json(res, 200, vision)
    }

    if (url.pathname === '/api/robot/ai/status') {
      const r = robots.get(data.id || id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      return json(res, 200, { running: aiBrainRunning(r.params.id), personalities: personalityProfiles, model: process.env.ROBOT_AI_MODEL || 'gpt-6-luna', apiConfigured: Boolean(process.env.OPENAI_API_KEY) })
    }

    if (url.pathname === '/api/robot/ai/decide') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      const decision = await decide({ robot: r.robot, state: r.lastState || {}, personality: data.personality || 'default' })
      if (data.execute !== false && r.connected && decision.function) {
        sendTcp(r, { type: 'command', cmd: commandForFunction(decision.function), arg: decision.arg ?? 0 })
      }
      broadcast(r.params.id, { kind: 'ai', decision })
      return json(res, 200, decision)
    }

    if (url.pathname === '/api/robot/ai/start') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      if (!process.env.OPENAI_API_KEY) return json(res, 400, { error: 'OPENAI_API_KEY is not configured on the laptop bridge' })
      stopAIBrain(r.params.id)
      await startAIBrain({
        robot: r.robot,
        getState: () => r.lastState || {},
        personality: data.personality || 'default',
        interval: Math.max(1200, Math.min(10000, Number(data.interval) || 2500)),
        sendCommand: (cmd, arg) => {
          if (!cmd || !r.connected) return
          sendTcp(r, { type: 'command', cmd, arg: arg ?? 0 })
        },
        resolveIntent: intent => {
          if (intent === highLevelIntents.hold) return { command: 'STOP', arg: 0, reason: 'AI requested hold position' }
          if (intent === highLevelIntents.explore) {
            const world = r.world?.snapshot() || { robot: { x: 0, y: 0 } }
            if (!r.route?.status()?.active) {
              const target = r.navigation?.chooseTarget(world)
              const map = r.navigation?.snapshot() || { cellSizeCm: 20, cells: [], blocked: [] }
              if (!target) return { command: 'STOP', arg: 0, reason: 'no exploration frontier' }
              const size = map.cellSizeCm || 20
              const start = {
                x: Math.round((world.robot?.x || 0) / size),
                y: Math.round((world.robot?.y || 0) / size),
              }
              const path = r.planner?.plan(map, start, { x: target.x, y: target.y }) || []
              if (!path.length) return { command: 'STOP', arg: 0, reason: 'no safe exploration route' }
              r.route.setRoute(path, world.robot?.heading || 0)
            }
            return r.route.next(world.robot || {})
          }
          return null
        },
        onDecision: decision => broadcast(r.params.id, { kind: 'ai', decision }),
        onError: error => broadcast(r.params.id, { kind: 'log', line: { t: new Date().toTimeString().slice(0,8), level: 'error', text: 'AI brain: ' + error.message } }),
      })
      broadcast(r.params.id, { kind: 'exec', status: 'AI RUNNING' })
      return json(res, 200, { ok: true, running: true, personality: data.personality || 'default' })
    }

    if (url.pathname === '/api/robot/ai/stop') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      stopAIBrain(r.params.id)
      broadcast(r.params.id, { kind: 'exec', status: 'STOPPED' })
      return json(res, 200, { ok: true, running: false })
    }

    if (url.pathname === '/api/robot/build') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })

      r.code = String(data.code || '')
      const names = new Set(r.robot.api.flatMap(g => g.fns))
      const errors = []
      r.code.split('\n').forEach((line, i) => {
        for (const m of line.replace(/\/\/.*$/, '').matchAll(/robot\.([\w.]+)\(/g))
          if (!names.has(m[1])) errors.push({ line: i + 1, msg: `unknown robot API: robot.${m[1]}()` })
      })

      if (errors.length) {
        broadcast(r.params.id, { kind: 'exec', status: 'ERROR' })
        errors.forEach(e => broadcast(r.params.id, { kind: 'log', line: {
          t: new Date().toTimeString().slice(0, 8), level: 'error',
          text: `brain.cpp:${e.line}: error: ${e.msg}`
        }}))
        return json(res, 200, { ok: false, errors, compiler: 'bridge-validator' })
      }

      r.brain?.stop()
      const result = await buildBrain(r.code)
      if (!result.ok) {
        broadcast(r.params.id, { kind: 'exec', status: 'ERROR' })
        for (const e of result.errors) broadcast(r.params.id, { kind: 'log', line: {
          t: new Date().toTimeString().slice(0, 8), level: 'error',
          text: `brain.cpp:${e.line}: error: ${e.msg}`
        }})
        return json(res, 200, {
          ok: false, errors: result.errors, compiler: 'g++',
          compilerOutput: result.compilerOutput
        })
      }

      r.buildDir = result.dir
      r.buildBinary = result.binary
      broadcast(r.params.id, { kind: 'exec', status: 'STOPPED' })
      broadcast(r.params.id, { kind: 'log', line: {
        t: new Date().toTimeString().slice(0, 8), level: 'ok',
        text: 'C++ build succeeded — native brain executable ready'
      }})
      return json(res, 200, { ok: true, errors: [], compiler: 'g++' })
    }

    if (url.pathname === '/api/robot/run') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      if (!r.buildBinary) return json(res, 400, { error: 'Build brain.cpp successfully before Run' })

      r.brain?.stop()
      r.brain = startBrain({
        binary: r.buildBinary,
        initialState: r.lastState,
        sendCommand: (cmd, arg) => {
          try {
            sendTcp(r, { type: 'command', cmd, arg: arg ?? null })
            broadcast(r.params.id, { kind: 'log', line: {
              t: new Date().toTimeString().slice(0, 8), level: 'info',
              text: `Brain command: ${cmd} ${arg ?? ''}`.trim()
            }})
          } catch (e) {
            broadcast(r.params.id, { kind: 'log', line: {
              t: new Date().toTimeString().slice(0, 8), level: 'error',
              text: `Brain command failed: ${e.message}`
            }})
          }
        },
        onLog: line => broadcast(r.params.id, { kind: 'log', line }),
        onExec: status => broadcast(r.params.id, { kind: 'exec', status }),
        onExit: () => { r.brain = null },
      })

      return json(res, 200, { ok: true, status: 'running', runner: 'native-cpp' })
    }

    if (url.pathname === '/api/robot/stop') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      r.brain?.stop()
      r.brain = null
      stopAIBrain(data.id)
      sendTcp(r, { type: 'command', cmd: 'STOP', arg: null })
      broadcast(data.id, { kind: 'exec', status: 'STOPPED' })
      return json(res, 200, { ok: true })
    }

    return json(res, 404, { error: 'Unknown API endpoint' })
  } catch (e) {
    return json(res, 502, { error: e.message || String(e) })
  }
})

server.listen(PORT, HOST, () => {
  console.log(`Robot bridge listening on http://${HOST}:${PORT}`)
  console.log('ESP32 protocol: newline-delimited JSON over TCP')
})