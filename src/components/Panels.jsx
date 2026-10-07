import { useEffect, useRef, useState } from 'react'
import { robotApi } from '../api/robotApi.js'

const Card = ({ title, tag, cls = '', children }) => (
  <section className={'card ' + cls}><h3>{title}{tag != null && <small>{tag}</small>}</h3>{children}</section>
)
const pct = (v, a, b) => Math.max(0, Math.min(100, ((v - a) / (b - a)) * 100))

export function StatusCard({ cfg, state }) {
  return (
    <Card title={`${cfg.id} · ${cfg.label.toUpperCase()}`} tag={state.connected ? <span className="ok">● CONNECTED</span> : <span className="err">○ OFFLINE</span>} cls="head">
      <dl>
        <dt>Link</dt><dd>{cfg.ip}:{cfg.port} · Wi-Fi</dd>
        <dt>Command</dt><dd>{state.currentCommand}</dd>
        <dt>Speed</dt><dd>{Math.round(state.speed)}</dd>
        <dt>Power</dt><dd>{state.battery == null ? 'mains' : Math.round(state.battery) + '% battery'}</dd>
        <dt>Errors</dt><dd>{state.errors.length}</dd>
      </dl>
    </Card>
  )
}

export function SensorPanel({ cfg, state }) {
  return (
    <Card title={cfg.panels.sensors} tag="● LIVE · 1.7 Hz">
      {cfg.sensors.map(s => {
        const v = state.sensors[s.id]
        let val
        if (s.type === 'imu') val = <span className="vec">{['x', 'y', 'z'].map(k => <em key={k}>{k.toUpperCase()}<b key={v[k].toFixed(2)}>{v[k].toFixed(2)}</b></em>)}</span>
        else if (s.type === 'gps') { const t = `${v.lat.toFixed(5)}, ${v.lon.toFixed(5)}`; val = <b key={t}>{t}</b> }
        else { const t = v.toFixed(s.type === 'temperature' || s.type === 'torque' ? 1 : 0); val = <b key={t}>{t} <small>{s.unit}</small></b> }
        return (
          <div className="row" key={s.id}>
            <span>{s.name}</span>{val}
            {s.max != null && <i className="meter"><u style={{ width: pct(v, s.min, s.max) + '%' }} /></i>}
          </div>
        )
      })}
    </Card>
  )
}

export function CameraPanel({ cfg, state }) {
  const c = state.camera
  const [streaming, setStreaming] = useState(false)
  const [autoVision, setAutoVision] = useState(false)
  const [busy, setBusy] = useState(false)
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const canvasRef = useRef(null)
  const [vision, setVision] = useState(c?.vision || null)

  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), [])

  async function cameraOn() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      await videoRef.current.play()
      setStreaming(true)
    } catch (e) {
      setVision({ scene: 'Camera error: ' + e.message, objects: [], hazards: [] })
    }
  }

  function cameraOff() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setStreaming(false)
    setAutoVision(false)
  }

  async function analyze() {
    if (!videoRef.current?.videoWidth || busy) return
    setBusy(true)
    try {
      const canvas = canvasRef.current
      canvas.width = videoRef.current.videoWidth
      canvas.height = videoRef.current.videoHeight
      canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
      const image = canvas.toDataURL('image/jpeg', 0.55)
      const result = await robotApi.visionAnalyze(cfg.id, image)
      setVision(result)
    } catch (e) { setVision({ scene: e.message, objects: [], hazards: [] }) }
    finally { setBusy(false) }
  }

  useEffect(() => {
    if (!autoVision || !streaming) return
    const timer = setInterval(() => { analyze() }, 3500)
    return () => clearInterval(timer)
  }, [autoVision, streaming])

  return (
    <Card title="CAMERA + VISION" tag={<span className={streaming ? 'ok' : 'dim'}>● {streaming ? (autoVision ? 'LIVE · AUTO VISION' : 'LIVE') : (c?.status || 'STANDBY')}</span>}>
      <video ref={videoRef} muted playsInline style={{width:'100%',display:streaming?'block':'none',borderRadius:8}} />
      {!streaming && <div className="cam"><div className="scan" /><div className="box" /><span>CAM0 · READY</span></div>}
      <canvas ref={canvasRef} style={{display:'none'}} />
      <div className="kv">
        {!streaming ? <button onClick={cameraOn}>Enable Camera</button> : <button onClick={cameraOff}>Disable Camera</button>}
        <button onClick={analyze} disabled={!streaming || busy}>{busy ? 'Analyzing…' : '👁 Analyze Frame'}</button>
        <button onClick={() => setAutoVision(v => !v)} disabled={!streaming}>{autoVision ? '⏸ Auto Vision' : '▶ Auto Vision'}</button>
      </div>
      {vision && <div className="kv"><span>Scene <b>{vision.scene}</b></span><span>Objects <b>{(vision.objects||[]).map(o => o.label + (o.distance === 'near' ? ' ⚠' : '')).join(', ') || 'none'}</b></span><span>Path <b>{vision.path?.direction || 'unknown'}</b></span></div>}
      {vision?.hazards?.length > 0 && <div className="kv"><span>Hazards <b>{vision.hazards.join(' · ')}</b></span></div>}
      <div className="kv"><span>FPS <b>{c?.fps ?? 'browser'}</b></span><span>Resolution <b>{c?.res ?? '640×480'}</b></span><span>Status <b>{c?.status ?? 'ready'}</b></span></div>
    </Card>
  )
}


