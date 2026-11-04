import { execFile } from "node:child_process"
import { readFileSync } from "node:fs"
import {
  type BackendKind,
  chooseBackend,
  chooseWindow,
  parseHyprlandClient,
  parseHyprlandClients,
  parseSwayTree,
  parseWindows,
  type SwayWindow,
  sameWindowID,
  type Window,
} from "./lib.ts"

const COMMAND_TIMEOUT_MS = 1500
const WINDOW_CACHE_MS = 500
const ANCESTOR_CACHE_MS = 500
const BACKEND_RETRY_MS = 30_000
const FOCUS_ATTEMPTS = 3

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { encoding: "utf8", timeout: COMMAND_TIMEOUT_MS, killSignal: "SIGKILL" },
      (error, stdout) => {
        if (error) reject(error)
        else resolve(stdout)
      },
    )
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

type WindowBackend = {
  readonly kind: BackendKind
  list(): Promise<Window[]>
  activeID(): Promise<string | undefined>
  focus(id: string): Promise<void>
  sameID(left?: string, right?: string): boolean
  accepts(id: string): boolean
  preferredTitle?(): Promise<string | undefined>
}

async function activeWindowID(): Promise<string | undefined> {
  const output = await run("xprop", ["-root", "_NET_ACTIVE_WINDOW"])
  return output.match(/0x[0-9a-f]+/i)?.[0]
}

async function terminatorWindowTitle(): Promise<string | undefined> {
  const uuid = process.env.TERMINATOR_UUID
  const name = process.env.TERMINATOR_DBUS_NAME
  if (!uuid || !name) return undefined

  const output = await run("dbus-send", [
    "--session",
    `--dest=${name}`,
    "--print-reply=literal",
    "--type=method_call",
    process.env.TERMINATOR_DBUS_PATH ?? "/net/tenshu/Terminator2",
    `${name}.get_window_title`,
    `variant:string:${uuid}`,
  ])
  return output.trim() || undefined
}

const x11Backend: WindowBackend = {
  kind: "x11",
  async list() {
    return parseWindows(await run("wmctrl", ["-lpx"]))
  },
  activeID: activeWindowID,
  async focus(id) {
    await run("wmctrl", ["-i", "-a", id])
  },
  sameID: sameWindowID,
  accepts: (id) => /^0x[0-9a-f]+$/i.test(id),
  preferredTitle: () => terminatorWindowTitle().catch(() => undefined),
}

async function swayWindows(): Promise<SwayWindow[]> {
  return parseSwayTree(JSON.parse(await run("swaymsg", ["-t", "get_tree", "-r"])))
}

const swayBackend: WindowBackend = {
  kind: "sway",
  async list() {
    return (await swayWindows()).map(({ id, pid, title }) => ({ id, pid, title }))
  },
  async activeID() {
    return (await swayWindows()).find((window) => window.focused)?.id
  },
  async focus(id) {
    await run("swaymsg", [`[con_id=${id.replace(/^sway:/, "")}]`, "focus"])
  },
  sameID: (left, right) => Boolean(left && right && left === right),
  accepts: (id) => /^sway:\d+$/.test(id),
}

async function hyprlandClients(): Promise<Window[]> {
  return parseHyprlandClients(JSON.parse(await run("hyprctl", ["clients", "-j"])))
}

const hyprlandBackend: WindowBackend = {
  kind: "hyprland",
  list: hyprlandClients,
  async activeID() {
    return parseHyprlandClient(JSON.parse(await run("hyprctl", ["activewindow", "-j"])))?.id
  },
  async focus(id) {
    const address = id.replace(/^hypr:/, "")
    await run("hyprctl", ["dispatch", "focuswindow", `address:${address}`])
  },
  sameID: (left, right) => Boolean(left && right && left.toLowerCase() === right.toLowerCase()),
  accepts: (id) => /^hypr:/i.test(id),
}

const BACKENDS: Record<BackendKind, WindowBackend> = {
  x11: x11Backend,
  sway: swayBackend,
  hyprland: hyprlandBackend,
}

function processAncestors(pid: number): number[] {
  const ancestors: number[] = []
  let current = pid
  for (let depth = 0; depth < 16; depth++) {
    ancestors.push(current)
    try {
      const status = readFileSync(`/proc/${current}/status`, "utf8")
      const match = status.match(/^PPid:\s+(\d+)/m)
      const parent = match?.[1] ? Number(match[1]) : NaN
      if (!Number.isFinite(parent) || parent <= 1) break
      current = parent
    } catch {
      break
    }
  }
  return ancestors
}

export type WindowManager = {
  findWindow(expectedTitle?: string): Promise<Window | undefined>
  activeTerminalWindowID(expectedTitle?: string): Promise<string | undefined>
  focusWindow(id: string): Promise<boolean>
  warmup(): void
}

