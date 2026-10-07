const TRACK_TTL_MS = 9000
const MAX_TRACKS = 160
const DEFAULT_STEP_CM = 12
const TURN_DEG = 90

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))

function normalizeHeading(deg) {
  let h = Number(deg) || 0
  while (h > 180) h -= 360
  while (h <= -180) h += 360
  return h
}

function keyFor(label, position) {
  return String(label || 'object').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + ':' + (position || 'center')
}

function bearingOffset(position) {
  if (position === 'left') return -35
  if (position === 'right') return 35
  return 0
}

function distanceCm(object, sensorDistanceCm) {
  if (Number.isFinite(Number(object?.sensorDistance))) return Number(object.sensorDistance)
  if (Number.isFinite(sensorDistanceCm)) return Number(sensorDistanceCm)
  if (object?.distance === 'near') return 35
  if (object?.distance === 'medium') return 100
  if (object?.distance === 'far') return 220
  return 100
}

export function createWorldModel() {
  const model = {
    x: 0,
    y: 0,
    heading: 0,
    path: [{ x: 0, y: 0 }],
    obstacles: new Map(),
    tracks: new Map(),
    lastUpdate: Date.now(),
    lastCommand: 'IDLE',
  }

  function moveForCommand(command, arg, dtMs) {
    const cmd = String(command || '').toUpperCase()
    const value = Number(arg)
    const scale = Number.isFinite(value) ? clamp(Math.abs(value) / 70, 0.35, 1.5) : 1
    const dt = clamp(Number(dtMs) || 0, 0, 1500)
    const step = DEFAULT_STEP_CM * scale * (dt / 600)

    if (cmd.includes('TURN_LEFT')) model.heading = normalizeHeading(model.heading - TURN_DEG * Math.min(1, Math.max(0.25, scale)))
    else if (cmd.includes('TURN_RIGHT')) model.heading = normalizeHeading(model.heading + TURN_DEG * Math.min(1, Math.max(0.25, scale)))
    else if (cmd.includes('FORWARD') || cmd.includes('WALK_FORWARD') || cmd.includes('FLY_FORWARD')) {
      const r = model.heading * Math.PI / 180
      model.x += Math.sin(r) * step
      model.y += Math.cos(r) * step
    } else if (cmd.includes('BACKWARD') || cmd.includes('WALK_BACKWARD') || cmd.includes('FLY_BACKWARD')) {
      const r = model.heading * Math.PI / 180
      model.x -= Math.sin(r) * step
      model.y -= Math.cos(r) * step
    }
  }

  function prune(now) {
    for (const [id, o] of model.obstacles) if (now - o.lastSeen > TRACK_TTL_MS) model.obstacles.delete(id)
    for (const [id, o] of model.tracks) if (now - o.lastSeen > TRACK_TTL_MS) model.tracks.delete(id)
    while (model.path.length > 700) model.path.shift()
    while (model.obstacles.size > MAX_TRACKS) model.obstacles.delete(model.obstacles.keys().next().value)
    while (model.tracks.size > MAX_TRACKS) model.tracks.delete(model.tracks.keys().next().value)
  }

  function updateMovement(command, arg, now = Date.now()) {
    const dt = now - model.lastUpdate
    moveForCommand(command, arg, dt)
    model.lastUpdate = now
    model.lastCommand = command || 'IDLE'
    const last = model.path[model.path.length - 1]
    if (!last || Math.hypot(model.x - last.x, model.y - last.y) >= 2) model.path.push({ x: model.x, y: model.y })
    prune(now)
  }

  function observe(vision, sensorDistanceCm, now = Date.now()) {
    if (!vision) return snapshot()
    const objects = Array.isArray(vision.objects) ? vision.objects : []
    const centerSensor = Number.isFinite(Number(sensorDistanceCm)) ? Number(sensorDistanceCm) : null

    objects.forEach((object, index) => {
      const label = object.label || 'object'
      const key = keyFor(label, object.position)
      let track = model.tracks.get(key)
      if (!track) {
        track = { id: label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + (index + 1), label, position: object.position || 'center', firstSeen: now }
        model.tracks.set(key, track)
      }
      const d = distanceCm(object, centerSensor)
      const angle = (model.heading + bearingOffset(object.position)) * Math.PI / 180
      track.x = model.x + Math.sin(angle) * d
      track.y = model.y + Math.cos(angle) * d
      track.position = object.position || 'center'
      track.distanceCm = Math.round(d * 10) / 10
      track.distance = object.distance || (d <= 50 ? 'near' : d <= 140 ? 'medium' : 'far')
      track.confidence = clamp(Number(object.confidence) || 0.5, 0, 1)
      track.lastSeen = now
      if (track.label.toLowerCase().includes('obstacle') || track.distance === 'near') {
        model.obstacles.set(track.id, { id: track.id, label: track.label, x: track.x, y: track.y, distanceCm: track.distanceCm, position: track.position, lastSeen: now })
      }
    })

    if (vision.fused?.blocked && centerSensor != null) {
      const angle = model.heading * Math.PI / 180
      const x = model.x + Math.sin(angle) * centerSensor
      const y = model.y + Math.cos(angle) * centerSensor
      const id = 'obstacle-front'
      model.obstacles.set(id, { id, label: 'sensor obstacle', x, y, distanceCm: centerSensor, position: 'center', lastSeen: now })
    }

    model.lastUpdate = now
    prune(now)
    return snapshot()
  }

  function snapshot() {
    const now = Date.now()
    prune(now)
    return {
      frame: 'local-2d',
      units: 'cm',
      origin: { x: 0, y: 0 },
      robot: { x: Math.round(model.x * 10) / 10, y: Math.round(model.y * 10) / 10, heading: Math.round(model.heading * 10) / 10 },
      path: model.path.map(p => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      obstacles: [...model.obstacles.values()].map(o => ({ ...o, ageMs: now - o.lastSeen })),
      objects: [...model.tracks.values()].map(o => ({ ...o, ageMs: now - o.lastSeen })),
      lastCommand: model.lastCommand,
      updatedAt: new Date(now).toISOString(),
    }
  }

  return { updateMovement, observe, snapshot }
}
