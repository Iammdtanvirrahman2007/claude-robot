const TTL = 9000
const MAX = 160
const STEP_CM = 12
const CELL_CM = 20

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const normalize = d => {
  let h = Number(d) || 0
  while (h > 180) h -= 360
  while (h <= -180) h += 360
  return h
}

export function createSimulationWorld() {
  const model = {
    x: 0, y: 0, heading: 0,
    path: [{ x: 0, y: 0 }],
    obstacles: new Map(),
    objects: new Map(),
    lastCommand: 'IDLE',
    lastTurnCommand: null,
    lastUpdate: Date.now(),
    cells: new Map(),
    visits: new Map(),
  }

  const move = (command, arg, dt) => {
    const cmd = String(command || '').toUpperCase()
    const value = Number(arg)
    const scale = Number.isFinite(value) ? clamp(Math.abs(value) / 70, 0.35, 1.5) : 1
    const step = STEP_CM * scale * clamp(Number(dt) || 0, 0, 1500) / 600

    if (cmd === 'TURN_LEFT' || cmd === 'TURN_RIGHT') {
      if (model.lastTurnCommand !== cmd) {
        model.heading = normalize(model.heading + (cmd === 'TURN_LEFT' ? -1 : 1) * (Number.isFinite(value) ? clamp(Math.abs(value), 15, 180) : 90))
        model.lastTurnCommand = cmd
      }
      return
    }
    model.lastTurnCommand = null

    const r = model.heading * Math.PI / 180
    if (/FORWARD/.test(cmd)) {
      const sign = /BACKWARD/.test(cmd) ? -1 : 1
      model.x += Math.sin(r) * step * sign
      model.y += Math.cos(r) * step * sign
    }
  }

  const prune = now => {
    for (const [id, o] of model.obstacles) if (now - o.lastSeen > TTL) model.obstacles.delete(id)
    for (const [id, o] of model.objects) if (now - o.lastSeen > TTL) model.objects.delete(id)
    while (model.path.length > 700) model.path.shift()
    while (model.obstacles.size > MAX) model.obstacles.delete(model.obstacles.keys().next().value)
  }

  const observe = (distanceCm, blocked = false, now = Date.now()) => {
    const rc = { x: Math.round(model.x / CELL_CM), y: Math.round(model.y / CELL_CM) }
    const rk = rc.x + ',' + rc.y
    const current = model.cells.get(rk) || { x: rc.x, y: rc.y, state: 'free', confidence: 1 }
    current.lastSeen = now
    current.visits = (model.visits.get(rk) || 0) + 1
    model.cells.set(rk, current)
    model.visits.set(rk, current.visits)
    if (Number.isFinite(Number(distanceCm)) && Number(distanceCm) < 120) {
      const d = Number(distanceCm)
      const r = model.heading * Math.PI / 180
      const x = model.x + Math.sin(r) * d
      const y = model.y + Math.cos(r) * d
      model.obstacles.set('sim-front', { id: 'sim-front', label: 'simulated obstacle', x, y, distanceCm: d, position: 'center', lastSeen: now })
      const oc = { x: Math.round(x / CELL_CM), y: Math.round(y / CELL_CM) }; const ok = oc.x + ',' + oc.y
      model.cells.set(ok, { x: oc.x, y: oc.y, state: 'blocked', confidence: 0.9, lastSeen: now, visits: model.visits.get(ok) || 0 })
    }
    if (blocked) {
      const d = Number.isFinite(Number(distanceCm)) ? Number(distanceCm) : 20
      const r = model.heading * Math.PI / 180
      model.obstacles.set('sim-blocked', { id: 'sim-blocked', label: 'blocked path', x: model.x + Math.sin(r) * d, y: model.y + Math.cos(r) * d, distanceCm: d, position: 'center', lastSeen: now })
    }
    prune(now)
  }

  const update = (command, arg, sensorDistance, now = Date.now()) => {
    move(command, arg, now - model.lastUpdate)
    model.lastUpdate = now
    model.lastCommand = command || 'IDLE'
    const last = model.path.at(-1)
    if (!last || Math.hypot(model.x - last.x, model.y - last.y) >= 2) model.path.push({ x: model.x, y: model.y })
    observe(sensorDistance, Number(sensorDistance) <= 15, now)
  }

  const snapshot = () => {
    const now = Date.now()
    prune(now)
    return {
      frame: 'local-2d', units: 'cm', origin: { x: 0, y: 0 },
      robot: { x: Math.round(model.x * 10) / 10, y: Math.round(model.y * 10) / 10, heading: Math.round(model.heading * 10) / 10 },
      path: model.path.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      obstacles: [...model.obstacles.values()].map(o => ({ ...o, ageMs: now - o.lastSeen })),
      objects: [...model.objects.values()].map(o => ({ ...o, ageMs: now - o.lastSeen })),
      grid: { cellSizeCm: CELL_CM, cells: [...model.cells.values()].map(c => ({ ...c, visits: model.visits.get(c.x + ',' + c.y) || 0 })) },
      lastCommand: model.lastCommand,
      updatedAt: new Date(now).toISOString(),
    }
  }

  return { update, snapshot }
}
