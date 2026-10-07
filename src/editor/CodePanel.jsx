import { useEffect, useMemo, useRef, useState } from 'react'
import { robotApi } from '../api/robotApi.js'
import { STATUS, filesKey } from '../models/robot.js'

// --- tiny C++-ish syntax highlighter (no dependencies, works offline) ---
const RX = /(\/\/.*$)|("(?:[^"\\]|\\.)*")|\b(while|if|else|for|return|void|int|float|bool|auto|const|true|false|break|continue)\b|\b(\d+(?:\.\d+)?)\b|\b(robot)\b|\b([A-Za-z_]\w*)(?=\()/gm
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const hl = src => esc(src).replace(RX, (m, c, s, k, n, r) => `<span class="${c ? 'c' : s ? 's' : k ? 'k' : n ? 'n' : r ? 'r' : 'f'}">${m}</span>`)

// brace-based re-indent
const fmt = s => {
  let d = 0
  return s.split('\n').map(l => {
    l = l.trim()
    const close = l.startsWith('}')
    if (close) d = Math.max(0, d - 1)
    const out = l ? '    '.repeat(d) + l : ''
    d += (l.match(/{/g) || []).length - (l.match(/}/g) || []).length + (close ? 1 : 0)
    return out
  }).join('\n')
}

// Transparent <textarea> over a highlighted <pre>; one scroll container keeps gutter, text and caret aligned.
function Editor({ value, onChange, onKey, bad }) {
  const html = useMemo(() => hl(value) + '\n', [value])
  const n = value.split('\n').length
  return (
    <div className="ed">
      <div className="gut">{Array.from({ length: n }, (_, i) => <div key={i} className={bad.has(i + 1) ? 'err' : ''}>{i + 1}</div>)}</div>
      <div className="src">
        <pre dangerouslySetInnerHTML={{ __html: html }} />
        <textarea value={value} wrap="off" spellCheck={false} onChange={e => onChange(e.target.value)} onKeyDown={onKey} />
      </div>
    </div>
  )
}

export default function CodePanel({ bot, patch }) {
  const { cfg, files, logs, exec } = bot
  const [tab, setTab] = useState(0)
  const [errs, setErrs] = useState([])
  const [saved, setSaved] = useState(false)
  const con = useRef(null)
  const code = files[tab].code
  const running = !['STOPPED', 'ERROR', 'BUILDING'].includes(exec)
  const busy = running || exec === 'BUILDING'
  const tone = exec === 'ERROR' ? 'err' : exec === 'BUILDING' ? 'warn' : exec === 'STOPPED' ? '' : 'ok'

  useEffect(() => { con.current.scrollTop = con.current.scrollHeight }, [logs.length])

  const edit = v => patch(r => ({ ...r, files: r.files.map((f, i) => (i === tab ? { ...f, code: v } : f)) }))
  const build = async () => {
    try {
      const res = await robotApi.build(cfg.id, files[0].code)
      setErrs(res.errors || [])
      return res.ok
    } catch (e) {
      setErrs([{ line: 1, msg: e.message || String(e) }])
      return false
    }
  }
  const run = async () => {
    if (busy) return
    if (!(await build())) return
    try {
      await robotApi.run(cfg.id)
    } catch (e) {
      setErrs([{ line: 1, msg: e.message || String(e) }])
    }
  }
  const save = () => { try { localStorage.setItem(filesKey(cfg), JSON.stringify(files)) } catch {} setSaved(true); setTimeout(() => setSaved(false), 1200) }

  const onKey = e => {
    const mod = e.ctrlKey || e.metaKey
    if (mod && e.key === 's') { e.preventDefault(); save() }
    else if (mod && e.key === 'Enter') { e.preventDefault(); run() }
    else if (mod && e.key === 'b') { e.preventDefault(); if (!busy) build() }
    else if (e.key === 'Escape') robotApi.stop(cfg.id)
    else if (e.key === 'Tab') {
      e.preventDefault()
      const t = e.target, s = t.selectionStart
      edit(t.value.slice(0, s) + '    ' + t.value.slice(t.selectionEnd))
      requestAnimationFrame(() => { t.selectionStart = t.selectionEnd = s + 4 })
    }
  }

  return (
    <section className="code">
      <div className="tabs">
        {files.map((f, i) => <button key={f.name} className={'tab' + (i === tab ? ' on' : '')} onClick={() => setTab(i)}>{f.name}</button>)}
        <small style={{ marginLeft: 'auto', paddingBottom: 6 }}>Executes on the LAPTOP — not on the ESP32</small>
      </div>
      <div className="tools">
        <button className="btn" onClick={build} disabled={busy} title="Ctrl+B">Build</button>
        <button className="btn pri" onClick={run} disabled={busy} title="Ctrl+Enter">▶ Run</button>
        <button className="btn danger" onClick={() => robotApi.stop(cfg.id)} disabled={!running} title="Esc">■ Stop</button>
        <button className="btn" onClick={() => edit(fmt(code))}>Format</button>
        <button className="btn" onClick={save} title="Ctrl+S">{saved ? 'Saved ✓' : 'Save'}</button>
        <button className="btn" onClick={() => patch(r => ({ ...r, logs: [] }))} title="Clear console">Clear</button>
        {errs.length > 0 && <span className="pill err" style={{ marginLeft: 0 }}>{errs.length} problem{errs.length > 1 ? 's' : ''}</span>}
        <span className="dim" style={{ marginLeft: 'auto' }}>{robotApi.mode === 'bridge' ? 'REAL TRANSPORT' : 'OFFLINE SIM'}</span>
        <span className={'pill ' + tone}>● {exec}</span>
      </div>
      <div className="steps">{STATUS.map(s => <span key={s} className={s === exec ? (s === 'ERROR' ? 'cur err' : 'cur') : ''}>● {s}</span>)}</div>
      <Editor value={code} onChange={edit} onKey={onKey} bad={new Set(tab === 0 ? errs.map(e => e.line) : [])} />
      {errs.map((e, i) => <div className="perr" key={i}>✖ Ln {e.line}: {e.msg}</div>)}
      <div className="console" ref={con}>
        {logs.length === 0 && <div className="dim">Console — press ▶ Run (Ctrl+Enter) to build and start the brain program.</div>}
        {logs.map((l, i) => <div key={i} className={l.level}><time>[{l.t}]</time> {l.text}</div>)}
      </div>
    </section>
  )
}
