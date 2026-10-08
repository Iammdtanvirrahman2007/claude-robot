import { useState } from 'react'
import { robotApi } from '../api/robotApi.js'

export default function ConnectScreen({ onConnect, onOpen }) {
  const profiles = robotApi.profiles()
  const [mode, setMode] = useState(robotApi.mode)
  const [bridge, setBridge] = useState(robotApi.getBridgeUrl())
  const [f, setF] = useState(profiles[0].defaults)
  const [busy, setBusy] = useState(false)
  const [discovering, setDiscovering] = useState(false)
  const [devices, setDevices] = useState([])
  const [scanInfo, setScanInfo] = useState(null)
  const [res, setRes] = useState(null)
  const [err, setErr] = useState('')

  const set = k => e => setF({ ...f, [k]: e.target.value })
  const pick = e => setF(profiles.find(p => p.type === e.target.value).defaults)

  const changeMode = e => {
    const next = e.target.value
    setMode(next)
    robotApi.setMode(next, bridge)
    setRes(null); setErr(''); setDevices([]); setScanInfo(null)
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

  async function openVirtualEnvironment() {
    const virtual = {
      id: 'VESP32-01',
      ip: '127.0.0.1',
      port: 5000,
      type: 'wheeled',
      mode: 'bridge',
    }
    try {
      setBusy(true); setErr(''); setRes(null)
      robotApi.setMode('bridge', bridge)
      setMode('bridge')
      const result = await onConnect(virtual)
      setRes(result)
      if (result) setTimeout(() => onOpen(result.id), 250)
    } catch (e) {
      setErr(e.message || 'Virtual ESP32 test failed. Start ./virtual-esp32 first.')
    } finally {
      setBusy(false)
    }
  }

  async function discover() {
    if (mode !== 'bridge') return
    setDiscovering(true); setErr('')
    try {
      const data = await robotApi.discover()
      setDevices(data.devices || [])
      setScanInfo({ subnet: data.subnet, method: data.method, count: (data.devices || []).length })
      if (!(data.devices || []).length) setErr('No visible LAN devices found. Make sure the laptop and ESP32 are on the same Wi-Fi.')
    } catch (e) {
      setErr(e.message || 'Discovery failed. Is the local bridge running?')
    } finally {
      setDiscovering(false)
    }
  }

  const connectFound = device => {
    const r = device.robot
    if (!r) return
    const type = profiles.some(p => p.type === r.type) ? r.type : profiles[0].type
    go([{ id: r.id, ip: r.ip, port: r.port, type }])
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

        {mode === 'bridge' && (
          <>
            <label>Bridge URL
              <input value={bridge} onChange={e => setBridge(e.target.value)}
                onBlur={() => robotApi.setMode('bridge', bridge)} />
            </label>

            <button type="button" className="discoverBtn" onClick={discover} disabled={discovering || busy}>
              <span className={discovering ? 'spin' : ''}>⌁</span>
              {discovering ? 'DISCOVERING…' : 'DISCOVER DEVICES'}
            </button>

            {devices.length > 0 && (
              <div className="discoverBox">
                <div className="discoverHead">
                  <b>ALL NETWORK DEVICES</b>
                  <span>{devices.length} found{scanInfo?.subnet ? ` · ${scanInfo.subnet}` : ''}</span>
                </div>
                <div className="deviceList">
                  {devices.map(d => (
                    <button type="button" key={d.ip} className={'device' + (d.kind === 'esp32' ? ' robot' : '')}
                      onClick={() => d.robot && connectFound(d)} disabled={busy || !d.robot}>
                      <span className="deviceIcon">{d.kind === 'esp32' ? '🤖' : '▣'}</span>
                      <span className="deviceInfo">
                        <b>{d.kind === 'esp32' ? (d.robot.name || d.robot.id) : d.name}</b>
                        <small>{d.ip}{d.mac ? ` · ${d.mac}` : ''}</small>
                        <small>{d.kind === 'esp32'
                          ? `ESP32 · ${d.robot.type} · TCP ${d.robot.port}`
                          : (d.services?.length ? d.services.map(s => `TCP:${s.port}`).join(' · ') : 'Network host')}</small>
                      </span>
                      {d.robot
                        ? <span className="deviceAction ok">CONNECT →</span>
                        : <span className="deviceAction dim">DEVICE</span>}
                    </button>
                  ))}
                </div>
                <small className="discoverNote">
                  {scanInfo?.method ? `Scan: ${scanInfo.method} · ` : ''}
                  ESP32 robots appear first when their discovery service replies.
                </small>
              </div>
            )}
          </>
        )}

        <label>Robot ID<input value={f.id} onChange={set('id')} /></label>
        <label>Robot Type
          <select value={f.type} onChange={pick}>
            {profiles.map(p => <option key={p.type} value={p.type}>{p.label.toUpperCase()}</option>)}
          </select>
        </label>
        <label>Connection<select><option>Wi-Fi / TCP</option></select></label>
        <label>IP Address<input value={f.ip} onChange={set('ip')} placeholder="192.168.1.101" /></label>
        <label>Port<input value={f.port} onChange={set('port')} inputMode="numeric" /></label>

        {err && <div className="cardError">✖ {err}</div>}
        <button type="button" className="btn pri" disabled={busy} onClick={openVirtualEnvironment}>
          {busy ? 'OPENING…' : '🤖 VIRTUAL ENVIRONMENT ROBOT TEST'}
        </button>
        <small className="dim">Runs the VESP32-01 rover from the virtual-esp-32 repository through the local bridge at 127.0.0.1:5000.</small>
        <button className="btn" disabled={busy}>{busy ? 'CONNECTING…' : 'CONNECT'}</button>
        <button type="button" className="btn" disabled={busy || mode === 'bridge'}
          onClick={() => go(profiles.map(p => p.defaults))}>Connect all 4 demo robots</button>
      </form>

      <section className="card">
        <h3>ARCHITECTURE</h3>
        <div className="node esp"><b>ROBOT BODY · ESP32</b><span>Wi-Fi discovery · firmware · sensors · motors · servos · camera</span></div>
        <div className="wire">▲ discovery + commands &nbsp; ▼ telemetry<br />LAN / Wi-Fi / TCP</div>
        <div className="node pc"><b>LAPTOP · ROBOT BRAIN</b><span>Discovery · C++ control logic · sensor processing · decisions</span></div>
        {mode === 'bridge' && <div className="bridgeHelp">
          Bridge: <b>{bridge}</b><br />Discover uses the laptop's LAN and the ESP32 UDP discovery protocol, then connects over TCP.
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
