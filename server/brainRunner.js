import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const stamp = () => new Date().toTimeString().slice(0, 8)

export async function buildBrain(code) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'claude-robot-brain-'))
  const userCode = path.join(dir, 'brain.cpp')
  const wrapper = path.join(dir, 'main.cpp')
  const headerSource = new URL('../brain/robot_runtime.hpp', import.meta.url)
  const headerText = await fs.readFile(headerSource, 'utf8')

  await fs.writeFile(userCode, String(code || ''), 'utf8')
  await fs.writeFile(path.join(dir, 'robot_runtime.hpp'), headerText, 'utf8')
  const wrapperText =
    '#include "robot_runtime.hpp"\n' +
    'Robot robot;\n\n' +
    'void brain_main() {\n' +
    '#include "brain.cpp"\n' +
    '}\n\n' +
    'int main() {\n' +
    '  brain_main();\n' +
    '  return 0;\n' +
    '}\n'
  await fs.writeFile(wrapper, wrapperText, 'utf8')

  const binary = path.join(dir, 'brain_runner')

  try {
    await exec('g++', ['-std=c++17', '-O2', '-pthread', wrapper, '-o', binary], {
      cwd: dir,
      timeout: 15000,
      maxBuffer: 4 * 1024 * 1024,
    })
    return { ok: true, binary, dir }
  } catch (e) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    const stderr = String(e.stderr || e.stdout || e.message || 'C++ compilation failed')
    const errors = []
    for (const line of stderr.split(/\r?\n/)) {
      const m = line.match(/brain\.cpp:(\d+)(?::(\d+))?:\s*(?:fatal\s+)?error:\s*(.*)$/)
      if (m) errors.push({ line: Number(m[1]), msg: m[3] })
      else if (line.includes('error:')) errors.push({ line: 1, msg: line.trim() })
    }
    if (!errors.length) {
      errors.push({
        line: 1,
        msg: stderr.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || 'C++ compilation failed',
      })
    }
    return { ok: false, errors, compilerOutput: stderr }
  }
}

export function startBrain({ binary, initialState, sendCommand, onLog, onExec, onExit }) {
  const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'] })

  let stdoutBuffer = ''
  let stderrBuffer = ''

  const emitLog = (text, level = 'info') => {
    onLog?.({ t: stamp(), level, text })
  }

  const handleStdoutLine = line => {
    const raw = line.trim()
    if (!raw) return

    try {
      const msg = JSON.parse(raw)
      if (msg.type === 'command' && msg.cmd) {
        sendCommand?.(String(msg.cmd), Number(msg.arg || 0))
      } else if (msg.type === 'log') {
        emitLog(String(msg.text || ''), msg.level || 'info')
      } else if (msg.type === 'exec') {
        onExec?.(String(msg.status || 'RUNNING'))
      } else {
        emitLog(raw, 'info')
      }
    } catch {
      emitLog(raw, 'info')
    }
  }

  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk.toString()
    let cut
    while ((cut = stdoutBuffer.indexOf('\n')) >= 0) {
      handleStdoutLine(stdoutBuffer.slice(0, cut))
      stdoutBuffer = stdoutBuffer.slice(cut + 1)
    }
  })

  child.stderr.on('data', chunk => {
    stderrBuffer += chunk.toString()
    let cut
    while ((cut = stderrBuffer.indexOf('\n')) >= 0) {
      const line = stderrBuffer.slice(0, cut).trim()
      stderrBuffer = stderrBuffer.slice(cut + 1)
      if (line) emitLog(line, 'error')
    }
  })

  child.on('error', err => {
    emitLog(`Brain process error: ${err.message}`, 'error')
    onExec?.('ERROR')
  })

  child.on('close', (code, signal) => {
    const tailOut = stdoutBuffer.trim()
    if (tailOut) handleStdoutLine(tailOut)

    const tailErr = stderrBuffer.trim()
    if (tailErr) emitLog(tailErr, 'error')

    onExec?.(code === 0 ? 'STOPPED' : 'ERROR')
    onExit?.(code, signal)
  })

  if (initialState) {
    try { child.stdin.write(JSON.stringify(initialState) + '\n') } catch {}
  }

  onExec?.('RUNNING')
  emitLog('Native C++ brain started', 'ok')

  return {
    child,
    feed(state) {
      if (!child.stdin.destroyed) {
        try { child.stdin.write(JSON.stringify(state) + '\n') } catch {}
      }
    },
    stop() {
      if (child.killed || child.exitCode !== null) return
      child.kill('SIGTERM')
      setTimeout(() => {
        if (child.exitCode === null) child.kill('SIGKILL')
      }, 1200)
    },
  }
}
