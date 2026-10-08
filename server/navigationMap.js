import { createPathPlanner } from './pathPlanner.js'
const CELL = 20
const MAX_CELLS = 6000
const DIRS = [
  { name: 'N', dx: 0, dy: 1, command: 'FORWARD' },
  { name: 'E', dx: 1, dy: 0, command: 'TURN_RIGHT' },
  { name: 'S', dx: 0, dy: -1, command: 'BACKWARD' },
  { name: 'W', dx: -1, dy: 0, command: 'TURN_LEFT' },
]

const key = (x, y) => x + ',' + y
const cellOf = (x, y) => ({ x: Math.round(x / CELL), y: Math.round(y / CELL) })

export function createNavigationMap(options = {}) {
  const cellSize = options.cellSizeCm ?? CELL
  const cells = new Map()
  const visits = new Map()
  const blocked = new Set()
  const planner = createPathPlanner({ maxNodes: 5000 })

  const mark = (x, y, type = 'free', confidence = 0.5) => {
    const c = cellOf(x, y), k = key(c.x, c.y)
    const old = cells.get(k) || { x: c.x, y: c.y, state: 'unknown', confidence: 0, visits: 0 }
    old.state = type
    old.confidence = Math.max(old.confidence, Math.min(1, Number(confidence) || 0))
    old.lastSeen = Date.now()
    cells.set(k, old)
    if (cells.size > MAX_CELLS) cells.delete(cells.keys().next().value)
    return old
  }

  const observe = (world = {}) => {
    const robot = world.robot || { x: 0, y: 0 }
    mark(robot.x, robot.y, 'free', 1)
    const rc = cellOf(robot.x, robot.y)
    const rk = key(rc.x, rc.y)
    visits.set(rk, (visits.get(rk) || 0) + 1)

    for (const o of world.obstacles || []) {
      if (Number.isFinite(Number(o.x)) && Number.isFinite(Number(o.y))) {
        const c = mark(o.x, o.y, 'blocked', Number(o.confidence ?? 0.8))
        blocked.add(key(c.x, c.y))
      }
    }
    return snapshot()
  }

  const neighbors = c => DIRS.map(d => ({ ...d, x: c.x + d.dx, y: c.y + d.dy }))

  const chooseTarget = (world = {}) => {
    const r = cellOf(world.robot?.x || 0, world.robot?.y || 0)
    const candidates = neighbors(r)
      .filter(c => !blocked.has(key(c.x, c.y)))
      .map(c => ({ ...c, visits: visits.get(key(c.x, c.y)) || 0, known: cells.get(key(c.x, c.y))?.state === 'free' }))
      .sort((a, b) => (a.visits - b.visits) || (Number(a.known) - Number(b.known)))
    return candidates[0] || null
  }

  const plan = (world = {}) => {
    const target = chooseTarget(world)
    if (!target) return { command: 'STOP', arg: 0, reason: 'navigation: no safe neighboring cell', path: [] }
    const route = planner.plan(snapshot(), cellOf(world.robot?.x || 0, world.robot?.y || 0), { x: target.x, y: target.y })
    const r = cellOf(world.robot?.x || 0, world.robot?.y || 0)
    if (target.x === r.x && target.y === r.y + 1) return { command: 'FORWARD', arg: 40, reason: 'navigation: route to unexplored north cell', path: route }
    if (target.x === r.x && target.y === r.y - 1) return { command: 'BACKWARD', arg: 30, reason: 'navigation: route to unexplored south cell', path: route }
    if (target.x > r.x) return { command: 'TURN_RIGHT', arg: 90, reason: 'navigation: route to explore east', path: route }
    return { command: 'TURN_LEFT', arg: 90, reason: 'navigation: route to explore west', path: route }
  }

  const snapshot = () => ({
    cellSizeCm: cellSize,
    cells: [...cells.values()].map(c => ({ ...c, visits: visits.get(key(c.x, c.y)) || 0 })),
    blocked: [...blocked].map(k => {
      const [x, y] = k.split(',').map(Number)
      return { x, y }
    }),
  })

  return { observe, chooseTarget, plan, snapshot, reset: () => { cells.clear(); visits.clear(); blocked.clear() } }
}
