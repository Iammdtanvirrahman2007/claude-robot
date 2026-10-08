const key = (x, y) => x + ',' + y
const h = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y)

export function createSimulationPathPlanner() {
  const plan = (map, start, goal) => {
    const blocked = new Set((map?.cells || []).filter(c => c.state === 'blocked').map(c => key(c.x, c.y)))
    if (blocked.has(key(goal.x, goal.y))) return []
    const open = [start], cost = new Map([[key(start.x, start.y), 0]]), came = new Map()
    const neighbors = p => [{x:p.x+1,y:p.y},{x:p.x-1,y:p.y},{x:p.x,y:p.y+1},{x:p.x,y:p.y-1}]
    while (open.length) {
      open.sort((a,b) => cost.get(key(a.x,a.y))+h(a,goal)-cost.get(key(b.x,b.y))-h(b,goal))
      const cur = open.shift()
      if (cur.x === goal.x && cur.y === goal.y) {
        const out=[cur]; let k=key(cur.x,cur.y)
        while(came.has(k)){const p=came.get(k);out.push(p);k=key(p.x,p.y)}
        return out.reverse()
      }
      for(const n of neighbors(cur)){
        const nk=key(n.x,n.y); if(blocked.has(nk)) continue
        const nc=cost.get(key(cur.x,cur.y))+1
        if(!cost.has(nk)||nc<cost.get(nk)){cost.set(nk,nc);came.set(nk,cur);if(!open.some(p=>p.x===n.x&&p.y===n.y))open.push(n)}
      }
    }
    return []
  }
  return { plan }
}
