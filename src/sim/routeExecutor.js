const norm=d=>{let x=Number(d)||0;while(x>180)x-=360;while(x<=-180)x+=360;return x}
export function createSimulationRouteExecutor() {
  let route=[], index=0, heading=0
  const setRoute=(path=[],h=0)=>{route=path.map(p=>({...p}));index=0;heading=norm(h)}
  const next=()=>{
    if(index>=route.length-1)return {command:'STOP',arg:0,done:true,reason:'route complete'}
    const a=route[index],b=route[index+1],dx=Math.sign(b.x-a.x),dy=Math.sign(b.y-a.y)
    const targetHeading=dx>0?90:dx<0?-90:dy>0?0:180
    const delta=norm(targetHeading-heading)
    if(Math.abs(delta)>1){heading=norm(heading+delta);return {command:delta>0?'TURN_RIGHT':'TURN_LEFT',arg:Math.abs(delta),done:false,reason:'route alignment'}}
    index++
    return {command:'FORWARD',arg:40,done:false,reason:'route advance',target:b}
  }
  return {setRoute,next,status:()=>({active:index<Math.max(0,route.length-1),index,length:route.length,heading}),reset:()=>{route=[];index=0;heading=0}}
}
