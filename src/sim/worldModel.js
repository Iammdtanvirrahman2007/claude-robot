const CELL_CM = 20
const STEP_CM = 12
const TTL = 9000
const MAX = 160

const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const normalize = d => { let h=Number(d)||0; while(h>180)h-=360; while(h<=-180)h+=360; return h }
const key=(x,y)=>x+','+y
const dirVector=h=>{const r=h*Math.PI/180;return {x:Math.sin(r),y:Math.cos(r)}}

export function createSimulationWorld(options={}) {
  const walls = options.walls || [
    {x1:-100,y1:-100,x2:100,y2:-100},
    {x1:100,y1:-100,x2:100,y2:100},
    {x1:100,y1:100,x2:-100,y2:100},
    {x1:-100,y1:100,x2:-100,y2:-100},
  ]
  const fixtures = options.obstacles || [
    {id:'box-1',x:0,y:55,r:12,label:'crate'},
    {id:'box-2',x:45,y:20,r:12,label:'barrier'},
    {id:'box-3',x:-45,y:-25,r:12,label:'pillar'},
  ]

  const model={x:0,y:0,heading:0,path:[{x:0,y:0}],obstacles:new Map(),objects:new Map(),lastCommand:'IDLE',lastTurnCommand:null,lastUpdate:Date.now(),cells:new Map(),visits:new Map(),collision:false}

  const rayDistance=(max=120)=>{
    const v=dirVector(model.heading); let best=max
    for(let d=2;d<=max;d+=2){
      const px=model.x+v.x*d,py=model.y+v.y*d
      const hitWall=walls.some(w=>pointSegmentDistance(px,py,w)<=2)
      const hitObj=fixtures.some(o=>Math.hypot(px-o.x,py-o.y)<=o.r)
      if(hitWall||hitObj){best=d;break}
    }
    return best
  }
  const pointSegmentDistance=(px,py,w)=>{
    const dx=w.x2-w.x1,dy=w.y2-w.y1, len2=dx*dx+dy*dy
    const t=len2?clamp(((px-w.x1)*dx+(py-w.y1)*dy)/len2,0,1):0
    return Math.hypot(px-(w.x1+t*dx),py-(w.y1+t*dy))
  }

  const move=(command,arg,dt)=>{
    const cmd=String(command||'').toUpperCase(),value=Number(arg)
    if(cmd==='TURN_LEFT'||cmd==='TURN_RIGHT'){
      if(model.lastTurnCommand!==cmd)model.heading=normalize(model.heading+(cmd==='TURN_LEFT'?-1:1)*(Number.isFinite(value)?clamp(Math.abs(value),15,180):90))
      model.lastTurnCommand=cmd; return
    }
    model.lastTurnCommand=null
    if(!/FORWARD|BACKWARD/.test(cmd))return
    const sign=/BACKWARD/.test(cmd)?-1:1
    const scale=Number.isFinite(value)?clamp(Math.abs(value)/70,.35,1.5):1
    const step=STEP_CM*scale*clamp(Number(dt)||0,0,1500)/600
    const v=dirVector(model.heading), nx=model.x+v.x*step*sign, ny=model.y+v.y*step*sign
    const collision=fixtures.some(o=>Math.hypot(nx-o.x,ny-o.y)<=o.r+4)||walls.some(w=>pointSegmentDistance(nx,ny,w)<=4)
    if(collision){model.collision=true;model.lastCommand='COLLISION_STOP';return}
    model.x=nx;model.y=ny
  }

  const observe=(distanceCm,now=Date.now())=>{
    const rc={x:Math.round(model.x/CELL_CM),y:Math.round(model.y/CELL_CM)},rk=key(rc.x,rc.y)
    const c=model.cells.get(rk)||{x:rc.x,y:rc.y,state:'free',confidence:1}
    c.lastSeen=now;c.visits=(model.visits.get(rk)||0)+1;model.cells.set(rk,c);model.visits.set(rk,c.visits)
    const d=Number(distanceCm)
    if(Number.isFinite(d)&&d<120){const v=dirVector(model.heading),x=model.x+v.x*d,y=model.y+v.y*d,oc={x:Math.round(x/CELL_CM),y:Math.round(y/CELL_CM)}
      model.obstacles.set('sim-front',{id:'sim-front',label:'simulated obstacle',x,y,distanceCm:d,position:'center',lastSeen:now})
      model.cells.set(key(oc.x,oc.y),{x:oc.x,y:oc.y,state:'blocked',confidence:.9,lastSeen:now,visits:model.visits.get(key(oc.x,oc.y))||0})
    }
    for(const o of fixtures){if(Math.hypot(o.x-model.x,o.y-model.y)<130)model.objects.set(o.id,{...o,lastSeen:now})}
    for(const [id,o] of model.obstacles)if(now-o.lastSeen>TTL)model.obstacles.delete(id)
    while(model.path.length>700)model.path.shift()
    while(model.obstacles.size>MAX)model.obstacles.delete(model.obstacles.keys().next().value)
  }

  const update=(command,arg,sensorDistance,now=Date.now())=>{
    model.collision=false;move(command,arg,now-model.lastUpdate);model.lastUpdate=now
    const sensed=rayDistance()
    observe(Math.min(Number(sensorDistance)||Infinity,sensed),now)
    const last=model.path.at(-1);if(!last||Math.hypot(model.x-last.x,model.y-last.y)>=2)model.path.push({x:model.x,y:model.y})
  }
  const snapshot=()=>({frame:'local-2d',units:'cm',origin:{x:0,y:0},robot:{x:+model.x.toFixed(1),y:+model.y.toFixed(1),heading:+model.heading.toFixed(1)},path:model.path.map(p=>({x:+p.x.toFixed(1),y:+p.y.toFixed(1)})),obstacles:[...model.obstacles.values()],objects:[...model.objects.values()],grid:{cellSizeCm:CELL_CM,cells:[...model.cells.values()]},collision:model.collision,frontDistance:rayDistance(),lastCommand:model.lastCommand,updatedAt:new Date().toISOString()})
  return {update,snapshot,reset:()=>{model.x=0;model.y=0;model.heading=0;model.path=[{x:0,y:0}];model.obstacles.clear();model.objects.clear();model.cells.clear();model.visits.clear()}}
}
