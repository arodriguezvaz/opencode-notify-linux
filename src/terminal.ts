import { spawn } from "node:child_process"
import { statSync } from "node:fs"
import { opencodeExecutable, terminalAttempts } from "./lib.ts"

const SPAWN_GRACE_MS = 250

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function spawnDetached(command: string, args: string[], cwd?: string): Promise<boolean> {
  return new Promise((resolveSpawn) => {
    let settled = false
    const finish = (value: boolean) => {
      if (settled) return
      settled = true
      resolveSpawn(value)
    }
    try {
      const child = spawn(command, args, { cwd, detached: true, stdio: "ignore" })
      child.once("error", () => finish(false))
      child.once("spawn", () => {
        // A terminal that rejects its arguments exits immediately. Give it a
        // moment before treating the launch as successful (daemonizing
        // terminals such as gnome-terminal exit 0 right away).
        const timer = setTimeout(() => {
          child.unref()
          finish(true)
        }, SPAWN_GRACE_MS)
        child.once("exit", (code) => {
          clearTimeout(timer)
          finish(code === 0)
        })
      })
    } catch {
      finish(false)
    }
  })
}

/**
 * Recreate the window that hosted a session. When a TUI closes, the background
 * service keeps running the turn, so its next notification has no window to
 * focus. Open the session in a fresh terminal in its project instead of
 * switching the TUI that happens to be in front.
 */
export async function openInNewWindow(
  sessionID: string,
  directory?: string,
  fallbackDirectory?: string,
): Promise<boolean> {
  const cwd = directory && isDirectory(directory) ? directory : fallbackDirectory
  const command = [opencodeExecutable(process.execPath), "--session", sessionID, ...(cwd ? [cwd] : [])]
  for (const [program, args] of terminalAttempts(command, cwd, process.env.TERMINAL)) {
    if (await spawnDetached(program, args, cwd)) return true
  }
  return false
}
