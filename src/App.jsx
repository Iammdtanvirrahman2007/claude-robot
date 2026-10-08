import { useState } from 'react'
import { robotApi } from './api/robotApi.js'
import { codeFiles, filesKey } from './models/robot.js'
import ConnectScreen from './pages/ConnectScreen.jsx'
import Workspace from './pages/Workspace.jsx'

export default function App() {
  const [bots, setBots] = useState({})
  const [sel, setSel] = useState(null)
  const patch = (id, f) => setBots(b => (b[id] ? { ...b, [id]: f(b[id]) } : b))

  async function connect(params) {
    const cfg = await robotApi.connect(params)
    let files = codeFiles(cfg)
    try { files = JSON.parse(localStorage.getItem(filesKey(cfg))) || files } catch {}

    setBots(b => ({ ...b, [cfg.id]: {
      cfg, state: cfg.initialState || null, logs: [], exec: 'STOPPED', ai: null, files, unsubscribe: null
    }}))

    const unsubscribe = robotApi.subscribe(cfg.id, ev => patch(cfg.id, r =>
      ev.kind === 'telemetry' ? { ...r, state: ev.state }
        : ev.kind === 'log' ? { ...r, logs: [...r.logs.slice(-299), ev.line] }
        : ev.kind === 'ai' ? { ...r, ai: ev.decision }
        : { ...r, exec: ev.status }
    ))

    setBots(b => b[cfg.id] ? { ...b, [cfg.id]: { ...b[cfg.id], unsubscribe } } : b)
    setSel(cfg.id)
    return cfg
  }

  async function disconnect(id) {
    const bot = bots[id]
    bot?.unsubscribe?.()
    await robotApi.disconnect(id)
    setBots(b => { const n = { ...b }; delete n[id]; return n })
    setSel(cur => cur === id ? null : cur)
  }

  const list = Object.values(bots)
  const cur = bots[sel]
  const last = cur?.logs.at(-1)

  return (
    <div className="app">
      <header className="top">
        <b>ROBOT CONTROL PLATFORM</b>
        <span className="dim">Laptop = brain · ESP32 = body</span>
        <span className={'modeTag ' + robotApi.mode}>● {robotApi.mode === 'bridge' ? 'LOCAL BRIDGE' : robotApi.mode === 'cloud' ? 'FIRESTORE CLOUD' : 'SIMULATION'}</span>
        <span className={'pill ' + (list.length ? 'ok' : '')}>
          ● {list.length ? `${list.length} robot${list.length > 1 ? 's' : ''} connected` : 'No robot connected'}
        </span>
      </header>

      <aside className="side">
        <h4>ROBOTS</h4>
        {list.map(({ cfg, state, exec }) => (
          <button key={cfg.id} className={'rb' + (sel === cfg.id ? ' on' : '')} onClick={() => setSel(cfg.id)}>
            <i className={'dot' + (state?.connected ? ' ok' : '')} />
            <span><b>{cfg.id} · {cfg.label}</b>
              <small>{exec}{state?.battery != null ? ` · ${Math.round(state.battery)}%` : ''}</small>
            </span>
          </button>
        ))}
        {sel && cur && <button className="rb remove" onClick={() => disconnect(sel)}>Disconnect {cur.cfg.id}</button>}
        <button className="rb add" onClick={() => setSel(null)}>+ Add Robot</button>
      </aside>

      <main>
        {cur
          ? <Workspace key={cur.cfg.id} bot={cur} patch={f => patch(cur.cfg.id, f)} />
          : <ConnectScreen onConnect={connect} onOpen={setSel} />}
      </main>

      <footer className="stat">
        <span className={last?.level}>{last ? `[${last.t}] ${last.text}` : 'Ready — connect a robot to begin'}</span>
        <span style={{ marginLeft: 'auto' }}>
          {cur?.state ? `Link ${cur.state.link.latency} ms · RSSI ${cur.state.link.rssi} dBm · ` : ''}
          BRAIN: LAPTOP → ESP32
        </span>
      </footer>
    </div>
  )
}