import { execFile, execFileSync, spawn } from "node:child_process"
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { homedir, tmpdir } from "node:os"
import { basename, join, resolve } from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import type { Context } from "@opencode/plugin/tui/context"
import {
  isCinnamon,
  notificationID,
  opencodeExecutable,
  parseWindows,
  permissionDetail,
  sameInstance,
  sameLocation,
  sameWindowID,
  terminalAttempts,
  truncate,
  type Window,
} from "./lib.ts"
import { messagesFor, resolveLanguage, type Messages } from "./messages.ts"
import { resolveOptions, type ResolvedOptions } from "./options.ts"

type Urgency = "low" | "normal" | "critical"

type NotifyInput = {
  body: string
  urgency?: Urgency
  sessionID?: string
  onOpen?: () => void
}

const userId = typeof process.getuid === "function" ? process.getuid() : "user"
const configDir = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
const defaultIconPath = join(configDir, "opencode", "icons", "opencode.png")

/**
 * Keep state per user: on a shared machine `/tmp/opencode-desktop-notify`
 * belongs to whoever created it first and the other users cannot write their
 * markers, which silently disables their notifications.
 */
const runtimeDir = process.env.XDG_RUNTIME_DIR
  ? join(process.env.XDG_RUNTIME_DIR, "opencode-notify-linux")
  : join(tmpdir(), `opencode-notify-linux-${userId}`)

let debugEnabled = true

/**
 * Small, bounded trace that makes it possible to see which TUI claimed an
 * event and which window it focused. Never keeps more than 256 KiB.
 */
function debug(message: string) {
  if (!debugEnabled) return
  try {
    mkdirSync(runtimeDir, { recursive: true })
    const path = join(runtimeDir, "debug.log")
    if (existsSync(path) && statSync(path).size > 256 * 1024) writeFileSync(path, "")
    appendFileSync(path, `${new Date().toISOString()} pid=${process.pid} ${message}\n`)
  } catch {
    // Diagnostics are best-effort.
  }
}

/**
 * Every TUI instance receives the same server event, so all of them would
 * call notify-send. Claim the event atomically on disk; only the first client
 * wins, which gives exactly one notification per finished session.
 */
function claimEvent(eventID: string): boolean {
  pruneMarkers()
  try {
    mkdirSync(runtimeDir, { recursive: true })
    const marker = join(runtimeDir, eventID.replace(/[^A-Za-z0-9._-]/g, "_"))
    writeFileSync(marker, "", { flag: "wx" })
    return true
  } catch {
    return false
  }
}

let lastPrune = 0

function pruneMarkers() {
  const now = Date.now()
  if (now - lastPrune < 60_000) return
  lastPrune = now
  try {
    for (const name of readdirSync(runtimeDir)) {
      const path = join(runtimeDir, name)
      // Keep markers for a day: a reconnecting TUI can replay old events and
      // must not show a second notification for the same turn.
      if (now - statSync(path).mtimeMs > 24 * 60 * 60_000) unlinkSync(path)
    }
  } catch {
    // Nothing to prune yet.
  }
}

type NotifyCapabilities = {
  available: boolean
  actions: boolean
  replace: boolean
}

/**
 * `--action` and `--replace-id` need libnotify 0.7.9+. Detect them once so an
 * old notify-send still shows the notification instead of failing outright.
 */
