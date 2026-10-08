import test from 'node:test'
import assert from 'node:assert/strict'
import { createSimulationWorld } from '../src/sim/worldModel.js'

test('virtual world reports deterministic front obstacle distance', () => {
  const w = createSimulationWorld({ obstacles: [{ id:'wall', x:0, y:50, r:5 }] })
  w.update('IDLE', 0, Infinity, Date.now())
  assert.ok(w.snapshot().frontDistance < 50)
})

test('virtual world prevents collision and records collision state', () => {
  const w = createSimulationWorld({ obstacles: [{ id:'wall', x:0, y:15, r:8 }] })
  const now=Date.now()
  w.update('FORWARD',70,20,now+600)
  const s=w.snapshot()
  assert.equal(s.collision,true)
  assert.equal(s.robot.x,0)
  assert.equal(s.robot.y,0)
})

test('virtual world exposes explored grid and objects', () => {
  const w=createSimulationWorld({ obstacles:[{id:'crate',x:20,y:30,r:4,label:'crate'}] })
  w.update('IDLE',0,30,Date.now())
  const s=w.snapshot()
  assert.ok(s.grid.cells.some(c=>c.state==='free'))
  assert.ok(s.objects.some(o=>o.id==='crate'))
})


test('simulation loop advances pose and grows path without collision', () => {
  const w=createSimulationWorld()
  const start=w.snapshot()
  const now=Date.now()
  for(let i=1;i<=4;i++) w.update('FORWARD',40,120,now+i*500)
  const end=w.snapshot()
  assert.equal(end.collision,false)
  assert.ok(end.path.length>start.path.length)
  assert.ok(end.grid.cells.length>=start.grid.cells.length)
})
