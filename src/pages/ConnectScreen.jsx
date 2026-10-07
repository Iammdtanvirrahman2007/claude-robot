import { useState } from 'react'
import { robotApi } from '../api/robotApi.js'

export default function ConnectScreen({ onConnect, onOpen }) {
  const profiles = robotApi.profiles()
  const [mode, setMode] = useState(robotApi.mode)
  const [bridge, setBridge] = useState(robotApi.getBridgeUrl())
  const [f, setF] = useState(profiles[0].defaults)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  const set = k => e => setF({ ...f, [k]: e.target.value })
  const pick = e => setF(profiles.find(p => p.type === e.target.value).defaults)

  const changeMode = e => {
    const next = e.target.value
    setMode(next)
    robotApi.setMode(next, bridge)
    setRes(null); setErr('')
  }

  async function go(list) {
    setBusy(true); setRes(null); setErr('')
    try {
      let last
      for (const p of list) last = await onConnect({ ...p, port: Number(p.port), mode })
      setRes(last)
      if (last) setTimeout(() => onOpen(last.id), 250)
    } catch (e) {
      setErr(e.message || String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="connect">
      <form className="card" onSubmit={e => { e.preventDefault(); go([f]) }}>
        <h2>CONNECT ROBOT</h2>
        <small>{mode === 'bridge' ? 'Real mode · laptop bridge → ESP32' : 'Safe mode · built-in hardware simulation'}</small>

        <label>Backend mode
          <select value={mode} onChange={changeMode}>
            <option value="simulation">Simulation</option>
            <option value="bridge">Local Robot Bridge</option>
          </select>
        </label>

        {mode === 'bridge' && <label>Bridge URL
          <input value={bridge} onChange={e => setBridge(e.target.value)}
            onBlur={() => robotApi.setMode('bridge', bridge)} />
        </label>}

        <label>Robot ID<input value={f.id} onChange={set('id')} /></label>
        <label>Robot Type
          <select value={f.type} onChange={pick}>
            {profiles.map(p => <option key={p.type} value={p.type}>{p.label.toUpperCase()}</option>)}
          </select>
        </label>
        <label>Connection<select><option>Wi-Fi / TCP</option></select></label>
        <label>IP Address<input value={f.ip} onChange={set('ip')} placeholder="192.168.1.101" /></label>
        <label>Port<input value={f.port} onChange={set('port')} inputMode="numeric" />

        </label>

        {err && <div className="cardError">✖ {err}</div>}
        <button className="btn pri" disabled={busy}>{busy ? 'CONNECTING…' : 'CONNECT'}</button>
        <button type="button" className="btn" disabled={busy || mode === 'bridge'}
          onClick={() => go(profiles.map(p => p.defaults))}>Connect all 4 demo robots</button>
      </form>

      <section className="card">
        <h3>ARCHITECTURE</h3>
        <div className="node esp"><b>ROBOT BODY · ESP32</b><span>Firmware · sensors · motors · servos · camera</span></div>
        <div className="wire">▲ commands &nbsp; ▼ telemetry<br />Wi-Fi / TCP</div>
        <div className="node pc"><b>LAPTOP · ROBOT BRAIN</b><span>C++ control logic · sensor processing · decisions</span></div>
        {mode === 'bridge' && <div className="bridgeHelp">
          Bridge: <b>{bridge}</b><br />HTTP API + SSE telemetry · TCP uplink to the ESP32
        </div>}
        {(busy || res) && (
          <div className="result">
            {res ? <div className="ok">Connected ✓</div> : <div>Opening link…</div>}
            {res && <><div>Hardware profile: {res.type.toUpperCase()}</div><div>Sensors: {res.sensors.length} · Actuators: {res.actuators.length}</div></>}
          </div>
        )}
      </section>
    </div>
  )
}