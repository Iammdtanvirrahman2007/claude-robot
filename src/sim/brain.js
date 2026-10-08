export const INTENTS = Object.freeze({
  EXPLORE: 'EXPLORE',
  HOLD: 'HOLD',
})

export function decideSimulationIntent(state = {}) {
  if (Number(state.battery ?? 100) <= 8) {
    return { intent: INTENTS.HOLD, reason: 'critical battery' }
  }
  if (state.collision) {
    return { intent: INTENTS.HOLD, reason: 'collision state' }
  }
  return { intent: INTENTS.EXPLORE, reason: 'autonomous exploration' }
}
