import fs from 'node:fs/promises'
import path from 'node:path'

const MODEL = process.env.ROBOT_AI_MODEL || 'gpt-6-luna'
const MEMORY_ROOT = path.resolve(process.env.ROBOT_MEMORY_DIR || '.robot-memory')
const loops = new Map()
const sleep = ms => new Promise(r => setTimeout(r, ms))

const PERSONALITIES = {
  default: { curiosity: 0.7, caution: 0.8, obedience: 0.9, playfulness: 0.3, confidence: 0.7 },
  explorer: { curiosity: 0.95, caution: 0.55, obedience: 0.85, playfulness: 0.55, confidence: 0.8 },
  guardian: { curiosity: 0.45, caution: 0.98, obedience: 0.95, playfulness: 0.1, confidence: 0.65 },
  companion: { curiosity: 0.7, caution: 0.8, obedience: 0.98, playfulness: 0.75, confidence: 0.75 },
}
const COMMANDS = { forward:'FORWARD', backward:'BACKWARD', walk_forward:'WALK_FORWARD', walk_backward:'WALK_BACKWARD', turn_left:'TURN_LEFT', turn_right:'TURN_RIGHT', stand:'STAND', sit:'SIT', takeoff:'TAKEOFF', land:'LAND', fly_forward:'FLY_FORWARD', fly_backward:'FLY_BACKWARD', increase_altitude:'INCREASE_ALTITUDE', decrease_altitude:'DECREASE_ALTITUDE', home_arm:'HOME', pick_part:'PICK_PART', place_part:'PLACE_PART', open_gripper:'OPEN_GRIPPER', close_gripper:'CLOSE_GRIPPER', conveyor_start:'CONVEYOR_START', conveyor_stop:'CONVEYOR_STOP', emergency_stop:'EMERGENCY_STOP', stop:'STOP' }

const readMemory = async id => {
  await fs.mkdir(MEMORY_ROOT, { recursive: true })
  const file = path.join(MEMORY_ROOT, encodeURIComponent(id) + '.json')
  try { return { file, data: JSON.parse(await fs.readFile(file, 'utf8')) } }
  catch { return { file, data: { observations: [], actions: [], preferences: {} } } }
}
const writeMemory = async (file, data) => { data.observations=data.observations.slice(-80); data.actions=data.actions.slice(-120); await fs.writeFile(file, JSON.stringify(data,null,2),'utf8') }

function instinct(state, robot) {
  const battery=Number(state?.battery ?? state?.sensors?.battery ?? 100)
  const front=Number(state?.sensors?.front_distance ?? Infinity)
  const obstacle=Number(state?.sensors?.obstacle ?? Infinity)
  const altitude=Number(state?.sensors?.altitude ?? 0)
  if (battery <= 8) return { function:'stop', arg:0, reason:'Safety instinct: critically low battery' }
  if (!state?.connected) return { function:'stop', arg:0, reason:'Safety instinct: communication lost' }
  if (front <= 8 || obstacle <= 1.2) return { function:'stop', arg:0, reason:'Safety instinct: immediate obstacle hazard' }
  if (robot?.type === 'bird' && altitude < 1 && /FLY|TAKEOFF/.test(state.currentCommand || '') && battery < 15) return { function:'land', arg:0, reason:'Safety instinct: low battery during flight' }
  return null
}
function availableFunctions(robot) { return (robot?.api || []).flatMap(g=>g.fns).filter(fn=>COMMANDS[fn]) }
function fallbackAction(robot) { const fns=new Set(availableFunctions(robot)); if(fns.has('forward')) return {function:'forward',arg:35,reason:'Fallback: continue basic movement'}; if(fns.has('walk_forward')) return {function:'walk_forward',arg:30,reason:'Fallback: continue basic gait'}; if(fns.has('stand')) return {function:'stand',arg:0,reason:'Fallback: hold stable posture'}; return {function:'stop',arg:0,reason:'Fallback: no safe action available'} }

