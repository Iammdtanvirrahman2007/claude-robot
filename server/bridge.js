import http from 'node:http'
import net from 'node:net'
import { CATALOG } from '../src/robots/catalog.js'
import { toRobot } from '../src/models/robot.js'

const HOST = process.env.BRIDGE_HOST || '127.0.0.1'
const PORT = Number(process.env.BRIDGE_PORT || 8000)
const robots = new Map()

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
      return json(res, 200, { ok: true, bridge: 'robot-control', version: 1, robots: robots.size })
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