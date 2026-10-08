const DEFAULTS = {
  obstacleCm: 28,
  emergencyCm: 10,
  stuckWindowMs: 2800,
  minProgressCm: 3,
  recoveryCooldownMs: 2200,
}

const n = v => Number.isFinite(Number(v)) ? Number(v) : Infinity

export function createAutonomyController(options = {}) {
  const cfg = { ...DEFAULTS, ...options }
  let last = null
  let stuckSince = 0
  let lastRecovery = 0
  let turnSide = 1

  function decide(state = {}) {
    const now = Date.now()
    const front = n(state.sensors?.front_distance ?? state.sensors?.obstacle)
    const battery = n(state.battery ?? state.sensors?.battery)
    const current = String(state.currentCommand || 'IDLE').toUpperCase()
    const moving = /FORWARD|BACKWARD|WALK_|FLY_/.test(current) && Number(state.speed) > 0
    const pose = state.camera?.world?.robot

    if (battery <= 8) return { command: 'STOP', arg: 0, reason: 'critical battery', priority: 100 }
    if (state.collision || state.camera?.world?.collision) return { command: 'STOP', arg: 0, reason: 'collision detected', priority: 100 }
    if (front <= cfg.emergencyCm) return { command: 'STOP', arg: 0, reason: 'emergency obstacle distance', priority: 100 }

    if (moving && pose && last) {
      const progress = Math.hypot(pose.x - last.x, pose.y - last.y)
      if (progress < cfg.minProgressCm) {
        if (!stuckSince) stuckSince = now
      } else {
        stuckSince = 0
      }
    } else if (!moving) {
      stuckSince = 0
    }

    if (stuckSince && now - stuckSince >= cfg.stuckWindowMs && now - lastRecovery >= cfg.recoveryCooldownMs) {
      lastRecovery = now
      stuckSince = 0
      turnSide *= -1
      return { command: turnSide > 0 ? 'TURN_RIGHT' : 'TURN_LEFT', arg: 90, reason: 'recovery: no movement progress' }
    }

    if (front <= cfg.obstacleCm) {
      turnSide *= -1
      return { command: turnSide > 0 ? 'TURN_RIGHT' : 'TURN_LEFT', arg: 90, reason: 'obstacle avoidance' }
    }

    if (current === 'STOP' || current === 'IDLE') return { command: 'FORWARD', arg: 45, reason: 'resume autonomous exploration' }
    return { command: 'FORWARD', arg: Math.max(25, Math.min(65, Number(state.speed) || 45)), reason: 'path clear' }
  }

  function observe(state) {
    const p = state?.camera?.world?.robot
    if (p) last = { x: Number(p.x) || 0, y: Number(p.y) || 0 }
    return decide(state)
  }

  return { decide, observe, reset: () => { last = null; stuckSince = 0 } }
}
