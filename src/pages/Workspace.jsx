import { robotApi } from '../api/robotApi.js'
import { StatusCard, SensorPanel, CameraPanel, ActuatorPanel, ControlPanel, ApiPanel, CommsPanel } from '../components/Panels.jsx'
import CodePanel from '../editor/CodePanel.jsx'

// Everything rendered here is derived from bot.cfg (the hardware description) — no robot-type switches.
export default function Workspace({ bot, patch }) {
  const { cfg, state } = bot
  if (!state) return <div className="boot">Waiting for first telemetry frame from {cfg.id}…</div>
  return (
    <div className="ws">
      <div className="col">
        <StatusCard cfg={cfg} state={state} />
        <SensorPanel cfg={cfg} state={state} />
        {cfg.camera && <CameraPanel cfg={cfg} state={state} />}
        <ActuatorPanel cfg={cfg} state={state} />
      </div>
      <CodePanel bot={bot} patch={patch} />
      <div className="col">
        <ControlPanel cfg={cfg} state={state} onCmd={(c, a) => robotApi.sendCommand(cfg.id, c, a)} />
        <ApiPanel cfg={cfg} />
        <CommsPanel cfg={cfg} state={state} />
      </div>
    </div>
  )
}
