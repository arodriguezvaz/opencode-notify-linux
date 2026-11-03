import { basename, resolve } from "node:path"

export type Window = {
  readonly id: string
  readonly pid: number
  readonly title: string
}

export type TerminalAttempt = readonly [string, string[]]

export type PermissionEventData = {
  readonly action: string
  readonly resources: readonly string[]
  readonly message?: string | undefined
}

export type SwayWindow = Window & {
  readonly focused: boolean
}

/** Cut a notification body without leaving a dangling space before the ellipsis. */
export function truncate(value: string, max: number): string {
  const text = value.trim()
  if (max <= 0 || text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/**
 * `wmctrl -lpx` prints: id desktop pid host title. Terminator and other
 * terminals can share a PID, so the title is kept to disambiguate windows.
 */
export function parseWindows(output: string): Window[] {
  return output.split("\n").flatMap((line) => {
    const match = line.match(/^(0x[0-9a-f]+)\s+\S+\s+(\d+)\s+\S+\s+\S+\s+(.*)$/i)
    if (!match) return []
    const id = match[1]
    const pid = Number(match[2])
    if (!id || !Number.isFinite(pid)) return []
    return [{ id, pid, title: match[3] ?? "" }]
  })
}

export function sameWindowID(left?: string, right?: string): boolean {
  if (!left || !right) return false
  return Number.parseInt(left, 16) === Number.parseInt(right, 16)
}

/**
 * An event without a directory used to count as "here", so every TUI claimed
 * sessions from other projects. Treat unknown as "not here".
 */
export function sameLocation(left?: string, right?: string): boolean {
  if (!left || !right) return false
  return resolve(left) === resolve(right)
}

/**
 * Older plugin versions stored only the PID. Accept those entries when the
 * PID matches so a plugin reload does not orphan the sessions they own.
 */
export function sameInstance(left: string, right: string): boolean {
  if (left === right) return true
  const [leftPID, leftStart] = left.split(":")
  const [rightPID, rightStart] = right.split(":")
  if (leftPID !== rightPID) return false
  if (!leftStart || !rightStart) return true
  return leftStart === rightStart
}

/**
 * `notify-send --replace-id` takes an unsigned integer. Derive a stable one
 * from the session so successive events replace the previous notification
 * instead of stacking on top of it.
 */
export function notificationID(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0) || 1
}

export function selectLanguage(locale: string | undefined): "es" | "en" {
  return (locale ?? "").trim().toLowerCase().startsWith("es") ? "es" : "en"
}

export function isCinnamon(desktop: string | undefined, session: string | undefined): boolean {
  return [desktop, session].some((value) => /cinnamon/i.test(value ?? ""))
}

/**
 * Prefer the most useful part of a permission request: the message if the
 * server sent one, otherwise the action and the first affected resource
 * (for example `bash: git status`).
 */
export function permissionDetail(data: PermissionEventData): string | undefined {
  const message = data.message?.trim()
  if (message) return message
  const resource = data.resources?.[0]
  const detail = [data.action, resource].filter((part): part is string => Boolean(part)).join(": ")
  return detail || undefined
}

/**
 * Terminals differ in how they accept a working directory and a command.
 * `$TERMINAL` wins when set; the rest are tried in order until one spawns.
 */
export function terminalAttempts(
  command: readonly string[],
  cwd: string | undefined,
  terminal: string | undefined,
): TerminalAttempt[] {
  const attempts: TerminalAttempt[] = []
  if (terminal) attempts.push([terminal, ["-e", ...command]])

  const terminator = cwd ? [`--working-directory=${cwd}`, "-x", ...command] : ["-x", ...command]
  attempts.push(["terminator", terminator])

  const gnome = cwd ? [`--working-directory=${cwd}`, "--", ...command] : ["--", ...command]
  attempts.push(["gnome-terminal", gnome])

  const konsole = cwd ? ["--workdir", cwd, "-e", ...command] : ["-e", ...command]
  attempts.push(["konsole", konsole])

  const xfce = cwd ? [`--working-directory=${cwd}`, "-x", ...command] : ["-x", ...command]
  attempts.push(["xfce4-terminal", xfce])

  attempts.push(["kitty", cwd ? ["--directory", cwd, ...command] : [...command]])
  attempts.push(["alacritty", cwd ? ["--working-directory", cwd, "-e", ...command] : ["-e", ...command]])
  attempts.push(["wezterm", cwd ? ["start", "--cwd", cwd, "--", ...command] : ["start", "--", ...command]])
  attempts.push(["foot", cwd ? ["--working-directory", cwd, "--", ...command] : ["--", ...command]])
  attempts.push(["x-terminal-emulator", ["-e", ...command]])
  attempts.push(["xterm", ["-e", ...command]])

  return attempts
}

/** `opencode` may run from a wrapper; only trust execPath when it is the CLI. */
export function opencodeExecutable(execPath: string): string {
  return /opencode/i.test(basename(execPath)) ? execPath : "opencode"
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringValue(value: unknown, key: string): string | undefined {
  const result = objectValue(value)?.[key]
  return typeof result === "string" ? result : undefined
}

function numberValue(value: unknown, key: string): number | undefined {
  const result = objectValue(value)?.[key]
  return typeof result === "number" && Number.isFinite(result) ? result : undefined
}

/**
 * `swaymsg -t get_tree -r` returns a nested tree. Only view containers have a
 * PID; outputs and workspaces do not, so they are skipped. `name` and
 * `window_properties.title` carry the window title depending on the app.
 */
export function parseSwayTree(value: unknown): SwayWindow[] {
  const windows: SwayWindow[] = []

  const visit = (node: unknown) => {
    const record = objectValue(node)
    if (!record) return

    const id = numberValue(record, "id")
    const pid = numberValue(record, "pid")
    if (id !== undefined && pid !== undefined && pid > 0) {
      const title = stringValue(record, "name") ?? stringValue(record.window_properties, "title") ?? ""
      windows.push({ id: `sway:${id}`, pid, title, focused: record.focused === true })
    }

    for (const key of ["nodes", "floating_nodes"]) {
      const children = record[key]
      if (Array.isArray(children)) for (const child of children) visit(child)
    }
  }

  if (Array.isArray(value)) for (const node of value) visit(node)
  else visit(value)
  return windows
}

/** `hyprctl clients -j` entries; `mapped: false` and hidden clients are skipped. */
export function parseHyprlandClient(value: unknown): Window | undefined {
  const record = objectValue(value)
  if (!record) return undefined

  const address = stringValue(record, "address")
  const pid = numberValue(record, "pid")
  if (!address || pid === undefined || pid <= 0) return undefined
  if (record.mapped === false || record.hidden === true) return undefined

  return { id: `hypr:${address.toLowerCase()}`, pid, title: stringValue(record, "title") ?? "" }
}

export function parseHyprlandClients(value: unknown): Window[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((client) => {
    const window = parseHyprlandClient(client)
    return window ? [window] : []
  })
}