function notifySendCapabilities(): NotifyCapabilities {
  try {
    const help = execFileSync("notify-send", ["--help"], { encoding: "utf8" })
    return { available: true, actions: help.includes("--action"), replace: help.includes("--replace-id") }
  } catch {
    return { available: false, actions: false, replace: false }
  }
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

function createNotifier(context: Context, options: ResolvedOptions, messages: Messages) {
  const capabilities = notifySendCapabilities()
  const icon = options.icon ? expandHome(options.icon) : defaultIconPath

  return function notify(input: NotifyInput) {
    const body = truncate(input.body, options.maxBodyLength)
    if (!body) return

    // No libnotify: fall back to the built-in attention pipeline. It cannot
    // focus a window on click, but at least the user gets the notice.
    if (!capabilities.available) {
      void context.attention
        .notify({ title: options.appName, message: body, notification: { when: "always" } })
        .then((result) => debug(`attention ok=${result.ok} skipped=${result.skipped ?? "none"}`))
        .catch(() => {})
      return
    }

    const critical = input.urgency === "critical"
    // Cinnamon always plays its notification sound for critical urgency, even
    // with suppress-sound. Downgrade only there; other desktops keep the real
    // critical styling. Resident keeps the alert visible until dismissed.
    const urgency =
      critical && isCinnamon(process.env.XDG_CURRENT_DESKTOP, process.env.DESKTOP_SESSION)
        ? "normal"
        : input.urgency ?? "normal"

    const args = [`--app-name=${options.appName}`]
    // OpenCode plays its own attention sounds; keep the Linux notification silent.
    if (options.silent) args.push("--hint=boolean:suppress-sound:true")
    if (input.sessionID && capabilities.replace) args.push(`--replace-id=${notificationID(input.sessionID)}`)
    args.push(`--urgency=${urgency}`)
    args.push(`--icon=${existsSync(icon) ? icon : "utilities-terminal"}`)
    if (critical) args.push("--expire-time=0", "--hint=boolean:resident:true")

    // With an action, notify-send must stay alive until the user clicks or
    // dismisses the notification. When the action is invoked, it prints its
    // name to stdout, which is how we know to open the session.
    if (input.onOpen && capabilities.actions) args.push(`--action=default=${messages.open}`, "--wait")
    args.push(options.appName, body)

    const child = execFile("notify-send", args, { encoding: "utf8" }, (error, stdout) => {
      // Ignore failures: notifications are best-effort.
      if (error) {
        debug(`notify-send failed: ${error.message}`)
        return
      }
      if (input.onOpen && stdout.trim() === "default") input.onOpen()
    })

    // A notification can stay open for a long time waiting for a click. Do not
    // let it keep the TUI process alive after the user quits.
    child.unref()
    unrefStream(child.stdin)
    unrefStream(child.stdout)
    unrefStream(child.stderr)
  }
}

function unrefStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream | null) {
  ;(stream as { unref?: () => void } | null)?.unref?.()
}

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => {
      if (error) reject(error)
      else resolve(stdout)
    })
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
        }, 250)
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
async function openInNewWindow(
  sessionID: string,
  directory?: string,
  fallbackDirectory?: string,
): Promise<boolean> {
  const cwd = directory && existsSync(directory) ? directory : fallbackDirectory
  const command = [opencodeExecutable(process.execPath), "--session", sessionID, ...(cwd ? [cwd] : [])]
  for (const [program, args] of terminalAttempts(command, cwd, process.env.TERMINAL)) {
    if (await spawnDetached(program, args, cwd)) return true
  }
  return false
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

/**
 * The process start time (field 22 of /proc/<pid>/stat) distinguishes a live
 * TUI from a different process that later reused its PID.
 */
function processStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
    return fields[19]
  } catch {
    return undefined
  }
}

function isInstanceAlive(instance: string): boolean {
  const [rawPID, start] = instance.split(":")
  const pid = Number(rawPID)
  if (!Number.isFinite(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8")
    if (stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) === "Z") return false
    // A reused PID can belong to any process; only trust an OpenCode client.
    const cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
    if (!cmdline.includes("opencode")) return false
  } catch {
    return false
  }
  if (start && processStartTime(pid) !== start) return false
  return true
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

/**
 * Bring the terminal or IDE window that hosts this TUI to the front. The TUI
 * is a child of that window's process, so walking up /proc and matching the
 * window's _NET_WM_PID works for Terminator, GNOME Terminal, VS Code,
 * JetBrains and most other terminals.
 *
 * Some terminals (GNOME Terminal, Terminator) let a single process own every
 * window. Matching the expected terminal title picks the exact window that
 * hosts this TUI; the D-Bus title and the active window are fallbacks.
 */
async function terminalWindowID(expectedTitle?: string): Promise<string | undefined> {
  if (process.platform !== "linux" || !process.env.DISPLAY) return undefined

  let windows: Window[]
  try {
    windows = parseWindows(await run("wmctrl", ["-lpx"]))
  } catch {
    return undefined
  }

  for (const pid of processAncestors(process.pid)) {
    const candidates = windows.filter((window) => window.pid === pid)
    const first = candidates[0]
    if (!first) continue

    if (expectedTitle) {
      const exact = candidates.filter((window) => window.title === expectedTitle)
      if (exact.length === 1) return exact[0].id
      if (exact.length > 1) {
        const active = await activeWindowID().catch(() => undefined)
        const match = exact.find((window) => sameWindowID(window.id, active))
        return (match ?? exact[0]).id
      }
    }

    if (candidates.length === 1) return first.id

    const title = await terminatorWindowTitle().catch(() => undefined)
    const exact = title ? candidates.find((window) => window.title === title) : undefined
    if (exact) return exact.id

    const active = await activeWindowID().catch(() => undefined)
    const activeCandidate = candidates.find((window) => sameWindowID(window.id, active))
    if (activeCandidate) return activeCandidate.id

    const fallback = candidates.find(
      (window) => /(^|\s)OC\s*\|/.test(window.title) || window.title.includes("OpenCode"),
    )
    return (fallback ?? first).id
  }
  return undefined
}

/**
 * Returns the window id only when this TUI's window is the active one. That
 * is the terminal the user was typing in when the turn started.
 */
async function activeTerminalWindowID(expectedTitle?: string): Promise<string | undefined> {
  const id = await terminalWindowID(expectedTitle)
  if (!id) return undefined
  try {
    const active = await activeWindowID()
    return sameWindowID(id, active) ? id : undefined
  } catch {
    return undefined
  }
}

/**
 * Cinnamon's window manager processes activation requests asynchronously, so
 * verify the activation and retry once. Otherwise the click can raise nothing
 * on a busy desktop.
 */
async function focusWindow(id: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    await run("wmctrl", ["-i", "-a", id]).catch(() => {})
    await delay(attempt === 0 ? 120 : 90)
    const active = await activeWindowID().catch(() => undefined)
    if (sameWindowID(id, active)) return
  }
}

