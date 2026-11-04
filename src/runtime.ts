import {
  closeSync,
  constants,
  fchmodSync,
  fstatSync,
  ftruncateSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const STATE_DIR_NAME = "opencode-notify-linux"
const LOG_FILE = "debug.log"
const LOG_MAX_BYTES = 256 * 1024
const MARKER_TTL_MS = 24 * 60 * 60_000
const PRUNE_INTERVAL_MS = 60_000

export type Runtime = {
  readonly dir: string
  debug(message: string): void
  claim(eventID: string): boolean
}

/**
 * Prefer the per-user runtime directory because it is already private and
 * gets cleaned on logout. Fall back to the persistent per-user state
 * directory instead of `/tmp`, which is world-readable and can be
 * pre-created by another user.
 */
export function stateDir(env: NodeJS.ProcessEnv, home = homedir()): string {
  if (env.XDG_RUNTIME_DIR) return join(env.XDG_RUNTIME_DIR, STATE_DIR_NAME)
  if (env.XDG_STATE_HOME) return join(env.XDG_STATE_HOME, STATE_DIR_NAME)
  return join(home, ".local", "state", STATE_DIR_NAME)
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const info = lstatSync(dir)
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("unsafe state directory")
  if (typeof process.getuid === "function" && info.uid !== process.getuid()) {
    throw new Error("state directory belongs to another user")
  }
  // A directory created by an older version or by a different tool may be
  // more permissive; tighten it before writing anything.
  const fd = openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY)
  try {
    fchmodSync(fd, 0o700)
  } finally {
    closeSync(fd)
  }
}

function openLog(dir: string): number {
  // O_NOFOLLOW prevents a planted symlink from redirecting the log truncation
  // to an arbitrary file. fstat then confirms it is a regular file.
  return openSync(
    join(dir, LOG_FILE),
    constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | constants.O_NOFOLLOW,
    0o600,
  )
}

export type RuntimeOptions = {
  debug: boolean
  /** Only for tests; production uses the per-user state directory. */
  dir?: string
}

export function createRuntime(options: RuntimeOptions): Runtime {
  const dir = options.dir ?? stateDir(process.env)
  let lastPrune = 0

  const prune = () => {
    const now = Date.now()
    if (now - lastPrune < PRUNE_INTERVAL_MS) return
    lastPrune = now
    try {
      for (const name of readdirSync(dir)) {
        if (name === LOG_FILE) continue
        const path = join(dir, name)
        const info = lstatSync(path)
        if (info.isSymbolicLink()) {
          unlinkSync(path)
          continue
        }
        // Keep markers for a day: a reconnecting TUI can replay old events and
        // must not show a second notification for the same turn.
        if (now - info.mtimeMs > MARKER_TTL_MS) unlinkSync(path)
      }
    } catch {
      // Nothing to prune yet.
    }
  }

  const debug = (message: string) => {
    if (!options.debug) return
    try {
      ensureDir(dir)
      const fd = openLog(dir)
      try {
        fchmodSync(fd, 0o600)
        const info = fstatSync(fd)
        if (!info.isFile()) return
        if (info.size > LOG_MAX_BYTES) ftruncateSync(fd, 0)
        writeSync(fd, `${new Date().toISOString()} pid=${process.pid} ${message}\n`)
      } finally {
        closeSync(fd)
      }
    } catch {
      // Diagnostics are best-effort.
    }
  }

  const claim = (eventID: string): boolean => {
    prune()
    try {
      ensureDir(dir)
      const marker = join(dir, eventID.replace(/[^A-Za-z0-9._-]/g, "_"))
      writeFileSync(marker, "", { flag: "wx", mode: 0o600 })
      return true
    } catch {
      return false
    }
  }

  return { dir, debug, claim }
}
