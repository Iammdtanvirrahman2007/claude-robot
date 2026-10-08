export function createAutonomyController(options = {}) {
  const obstacleCm = options.obstacleCm ?? 28
  const emergencyCm = options.emergencyCm ?? 10
  const stuckWindowMs = options.stuckWindowMs ?? 2800
  let last = null, stuckSince = 0, side = 1

  const decide = (state = {}) => {
    const front = Number(state.sensors?.front_distance ?? Infinity)
    const battery = Number(state.battery ?? state.sensors?.battery ?? 100)
    const now = Date.now()
    const p = state.camera?.world?.robot

    if (battery <= 8) return { command: 'STOP', arg: 0, reason: 'critical battery' }
    if (front <= emergencyCm) return { command: 'STOP', arg: 0, reason: 'emergency obstacle distance' }

    if (p && last && Number(state.speed) > 0) {
      const progress = Math.hypot(p.x - last.x, p.y - last.y)
      if (progress < 3) {
        if (!stuckSince) stuckSince = now
        if (now - stuckSince >= stuckWindowMs) {
          side *= -1; stuckSince = 0
          return { command: side > 0 ? 'TURN_RIGHT' : 'TURN_LEFT', arg: 90, reason: 'recovery: no movement progress' }
        }
      } else stuckSince = 0
    }
    if (p) last = { x: p.x, y: p.y }

    if (front <= obstacleCm) {
      side *= -1
      return { command: side > 0 ? 'TURN_RIGHT' : 'TURN_LEFT', arg: 90, reason: 'obstacle avoidance' }
    }
    return { command: 'FORWARD', arg: 45, reason: 'path clear' }
  }

  return { decide, reset: () => { last = null; stuckSince = 0 } }
}