export default Plugin.define({
  id: "opencode-notify-linux",
  setup(context) {
    const options = resolveOptions(context.options)
    const messages = messagesFor(
      resolveLanguage(options.language, process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG),
    )
    const notify = createNotifier(context, options, messages)
    debugEnabled = options.debug
    debug(`setup language=${options.language} onlyWhenUnfocused=${options.onlyWhenUnfocused}`)

    let disposed = false

    function sessionTitle(sessionID: string): string {
      return context.data.session.get(sessionID)?.title ?? messages.session
    }

    function titleForSession(sessionID: string): string {
      const title = context.data.session.get(sessionID)?.title
      if (!title) return options.appName
      // Keep in sync with the TUI's terminal title.
      return `OC | ${title.length > 40 ? `${title.slice(0, 37)}…` : title}`
    }

    /**
     * Sessions outlive their TUI: closing the terminal or IDE leaves the turn
     * running in the background service. The session itself remembers which
     * directory it belongs to, which is more reliable than the event, whose
     * location is often missing.
     */
    function sessionDirectory(sessionID: string): string | undefined {
      const session = context.data.session.get(sessionID) as
        | { location?: { directory?: string } }
        | undefined
      return session?.location?.directory
    }

    /**
     * Best effort directory for a session: its own location, the last event
     * that mentioned it, or the owner record of a TUI that has since exited.
     */
    function directoryFor(sessionID: string): string | undefined {
      return sessionDirectory(sessionID) ?? knownDirectories.get(sessionID) ?? owners.sessions[sessionID]?.directory
    }

    /**
     * Prefix notifications for sessions from another project so it is obvious
     * they did not start in the terminal that happens to be open.
     */
    function projectPrefix(sessionID: string): string {
      const directory = directoryFor(sessionID)
      const here = context.location?.directory
      if (!directory || !here) return ""
      if (resolve(directory) === resolve(here)) return ""
      return `${basename(directory)} · `
    }

    function currentTitle(): string {
      const route = context.ui.router.current()
      if (route.type === "session") return titleForSession(route.sessionID)
      if (route.type === "plugin") return `OC | ${route.name}`
      return options.appName
    }

    // Exact window recorded when this TUI owned the start of a turn. It is
    // more reliable than resolving the window again on click, especially when
    // the session title has changed in the meantime.
    const ownWindows = new Map<string, string>()

    // Directories seen in events, kept in memory so a click still knows where
    // a session belongs when its cache entry has no location.
    const knownDirectories = new Map<string, string>()

    async function openSession(sessionID: string) {
      const owner = liveOwner(sessionID)
      const directory = directoryFor(sessionID)
      const here = context.location?.directory
      const elsewhere = Boolean(directory && here && resolve(directory) !== resolve(here))

      // Another live TUI still owns the session: just raise its window. Never
      // switch this TUI, which may be showing something unrelated.
      if (owner && !sameInstance(owner.instance, instanceID)) {
        const remote = owner.window ?? (await terminalWindowID(titleForSession(sessionID)).catch(() => undefined))
        debug(`open session=${sessionID} owner-window=${remote ?? "none"}`)
        if (remote) await focusWindow(remote)
        return
      }

      // No live owner: the window that hosted the session is gone. Recreate it
      // in its project instead of taking over the terminal that is in front.
      if (!owner) {
        if (!elsewhere) {
          try {
            if (context.ui.tabs.enabled()) {
              const id =
                ownWindows.get(sessionID) ?? (await terminalWindowID(currentTitle()).catch(() => undefined))
              if (id) await focusWindow(id)
              if (context.ui.tabs.focus(sessionID)) {
                debug(`open session=${sessionID} tab dir=${directory ?? "none"}`)
                return
              }
            }
          } catch {
            // Fall through and recreate the window instead.
          }
        }

        if (await openInNewWindow(sessionID, directory, here)) {
          debug(`open session=${sessionID} new-window dir=${directory ?? "none"}`)
          return
        }

        const confirmed = await context.ui.dialog
          .confirm({
            title: messages.noWindowTitle,
            message: messages.noWindowMessage(sessionTitle(sessionID)),
            label: { confirm: messages.openHere, cancel: messages.cancel },
          })
          .catch(() => false)
        if (!confirmed) return
      }

      const id =
        ownWindows.get(sessionID) ??
        (owner && sameInstance(owner.instance, instanceID) ? owner.window : undefined) ??
        (await terminalWindowID(currentTitle()).catch(() => undefined))
      debug(`open session=${sessionID} window=${id ?? "none"}`)
      if (id) await focusWindow(id)

      // Tabs are optional: when they are enabled, focus opens one for the
      // session; otherwise the router switches this TUI to the session view.
      try {
        if (!(context.ui.tabs.enabled() && context.ui.tabs.focus(sessionID))) {
          context.ui.router.navigate({ type: "session", sessionID })
        }
      } catch {
        context.ui.router.navigate({ type: "session", sessionID })
      }
    }

    const pendingClaims = new Set<ReturnType<typeof setTimeout>>()

    function claimLater(run: () => void, wait: number) {
      const timer = setTimeout(() => {
        pendingClaims.delete(timer)
        if (!disposed) run()
      }, wait)
      pendingClaims.add(timer)
    }

    function isViewing(sessionID: string): boolean {
      const route = context.ui.router.current()
      if (route.type !== "session") return false
      if (route.sessionID === sessionID) return true
      try {
        return context.data.session.root(route.sessionID) === context.data.session.root(sessionID)
      } catch {
        return false
      }
    }

    const instanceID = `${process.pid}:${processStartTime(process.pid) ?? "0"}`
    const [owners, setOwners] = context.storage.store<{
      sessions: Record<string, { instance: string; time: number; window?: string; directory?: string }>
    }>("session-owners", { initial: { sessions: {} } })

    /**
     * Remember which TUI was active when the turn started. That is the
     * terminal the user was typing in, so it is the one a click should focus
     * even if another TUI has the same session open in the background.
     */
    function recordOwner(sessionID: string) {
      if (!isViewing(sessionID)) return
      const title = titleForSession(sessionID)
      void activeTerminalWindowID(title)
        .then((window) => {
          if (disposed) return
          debug(`owner session=${sessionID} window=${window ?? "not-active"}`)
          if (!window) return
          ownWindows.set(sessionID, window)
          return setOwners((draft) => {
            const now = Date.now()
            for (const [id, owner] of Object.entries(draft.sessions)) {
              if (now - owner.time > 24 * 60 * 60_000 || !isInstanceAlive(owner.instance)) {
                delete draft.sessions[id]
              }
            }
            draft.sessions[sessionID] = {
              instance: instanceID,
              time: now,
              window,
              directory: sessionDirectory(sessionID),
            }
          })
        })
        .catch(() => {})
    }

    function liveOwner(sessionID: string) {
      const owner = owners.sessions[sessionID]
      if (!owner) return undefined
      if (Date.now() - owner.time > 24 * 60 * 60_000) return undefined
      if (!isInstanceAlive(owner.instance)) return undefined
      return owner
    }

    /**
     * Decide whether this TUI shows the notification. When the terminal that
     * hosts it is already focused, the user is looking at the session and a
     * popup is just noise; claim the event anyway so no other TUI repeats it.
     */
    function deliverWhenUnfocused(sessionID: string, run: () => void) {
      if (!options.onlyWhenUnfocused) {
        run()
        return
      }
      void activeTerminalWindowID(titleForSession(sessionID))
        .then((window) => {
          if (disposed) return
          if (window) {
            debug(`skip focused session=${sessionID} window=${window}`)
            return
          }
          run()
        })
        .catch(() => run())
    }

    /**
     * The TUI that started the turn wins, then the one that has the session
     * open and is active, then any TUI viewing it, then one in the same
     * directory, and finally any other TUI.
     */
    function claimAndNotify(
      eventID: string,
      sessionID: string,
      directory: string | undefined,
      run: () => void,
    ) {
      const claim = () => {
        const owner = liveOwner(sessionID)
        // Never steal an event from a live owner that is still around.
        if (owner && !sameInstance(owner.instance, instanceID)) return
        if (!claimEvent(eventID)) return
        debug(`claim session=${sessionID} event=${eventID}`)
        deliverWhenUnfocused(sessionID, run)
      }

      if (directory) knownDirectories.set(sessionID, directory)
      const owner = liveOwner(sessionID)
      debug(
        `event session=${sessionID} owner=${owner?.instance ?? "none"} view=${isViewing(sessionID)} same=${sameLocation(directory, context.location?.directory)} dir=${directory ?? "none"}`,
      )
      if (owner && sameInstance(owner.instance, instanceID)) {
        claim()
        return
      }
      if (owner) {
        // The owner claims immediately; wait long enough for its event
        // handler before falling back if it disappeared in the meantime.
        claimLater(claim, 1500)
        return
      }

      if (isViewing(sessionID)) {
        // Prefer the TUI whose terminal is focused. Every other TUI that
        // views the session waits a moment so it cannot race ahead.
        void activeTerminalWindowID(titleForSession(sessionID))
          .then((id) => {
            if (disposed) return
            if (id) claim()
            else claimLater(claim, 350)
          })
          .catch(() => claimLater(claim, 350))
        return
      }

      if (sameLocation(directory, context.location?.directory)) {
        claimLater(claim, 900)
        return
      }
      claimLater(claim, 1800)
    }

    const unsubscribe = [
      context.data.on("session.execution.started", (event) => {
        recordOwner(event.data.sessionID)
      }),
      context.data.on("session.execution.succeeded", (event) => {
        if (!options.events.succeeded) return
        const session = context.data.session.get(event.data.sessionID)
        // Ignore subagent sessions; the parent session will notify when done.
        if (session?.parentID) return
        const sessionID = event.data.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notify({
            body: `${projectPrefix(sessionID)}${messages.completed(session?.title)}`,
            sessionID,
            onOpen: () => void openSession(sessionID),
          })
        })
      }),
      context.data.on("session.execution.failed", (event) => {
        if (!options.events.failed) return
        const session = context.data.session.get(event.data.sessionID)
        if (session?.parentID) return
        const message = event.data.error?.message?.trim() || messages.failedFallback
        const sessionID = event.data.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notify({
            body: `${projectPrefix(sessionID)}${message}`,
            urgency: "critical",
            sessionID,
            onOpen: () => void openSession(sessionID),
          })
        })
      }),
      context.data.on("permission.asked", (event) => {
        if (!options.events.permission) return
        const session = context.data.session.get(event.data.sessionID)
        const sessionID = event.data.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notify({
            body: `${projectPrefix(sessionID)}${messages.permission(session?.title, permissionDetail(event.data))}`,
            urgency: "critical",
            sessionID,
            onOpen: () => void openSession(sessionID),
          })
        })
      }),
      context.data.on("form.created", (event) => {
        if (!options.events.form) return
        const session = context.data.session.get(event.data.form.sessionID)
        const sessionID = event.data.form.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notify({
            body: `${projectPrefix(sessionID)}${messages.form(session?.title, event.data.form.title)}`,
            sessionID,
            onOpen: () => void openSession(sessionID),
          })
        })
      }),
    ]

    return () => {
      disposed = true
      unsubscribe.forEach((stop) => stop())
      pendingClaims.forEach((timer) => clearTimeout(timer))
      pendingClaims.clear()
    }
  },
})
