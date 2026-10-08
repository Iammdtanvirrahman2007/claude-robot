export function chooseExplorationRoute(world, planner, route) {
  const size = world.grid?.cellSizeCm || 20
  const robot = world.robot || { x: 0, y: 0, heading: 0 }
  const start = {
    x: Math.round(robot.x / size),
    y: Math.round(robot.y / size),
  }
  const blocked = new Set((world.grid?.cells || [])
    .filter(c => c.state === 'blocked')
    .map(c => c.x + ',' + c.y))
  const candidates = [
    { x: start.x + 1, y: start.y },
    { x: start.x, y: start.y + 1 },
    { x: start.x - 1, y: start.y },
    { x: start.x, y: start.y - 1 },
  ]
  const target = candidates.find(c => !blocked.has(c.x + ',' + c.y))
  if (!target) return { command: 'STOP', arg: 0, reason: 'no safe target' }
  const path = planner.plan(world.grid, start, target)
  if (!path.length) return { command: 'STOP', arg: 0, reason: 'no safe route' }
  route.setRoute(path, robot.heading || 0)
  return route.next(robot)
}
