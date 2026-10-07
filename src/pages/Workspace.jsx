import { useEffect, useState } from 'react'
import { robotApi } from '../api/robotApi.js'
import { StatusCard, SensorPanel, CameraPanel, MapPanel, ActuatorPanel, ControlPanel, ApiPanel, CommsPanel } from '../components/Panels.jsx'
import CodePanel from '../editor/CodePanel.jsx'

function AIBrainPanel({ bot, patch }) {
  const [personality, setPersonality] = useState('default')
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('AI idle')

  useEffect(() => {
    let live = true
    robotApi.aiStatus(bot.cfg.id).then(s => {
      if (live) setRunning(Boolean(s.running))
    }).catch(() => {})
    return () => { live = false }
  }, [bot.cfg.id])

  async function decide() {
    setBusy(true)
    try {
      const d = await robotApi.aiDecide(bot.cfg.id, personality, true)
      patch(r => ({ ...r, ai: d }))
      setMessage(d.reason || 'Decision made')
    } catch (e) { setMessage(e.message) }
    finally { setBusy(false) }
  }

  async function toggle() {
    setBusy(true)
    try {
      if (running) {
        await robotApi.aiStop(bot.cfg.id)
        setRunning(false)
        setMessage('AI stopped')
      } else {
        await robotApi.aiStart(bot.cfg.id, personality, 2500)
        setRunning(true)
        setMessage('AI brain running every 2.5 s')
      }
    } catch (e) { setMessage(e.message) }
    finally { setBusy(false) }
  }

  const d = bot.ai
  return (
    <section className="panel">
      <div className="panelHead"><b>AI BRAIN</b><span className={running ? 'ok' : 'dim'}>● {running ? 'ACTIVE' : 'STANDBY'}</span></div>
      <div style={{display:'grid',gap:8}}>
        <select value={personality} onChange={e => setPersonality(e.target.value)} disabled={busy || running}>
          <option value="default">Default</option>
          <option value="explorer">Explorer</option>
          <option value="guardian">Guardian</option>
          <option value="companion">Companion</option>
        </select>
        <div style={{display:'flex',gap:8}}>
          <button onClick={toggle} disabled={busy}>{running ? '■ Stop AI' : '▶ Start AI'}</button>
          <button onClick={decide} disabled={busy || running}>🧠 Decide Now</button>
        </div>
        <small className="dim">{message}</small>
        {d && <div className="dim">Last: <b>{d.function}</b> · {d.source} · {d.reason}</div>}
      </div>
    </section>
  )
}

export default function Workspace({ bot, patch }) {
  const { cfg, state } = bot
  if (!state) return <div className="boot">Waiting for first telemetry frame from {cfg.id}…</div>
  return (
    <div className="ws">
      <div className="col">
        <StatusCard cfg={cfg} state={state} />
        <SensorPanel cfg={cfg} state={state} />
        {cfg.camera && <CameraPanel cfg={cfg} state={state} />}
        <MapPanel cfg={cfg} state={state} />
        <ActuatorPanel cfg={cfg} state={state} />
      </div>
      <CodePanel bot={bot} patch={patch} />
      <div className="col">
        <AIBrainPanel bot={bot} patch={patch} />
        <ControlPanel cfg={cfg} state={state} onCmd={(c, a) => robotApi.sendCommand(cfg.id, c, a)} />
        <ApiPanel cfg={cfg} />
        <CommsPanel cfg={cfg} state={state} />
      </div>
    </div>
  )
}