export function createWindowManager(debug: (message: string) => void): WindowManager {
  let backendPromise: Promise<WindowBackend | undefined> | undefined
  let backendFailedAt = 0
  let listCache: { at: number; backend: WindowBackend; windows: Window[] } | undefined
  let activeCache: { at: number; backend: WindowBackend; id: string | undefined } | undefined
  let preferredCache: { at: number; backend: WindowBackend; title: string | undefined } | undefined
  let ancestorCache: { at: number; pid: number; values: number[] } | undefined

  const invalidateCaches = () => {
    listCache = undefined
    activeCache = undefined
    preferredCache = undefined
  }

  const invalidateBackend = (cooldown = false) => {
    backendPromise = undefined
    backendFailedAt = cooldown ? Date.now() : 0
    invalidateCaches()
  }

  const selectBackend = async (): Promise<WindowBackend | undefined> => {
    const kinds = chooseBackend({
      platform: process.platform,
      xdgSessionType: process.env.XDG_SESSION_TYPE,
      waylandDisplay: process.env.WAYLAND_DISPLAY,
      hyprlandSignature: process.env.HYPRLAND_INSTANCE_SIGNATURE,
      swaySocket: process.env.SWAYSOCK,
      display: process.env.DISPLAY,
    })

    for (const kind of kinds) {
      const backend = BACKENDS[kind]
      try {
        const windows = await backend.list()
        listCache = { at: Date.now(), backend, windows }
        debug(`window backend=${backend.kind}`)
        return backend
      } catch {
        debug(`window backend=${backend.kind} unavailable`)
      }
    }
    debug("window backend=none")
    return undefined
  }

  const backend = (): Promise<WindowBackend | undefined> => {
    if (backendPromise) return backendPromise
    // Do not retry a broken environment on every single event.
    if (Date.now() - backendFailedAt < BACKEND_RETRY_MS) return Promise.resolve(undefined)
    backendPromise = selectBackend().then((selected) => {
      if (!selected) {
        backendPromise = undefined
        backendFailedAt = Date.now()
      }
      return selected
    })
    return backendPromise
  }

  const listWindows = async (selected: WindowBackend): Promise<Window[]> => {
    const now = Date.now()
    if (listCache && listCache.backend === selected && now - listCache.at < WINDOW_CACHE_MS) {
      return listCache.windows
    }
    try {
      const windows = await selected.list()
      listCache = { at: Date.now(), backend: selected, windows }
      return windows
    } catch {
      invalidateBackend(true)
      return []
    }
  }

  const activeID = async (selected: WindowBackend): Promise<string | undefined> => {
    const now = Date.now()
    if (activeCache && activeCache.backend === selected && now - activeCache.at < WINDOW_CACHE_MS) {
      return activeCache.id
    }
    const id = await selected.activeID().catch(() => undefined)
    activeCache = { at: Date.now(), backend: selected, id }
    return id
  }

  const preferredTitle = async (selected: WindowBackend): Promise<string | undefined> => {
    if (!selected.preferredTitle) return undefined
    const now = Date.now()
    if (preferredCache && preferredCache.backend === selected && now - preferredCache.at < WINDOW_CACHE_MS) {
      return preferredCache.title
    }
    const title = await selected.preferredTitle().catch(() => undefined)
    preferredCache = { at: Date.now(), backend: selected, title }
    return title
  }

  const ancestors = (pid: number): number[] => {
    const now = Date.now()
    if (ancestorCache && ancestorCache.pid === pid && now - ancestorCache.at < ANCESTOR_CACHE_MS) {
      return ancestorCache.values
    }
    const values = processAncestors(pid)
    ancestorCache = { at: Date.now(), pid, values }
    return values
  }

  type Lookup = {
    backend: WindowBackend
    active: string | undefined
    window: Window | undefined
  }

  const lookup = async (expectedTitle?: string): Promise<Lookup | undefined> => {
    const selected = await backend()
    if (!selected) return undefined

    const [windows, active, preferred] = await Promise.all([
      listWindows(selected),
      activeID(selected),
      preferredTitle(selected),
    ])

    return {
      backend: selected,
      active,
      window: chooseWindow({
        ancestors: ancestors(process.pid),
        windows,
        expectedTitle,
        activeID: active,
        preferredTitle: preferred,
        sameID: selected.sameID,
      }),
    }
  }

  const findWindow = async (expectedTitle?: string): Promise<Window | undefined> => {
    return (await lookup(expectedTitle))?.window
  }

  const activeTerminalWindowID = async (expectedTitle?: string): Promise<string | undefined> => {
    const result = await lookup(expectedTitle)
    if (!result?.window) return undefined
    return result.backend.sameID(result.window.id, result.active) ? result.window.id : undefined
  }

  const focusWindow = async (id: string): Promise<boolean> => {
    const selected = await backend()
    if (!selected) return false
    // A stored id may come from another backend (for example after switching
    // between X11 and Wayland); never send it to the wrong focus command.
    if (!selected.accepts(id)) {
      debug(`focus skipped backend=${selected.kind} id=${id}`)
      return false
    }

    for (let attempt = 0; attempt < FOCUS_ATTEMPTS; attempt++) {
      await selected.focus(id).catch(() => {})
      await delay(attempt === 0 ? 120 : 90)
      const active = await selected.activeID().catch(() => undefined)
      if (selected.sameID(id, active)) {
        invalidateCaches()
        return true
      }
    }

    // Focusing failed several times: the compositor may have restarted, so
    // let the next call choose a backend again.
    invalidateBackend()
    return false
  }

  const warmup = () => {
    void backend()
  }

  return { findWindow, activeTerminalWindowID, focusWindow, warmup }
}
