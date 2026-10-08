const DIRS = [
  { x: 0, y: 1, heading: 0 },
  { x: 1, y: 0, heading: 90 },
  { x: 0, y: -1, heading: 180 },
  { x: -1, y: 0, heading: -90 },
]

const normalize = d => {
  let h = Number(d) || 0
  while (h > 180) h -= 360
  while (h <= -180) h += 360
  return h
}

const turnDelta = (from, to) => normalize(to - from)

export function createRouteExecutor(options = {}) {
  const forwardArg = options.forwardArg ?? 40
  let route = []
  let index = 0
  let heading = 0

  const setRoute = (path = [], currentHeading = 0) => {
    route = Array.isArray(path) ? path.map(p => ({ x: Number(p.x), y: Number(p.y) })) : []
    index = 0
    heading = normalize(currentHeading)
    return status()
  }

  const next = (robot = {}) => {
    if (index >= route.length - 1) {
      return { command: 'STOP', arg: 0, done: true, reason: 'route complete' }
    }

    const current = route[index]
    const target = route[index + 1]
    const dx = Math.sign(target.x - current.x)
    const dy = Math.sign(target.y - current.y)
    const dir = DIRS.find(d => d.x === dx && d.y === dy)
    if (!dir) {
      index++
      return { command: 'STOP', arg: 0, done: false, reason: 'invalid route segment' }
    }

    const delta = turnDelta(heading, dir.heading)
    if (Math.abs(delta) > 1) {
      heading = normalize(heading + delta)
      return {
        command: delta > 0 ? 'TURN_RIGHT' : 'TURN_LEFT',
        arg: Math.min(180, Math.abs(delta)),
        done: false,
        reason: 'align with planned route',
        target,
      }
    }

    index++
    return {
      command: 'FORWARD',
      arg: forwardArg,
      done: false,
      reason: 'advance along planned route',
      target,
    }
  }

  const status = () => ({
    active: index < Math.max(0, route.length - 1),
    index,
    length: route.length,
    heading,
    route: route.map(p => ({ ...p })),
  })

  const reset = () => {
    route = []
    index = 0
    heading = 0
  }

  return { setRoute, next, status, reset }
}
