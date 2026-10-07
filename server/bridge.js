import http from 'node:http'
import net from 'node:net'
import dgram from 'node:dgram'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
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
          broadcast(r.params.id, { kind: 'telemetry', state: r.lastState })
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

async function getLanDevices() {
  let neighborText = ''
  if (process.platform === 'linux') {
    try {
      const r = await exec('ip', ['-4', '-o', 'addr', 'show', 'scope', 'global'], { timeout: 1200 })
      const rows = (r.stdout || '').split(/\r?\n/).filter(Boolean)
      const cidrs = rows.map(line => line.match(/inet\s+(\d+\.\d+\.\d+\.\d+)\/(\d+)/)).filter(Boolean)
      const cidr = cidrs.find(m => Number(m[2]) >= 24)?.[0]
      if (cidr) {
        const [host, prefix] = cidr.split('/')
        if (Number(prefix) === 24) {
          const octets = host.split('.').map(Number)
          const ips = Array.from({ length: 254 }, (_, i) => [...octets.slice(0, 3), i + 1].join('.'))
          let cursor = 0
          const alive = []
          const workers = Array.from({ length: 48 }, async () => {
            while (cursor < ips.length) {
              const ip = ips[cursor++]
              if (ip === host) continue
              try {
                await exec('ping', ['-c', '1', '-W', '1', ip], { timeout: 1400 })
                alive.push(ip)
              } catch {}
            }
          })
          await Promise.all(workers)
          neighborText = alive.map(ip => ip + ' dev lan REACHABLE').join('\n')
        }
      }
    } catch {}
  }

  try {
    const r = await exec('ip', ['-4', 'neigh', 'show'], { timeout: 1500 })
    neighborText += '\n' + (r.stdout || '')
  } catch {}
  if (!neighborText) {
    try {
      const r = await exec('arp', ['-a'], { timeout: 1500 })
      neighborText = r.stdout || ''
    } catch {}
  }
  return parseNeighbors(neighborText)
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
  const devices = await getLanDevices()
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

  const message = Buffer.from(JSON.stringify({ type: 'discover', protocol: 1 }))
  try { discoverySocket.setBroadcast(true); discoverySocket.send(message, 0, message.length, DISCOVERY_PORT, '255.255.255.255') } catch {}

  await new Promise(r => setTimeout(r, DISCOVERY_WAIT))

  const robotsFound = [...discoveredRobots.values()].map(r => ({
    ...r,
    mac: byIp.get(r.ip)?.mac || null,
  }))

  const robotIps = new Set(robotsFound.map(r => r.ip))
  const network = [...byIp.values()]
    .filter(d => d.state !== 'INCOMPLETE')
    .map(d => ({
      ...d,
      name: d.ip,
      kind: robotIps.has(d.ip) ? 'esp32' : 'device',
      robot: robotsFound.find(r => r.ip === d.ip) || null,
    }))

  for (const robot of robotsFound) {
    if (!byIp.has(robot.ip)) {
      network.push({
        ip: robot.ip,
        mac: robot.mac,
        state: 'DISCOVERED',
        name: robot.name,
        kind: 'esp32',
        robot,
        services: [{ port: robot.port, protocol: 'tcp' }],
      })
    }
  }

  return { devices: network, robots: robotsFound, scannedAt: new Date().toISOString() }
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

    const data = ['POST'].includes(req.method) ? await body(req) : {}
    if (req.method !== 'POST') return json(res, 404, { error: 'Not found' })

    if (url.pathname === '/api/robot/connect') {
      const params = { ...data, id: String(data.id || '').trim(), type: String(data.type || ''), port: Number(data.port) || 5000 }
      if (!params.id || !params.ip) return json(res, 400, { error: 'Robot ID and IP are required' })
      if (robots.has(params.id)) robots.get(params.id).socket?.destroy()
      const r = { params, robot: baseRobot(params), socket: null, clients: new Set(), connected: false, tx: 0, rx: 0, lastSeen: Date.now(), lastState: null }
      robots.set(params.id, r)
      attachSocket(r)
      return json(res, 200, { robot: r.robot, transport: 'tcp', status: 'connecting' })
    }

    if (url.pathname === '/api/robot/disconnect') {
      const r = robots.get(data.id)
      if (r) {
        r.socket?.destroy()
        for (const client of r.clients) client.end()
        robots.delete(data.id)
      }
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/robot/command') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      sendTcp(r, { type: 'command', cmd: String(data.cmd || 'STOP'), arg: data.arg ?? null })
      return json(res, 200, { ok: true })
    }

    if (url.pathname === '/api/robot/build') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
      const names = new Set(r.robot.api.flatMap(g => g.fns))
      const errors = []
      String(data.code || '').split('\n').forEach((line, i) => {
        for (const m of line.replace(/\/\/.*$/, '').matchAll(/robot\.([\w.]+)\(/g))
          if (!names.has(m[1])) errors.push({ line: i + 1, msg: `unknown robot API: robot.${m[1]}()` })
      })
      return json(res, 200, { ok: errors.length === 0, errors, compiler: 'bridge-validator' })
    }

    if (url.pathname === '/api/robot/run') {
      return json(res, 501, { error: 'Native C++ brain runner is not installed yet. Bridge mode currently provides real telemetry and manual command transport.' })
    }

    if (url.pathname === '/api/robot/stop') {
      const r = robots.get(data.id)
      if (!r) return json(res, 404, { error: 'Robot is not connected' })
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