import { useEffect } from 'react'

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
  return (
    <Card title="CAMERA" tag={<span className="ok">● {c.status}</span>}>
      <div className="cam"><div className="scan" /><div className="box" /><span>LIVE · {cfg.id} · CAM0</span></div>
      <div className="kv"><span>FPS <b>{c.fps}</b></span><span>Resolution <b>{c.res}</b></span><span>Status <b>{c.status}</b></span></div>
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
  useEffect(() => { // wheeled robots: arrow keys + space
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