function promptFor(robot,state,memory,personality) {
  return ['You are the decision layer of a physical robot.','Choose exactly ONE pre-built robot function. Never invent a function and never output raw GPIO, motor, servo, shell, or code commands.','Hard safety rules are handled outside you. Prefer safe, reversible actions.',
    'Robot type: '+robot.type+'. Available functions: '+availableFunctions(robot).join(', '),
    'Personality: '+JSON.stringify(personality),
    'Current state: '+JSON.stringify({connected:state?.connected,battery:state?.battery,command:state?.currentCommand,speed:state?.speed,sensors:state?.sensors,camera:state?.camera}),
    'Recent memory: '+JSON.stringify({observations:memory.observations.slice(-12),actions:memory.actions.slice(-12),preferences:memory.preferences}),
    'Return ONLY valid JSON: {"function":"one_available_function","arg":0-100,"reason":"short reason"}'].join('\n')
}

async function askAI({robot,state,memory,personality}) {
  const key=process.env.OPENAI_API_KEY
  if(!key) throw new Error('OPENAI_API_KEY is not configured')
  const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+key},body:JSON.stringify({model:MODEL,input:promptFor(robot,state,memory,personality),max_output_tokens:180})})
  const body=await response.json().catch(()=>({}))
  if(!response.ok) throw new Error(body?.error?.message || 'AI API HTTP '+response.status)
  const text=body.output_text || (body.output||[]).flatMap(x=>x.content||[]).map(x=>x.text||'').join('') || ''
  let parsed; try { parsed=JSON.parse(text) } catch { const m=text.match(/\{[\s\S]*\}/); parsed=m?JSON.parse(m[0]):null }
  if(!parsed?.function) throw new Error('AI returned no valid function')
  const allowed=new Set(availableFunctions(robot)); if(!allowed.has(parsed.function)) throw new Error('AI selected unavailable function: '+parsed.function)
  return {function:parsed.function,arg:Math.max(0,Math.min(100,Number(parsed.arg)||0)),reason:String(parsed.reason||'AI decision')}
}

export async function decide({robot,state,personality='default'}) {
  const {file,data}=await readMemory(robot.id)
  const profile=typeof personality==='string'?(PERSONALITIES[personality]||PERSONALITIES.default):personality
  const safe=instinct(state,robot)
  if(safe){data.actions.push({at:Date.now(),source:'instinct',...safe});await writeMemory(file,data);return {...safe,source:'instinct',personality:profile}}
  let decision
  try { decision=await askAI({robot,state,memory:data,personality:profile}); decision.source='ai' }
  catch(e){ decision=fallbackAction(robot); decision.source='fallback'; decision.error=e.message }
  data.actions.push({at:Date.now(),source:decision.source,function:decision.function,arg:decision.arg,reason:decision.reason})
  data.observations.push({at:Date.now(),battery:state?.battery,command:state?.currentCommand,sensors:state?.sensors})
  await writeMemory(file,data)
  return {...decision,personality:profile}
}

export async function startAIBrain({robot,getState,sendCommand,personality='default',interval=2500,onDecision,onError}) {
  if(loops.has(robot.id)) return {ok:true,alreadyRunning:true}
  const loop={stop:false}; loops.set(robot.id,loop)
  const run=async()=>{ while(!loop.stop){ try { const state=getState(); const decision=await decide({robot,state,personality}); if(!loop.stop&&state?.connected!==false){ sendCommand(commandForFunction(decision.function),decision.arg); onDecision?.(decision) } } catch(e){ onError?.(e) } await sleep(interval) } }
  run().catch(onError); return {ok:true,alreadyRunning:false}
}
export function stopAIBrain(id){const loop=loops.get(id);if(!loop)return false;loop.stop=true;loops.delete(id);return true}
export function aiBrainRunning(id){return loops.has(id)}
export function commandForFunction(fn){return COMMANDS[fn] || null}
export const personalityProfiles=Object.keys(PERSONALITIES)