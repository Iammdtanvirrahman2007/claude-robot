const key = (x, y) => x + ',' + y

const manhattan = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

export function createPathPlanner(options = {}) {
  const maxNodes = options.maxNodes ?? 4000

  function plan(mapSnapshot = {}, start = { x: 0, y: 0 }, goal) {
    const cells = new Map((mapSnapshot.cells || []).map(c => [key(c.x, c.y), c]))
    const blocked = new Set((mapSnapshot.blocked || []).map(c => key(c.x, c.y)))
    const s = { x: Math.round(start.x), y: Math.round(start.y) }
    const g = goal ? { x: Math.round(goal.x), y: Math.round(goal.y) } : null

    if (!g || blocked.has(key(g.x, g.y))) return []
    const open = [s]
    const came = new Map()
    const cost = new Map([[key(s.x, s.y), 0]])
    let expanded = 0

    const neighbors = n => [
      { x: n.x + 1, y: n.y },
      { x: n.x - 1, y: n.y },
      { x: n.x, y: n.y + 1 },
      { x: n.x, y: n.y - 1 },
    ]

    while (open.length && expanded++ < maxNodes) {
      open.sort((a, b) => (cost.get(key(a.x, a.y)) + manhattan(a, g)) - (cost.get(key(b.x, b.y)) + manhattan(b, g)))
      const current = open.shift()
      if (current.x === g.x && current.y === g.y) {
        const path = [current]
        let k = key(current.x, current.y)
        while (came.has(k)) {
          const p = came.get(k)
          path.push(p)
          k = key(p.x, p.y)
        }
        return path.reverse()
      }

      for (const n of neighbors(current)) {
        const nk = key(n.x, n.y)
        if (blocked.has(nk)) continue
        const terrain = cells.get(nk)
        const stepCost = terrain?.state === 'free' ? 1 : 1.5
        const nextCost = cost.get(key(current.x, current.y)) + stepCost
        if (!cost.has(nk) || nextCost < cost.get(nk)) {
          cost.set(nk, nextCost)
          came.set(nk, current)
          if (!open.some(p => p.x === n.x && p.y === n.y)) open.push(n)
        }
      }
    }
    return []
  }

  return { plan }
}
