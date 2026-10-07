import { CATALOG } from '../robots/catalog.js'

let base = localStorage.getItem('robotBridgeUrl') || 'http://127.0.0.1:8000'
const streams = new Map()

const request = async (path, options = {}) => {
  const res = await fetch(base.replace(/\/$/, '') + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Bridge returned HTTP ${res.status}`)
  return data
}

const profiles = () => Object.entries(CATALOG).map(([type, e]) => ({
  type, label: e.label, defaults: { ...e.defaults, type }
}))

const closeStream = id => {
  const s = streams.get(id)
  if (s) {
    s.source.close()
    streams.delete(id)
  }
}

async function connect(params) {
  const data = await request('/api/robot/connect', {
    method: 'POST',
    body: JSON.stringify(params),
  })
  return data.robot
}

function subscribe(id, fn) {
  closeStream(id)
  const source = new EventSource(`${base.replace(/\/$/, '')}/api/robot/events?id=${encodeURIComponent(id)}`)
  source.onmessage = e => {
    try { fn(JSON.parse(e.data)) } catch {}
  }
  source.onerror = () => fn({ kind: 'log', line: {
    t: new Date().toTimeString().slice(0, 8),
    level: 'error',
    text: 'Local bridge event stream disconnected',
  }})
  streams.set(id, { source })
  return () => closeStream(id)
}

const sendCommand = (id, cmd, arg) => request('/api/robot/command', {
  method: 'POST',
  body: JSON.stringify({ id, cmd, arg }),
})
const build = (id, code) => request('/api/robot/build', {
  method: 'POST',
  body: JSON.stringify({ id, code }),
})
const run = id => request('/api/robot/run', { method: 'POST', body: JSON.stringify({ id }) })
const stop = id => request('/api/robot/stop', { method: 'POST', body: JSON.stringify({ id }) })

const disconnect = async id => {
  closeStream(id)
  await request('/api/robot/disconnect', {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}

export const realRobotApi = {
  profiles,
  connect,
  subscribe,
  sendCommand,
  build,
  run,
  stop,
  disconnect,
  setBase(url) {
    base = url.trim().replace(/\/$/, '') || 'http://127.0.0.1:8000'
    localStorage.setItem('robotBridgeUrl', base)
  },
  getBase() { return base },
}
