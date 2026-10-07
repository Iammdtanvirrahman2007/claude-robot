import { useState } from 'react'
import { robotApi } from '../api/robotApi.js'

export default function ConnectScreen({ onConnect, onOpen }) {
  const profiles = robotApi.profiles() // mock only: pick which firmware the simulated ESP32 is running
  const [f, setF] = useState(profiles[0].defaults)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const set = k => e => setF({ ...f, [k]: e.target.value })
  const pick = e => setF(profiles.find(p => p.type === e.target.value).defaults)

  async function go(list) {
    setBusy(true); setRes(null)
    let last
    for (const p of list) last = await onConnect({ ...p, port: Number(p.port) })
    setRes(last); setBusy(false)
    setTimeout(() => onOpen(last.id), 1400)
  }

  return (
    <div className="connect">
      <form className="card" onSubmit={e => { e.preventDefault(); go([f]) }}>
        <h2>CONNECT ROBOT</h2>
        <small>ESP32 device · its firmware reports the robot's own hardware</small>
        <label>Robot ID<input value={f.id} onChange={set('id')} /></label>
        <label>Robot Type (simulated firmware)
          <select value={f.type} onChange={pick}>{profiles.map(p => <option key={p.type} value={p.type}>{p.label.toUpperCase()}</option>)}</select>
        </label>
        <label>Connection<select><option>Wi-Fi</option></select></label>
        <label>IP Address<input value={f.ip} onChange={set('ip')} /></label>
        <label>Port<input value={f.port} onChange={set('port')} /></label>
        <button className="btn pri" disabled={busy}>{busy ? 'CONNECTING…' : 'CONNECT'}</button>
        <button type="button" className="btn" disabled={busy} onClick={() => go(profiles.map(p => p.defaults))}>Connect all 4 demo robots</button>
      </form>

      <section className="card">
        <h3>HOW IT WORKS</h3>
        <div className="node esp"><b>ROBOT BODY · ESP32</b><span>Robot-specific firmware · reads sensors · drives motors, servos, actuators</span></div>
        <div className="wire">▲ commands &nbsp; ▼ telemetry + hardware description<br />Wi-Fi / TCP</div>
        <div className="node pc"><b>THIS LAPTOP · ROBOT BRAIN</b><span>Sensor processing · your control program · decisions</span></div>
        {(busy || res) && (
          <div className="result">
            {res ? <div className="ok">Connected ✓</div> : <div>Opening link to ESP32…</div>}
            {res && <><div>Receiving robot configuration…</div><div>Sensors detected: {res.sensors.length}</div><div>Actuators detected: {res.actuators.length}</div></>}
          </div>
        )}
      </section>
    </div>
  )
}