export function MapPanel({ cfg, state }) {
  const world = state.camera?.world
  const path = world?.path || []
  const obstacles = world?.obstacles || []
  const objects = world?.objects || []
  const robot = world?.robot || { x: 0, y: 0, heading: 0 }
  const points = [
    ...path,
    ...obstacles.map(o => ({ x: o.x, y: o.y })),
    ...objects.map(o => ({ x: o.x, y: o.y })),
    { x: robot.x, y: robot.y },
  ]
  const maxAbs = Math.max(120, ...points.map(p => Math.max(Math.abs(p.x), Math.abs(p.y))) + 60)
  const size = maxAbs * 2
  const sx = x => x + maxAbs
  const sy = y => maxAbs - y
  const poly = path.map(p => sx(p.x) + ',' + sy(p.y)).join(' ')
  const heading = (robot.heading - 0) * Math.PI / 180
  const hx = sx(robot.x) + Math.sin(heading) * 22
  const hy = sy(robot.y) - Math.cos(heading) * 22

  return (
    <Card title="WORLD MAP" tag={<span className="ok">● LIVE · 2D</span>}>
      <svg viewBox={'0 0 ' + size + ' ' + size} width="100%" style={{display:'block',background:'rgba(0,0,0,.18)',borderRadius:8}}>
        <defs><pattern id={'grid-' + cfg.id} width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="currentColor" opacity=".10" /></pattern></defs>
        <rect width="100%" height="100%" fill={'url(#grid-' + cfg.id + ')'} />
        {poly && <polyline points={poly} fill="none" stroke="currentColor" strokeWidth={2} opacity=".65" />}
        <circle cx={sx(0)} cy={sy(0)} r="4" fill="currentColor" opacity=".35" />
        {obstacles.map(o => <g key={o.id}><circle cx={sx(o.x)} cy={sy(o.y)} r={Math.max(5, Math.min(11, 10 - o.distanceCm / 30))} fill="currentColor" opacity=".9" /><text x={sx(o.x)+9} y={sy(o.y)-8} fontSize="10" fill="currentColor">{o.label}</text></g>)}
        {objects.filter(o => !obstacles.some(b => b.id === o.id)).map(o => <circle key={o.id} cx={sx(o.x)} cy={sy(o.y)} r="5" fill="currentColor" opacity=".55" />)}
        <g><circle cx={sx(robot.x)} cy={sy(robot.y)} r="9" fill="currentColor" /><line x1={sx(robot.x)} y1={sy(robot.y)} x2={hx} y2={hy} stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></g>
      </svg>
      <div className="kv">
        <span>Robot <b>{robot.x.toFixed(0)}, {robot.y.toFixed(0)} cm</b></span>
        <span>Heading <b>{robot.heading.toFixed(0)}°</b></span>
        <span>Obstacles <b>{obstacles.length}</b></span>
        <span>Objects <b>{objects.length}</b></span>
      </div>
      <small className="dim">Approximate local map from movement + distance/vision data. Odometry/IMU will improve accuracy.</small>
    </Card>
  )
}

export function ActuatorPanel({ cfg, state }) {
  return (
    <Card title={cfg.panels.actuators} tag={`${cfg.actuators.length} channels`}>
      {cfg.actuators.map(a => {
        const v = state.actuators[a.id]
        const w = a.type === 'motor' ? 50 + v / 2 : (v / (a.type === 'gripper' ? 100 : 180)) * 100
        return (
          <div className="act" key={a.id}>
            <span>{a.name}</span>
            <i className="meter"><u style={{ width: Math.max(0, Math.min(100, w)) + '%' }} /></i>
            <b>{Math.round(v)}{a.unit}</b>
          </div>
        )
      })}
    </Card>
  )
}

export function ControlPanel({ cfg, state, onCmd }) {
  useEffect(() => {
    if (!cfg.pad) return
    const map = { ArrowUp: 'forward', ArrowDown: 'backward', ArrowLeft: 'turn_left', ArrowRight: 'turn_right', ' ': 'stop' }
    const h = e => {
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return
      const c = cfg.controls.find(x => x.fn === map[e.key])
      if (c) { e.preventDefault(); onCmd(c.cmd, 70) }
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [cfg])

  return (
    <Card title="MANUAL CONTROL" tag={state.currentCommand}>
      <div className={'ctl' + (cfg.pad ? ' pad' : '')}>
        {cfg.controls.map(c => (
          <button key={c.fn} className={'btn' + (state.currentCommand === c.cmd ? ' on' : '') + (c.danger ? ' danger' : '')}
            style={c.pos ? { gridArea: c.pos } : undefined} onClick={() => onCmd(c.cmd, 70)}>{c.label}</button>
        ))}
      </div>
    </Card>
  )
}

export function ApiPanel({ cfg }) {
  return (
    <Card title={`${cfg.label.toUpperCase()} API`} tag="generated from hardware">
      {cfg.api.map(g => (
        <div className="api" key={g.title}><h5>{g.title}</h5>{g.fns.map(f => <code key={f}>robot.{f}()</code>)}</div>
      ))}
    </Card>
  )
}

export function CommsPanel({ cfg, state }) {
  const l = state.link
  return (
    <Card title="COMMUNICATION" tag={<span className="ok">● LINK UP</span>}>
      <div className="flow2">
        <b>LAPTOP</b>
        <div>
          <div className="lane"><span>COMMANDS →</span><i key={'t' + l.tx} /></div>
          <div className="lane rev"><span>← TELEMETRY</span><i key={'r' + l.rx} /></div>
        </div>
        <b>ESP32</b>
      </div>
      <div className="kv">
        <span>Latency <b>{l.latency} ms</b></span><span>RSSI <b>{l.rssi} dBm</b></span>
        <span>TX <b>{l.tx}</b></span><span>RX <b>{l.rx}</b></span><span>Wi-Fi / TCP <b>{cfg.ip}:{cfg.port}</b></span>
      </div>
    </Card>
  )
}