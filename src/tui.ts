import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Plugin } from "@opencode/plugin/tui"
import { permissionDetail, projectPrefixFor, sameInstance, sameLocation } from "./lib.ts"
import { messagesFor, resolveLanguage } from "./messages.ts"
import { createNotifier, type NotifyKind } from "./notifier.ts"
import { resolveOptions } from "./options.ts"
import { createRuntime } from "./runtime.ts"
import { openInNewWindow } from "./terminal.ts"
import { createWindowManager } from "./windows.ts"

const OWNER_TTL_MS = 24 * 60 * 60_000
const CLAIM_DELAY_MS = {
  owner: 1500,
  viewing: 350,
  sameDirectory: 900,
  other: 1800,
} as const

type FocusState = "focused" | "unfocused" | "unknown"

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

export default Plugin.define({
  id: "opencode-notify-linux",
  setup(context) {
    const options = resolveOptions(context.options)
    const messages = messagesFor(
      resolveLanguage(options.language, process.env.LC_ALL ?? process.env.LC_MESSAGES ?? process.env.LANG),
    )
    const runtime = createRuntime({ debug: options.debug })
    const windows = createWindowManager(runtime.debug)
    const notify = createNotifier(context, options, messages, runtime.debug)

    runtime.debug(`setup language=${options.language} onlyWhenUnfocused=${options.onlyWhenUnfocused}`)
    windows.warmup()

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
      const session = context.data.session.get(sessionID) as { location?: { directory?: string } } | undefined
      return session?.location?.directory
    }

    /**
     * Best effort directory for a session: its own location, the last event
     * that mentioned it, or the owner record of a TUI that has since exited.
     */
    function directoryFor(sessionID: string): string | undefined {
      return sessionDirectory(sessionID) ?? knownDirectories.get(sessionID) ?? owners.sessions[sessionID]?.directory
    }

    function projectPrefix(sessionID: string): string {
      return projectPrefixFor(directoryFor(sessionID), context.location?.directory)
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

      // Another live TUI still owns the session: raise its window. If the
      // window cannot be resolved or focused, fall through to the normal
      // navigation instead of leaving the click without any effect.
      if (owner && !sameInstance(owner.instance, instanceID)) {
        const remote = owner.window ?? (await windows.findWindow(titleForSession(sessionID)))?.id
        runtime.debug(`open session=${sessionID} owner-window=${remote ?? "none"}`)
        if (remote && (await windows.focusWindow(remote))) return
      }

      // No live owner: the window that hosted the session is gone. Recreate it
      // in its project instead of taking over the terminal that is in front.
      if (!owner) {
        if (!elsewhere) {
          try {
            if (context.ui.tabs.enabled()) {
              const id = ownWindows.get(sessionID) ?? (await windows.findWindow(currentTitle()))?.id
              if (id) await windows.focusWindow(id)
              if (context.ui.tabs.focus(sessionID)) {
                runtime.debug(`open session=${sessionID} tab dir=${directory ?? "none"}`)
                return
              }
            }
          } catch {
            // Fall through and recreate the window instead.
          }
        }

        if (await openInNewWindow(sessionID, directory, here)) {
          runtime.debug(`open session=${sessionID} new-window dir=${directory ?? "none"}`)
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
        (await windows.findWindow(currentTitle()))?.id
      runtime.debug(`open session=${sessionID} window=${id ?? "none"}`)
      if (id) await windows.focusWindow(id)

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

    function openFromNotification(sessionID: string) {
      if (disposed) return
      void openSession(sessionID).catch((error) => runtime.debug(`open failed: ${String(error)}`))
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
      void windows
        .activeTerminalWindowID(title)
        .then((window) => {
          if (disposed) return
          runtime.debug(`owner session=${sessionID} window=${window ?? "not-active"}`)
          if (!window) return
          ownWindows.set(sessionID, window)
          return setOwners((draft) => {
            const now = Date.now()
            for (const [id, owner] of Object.entries(draft.sessions)) {
              if (now - owner.time > OWNER_TTL_MS || !isInstanceAlive(owner.instance)) {
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
      if (Date.now() - owner.time > OWNER_TTL_MS) return undefined
      if (!isInstanceAlive(owner.instance)) return undefined
      return owner
    }

    /**
     * Decide whether this TUI shows the notification. When the terminal that
     * hosts it is already focused, the user is looking at the session and a
     * popup is just noise; claim the event anyway so no other TUI repeats it.
     * A known focus state avoids running the window lookup twice.
     */
    function deliverWhenUnfocused(sessionID: string, run: () => void, focus: FocusState) {
      if (!options.onlyWhenUnfocused || focus === "unfocused") {
        run()
        return
      }
      if (focus === "focused") {
        runtime.debug(`skip focused session=${sessionID}`)
        return
      }
      void windows
        .activeTerminalWindowID(titleForSession(sessionID))
        .then((window) => {
          if (disposed) return
          if (window) {
            runtime.debug(`skip focused session=${sessionID} window=${window}`)
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
    function claimAndNotify(eventID: string, sessionID: string, directory: string | undefined, run: () => void) {
      const claim = (focus: FocusState) => {
        const owner = liveOwner(sessionID)
        // Never steal an event from a live owner that is still around.
        if (owner && !sameInstance(owner.instance, instanceID)) return
        if (!runtime.claim(eventID)) return
        runtime.debug(`claim session=${sessionID} event=${eventID}`)
        deliverWhenUnfocused(sessionID, run, focus)
      }

      if (directory) knownDirectories.set(sessionID, directory)
      const owner = liveOwner(sessionID)
      runtime.debug(
        `event session=${sessionID} owner=${owner?.instance ?? "none"} view=${isViewing(sessionID)} same=${sameLocation(directory, context.location?.directory)} dir=${directory ?? "none"}`,
      )
      if (owner && sameInstance(owner.instance, instanceID)) {
        claim("unknown")
        return
      }
      if (owner) {
        // The owner claims immediately; wait long enough for its event
        // handler before falling back if it disappeared in the meantime.
        claimLater(() => claim("unknown"), CLAIM_DELAY_MS.owner)
        return
      }

      if (isViewing(sessionID)) {
        // Prefer the TUI whose terminal is focused. Every other TUI that
        // views the session waits a moment so it cannot race ahead.
        void windows
          .activeTerminalWindowID(titleForSession(sessionID))
          .then((id) => {
            if (disposed) return
            if (id) claim("focused")
            else claim("unfocused")
          })
          .catch(() => claimLater(() => claim("unknown"), CLAIM_DELAY_MS.viewing))
        return
      }

      if (sameLocation(directory, context.location?.directory)) {
        claimLater(() => claim("unknown"), CLAIM_DELAY_MS.sameDirectory)
        return
      }
      claimLater(() => claim("unknown"), CLAIM_DELAY_MS.other)
    }

    function notifySession(kind: NotifyKind, sessionID: string, body: string, urgency?: "low" | "normal" | "critical") {
      notify({
        body: `${projectPrefix(sessionID)}${body}`,
        urgency,
        kind,
        sessionID,
        onOpen: () => openFromNotification(sessionID),
      })
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
          notifySession("success", sessionID, messages.completed(session?.title))
        })
      }),
      context.data.on("session.execution.failed", (event) => {
        if (!options.events.failed) return
        const session = context.data.session.get(event.data.sessionID)
        if (session?.parentID) return
        const message = event.data.error?.message?.trim() || messages.failedFallback
        const sessionID = event.data.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notifySession("failure", sessionID, message, "critical")
        })
      }),
      context.data.on("permission.asked", (event) => {
        if (!options.events.permission) return
        const session = context.data.session.get(event.data.sessionID)
        const sessionID = event.data.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notifySession(
            "permission",
            sessionID,
            messages.permission(session?.title, permissionDetail(event.data)),
            "critical",
          )
        })
      }),
      context.data.on("form.created", (event) => {
        if (!options.events.form) return
        const session = context.data.session.get(event.data.form.sessionID)
        const sessionID = event.data.form.sessionID
        claimAndNotify(event.id, sessionID, event.location?.directory ?? sessionDirectory(sessionID), () => {
          notifySession("form", sessionID, messages.form(session?.title, event.data.form.title))
        })
      }),
    ]

    return () => {
      disposed = true
      for (const stop of unsubscribe) stop()
      for (const timer of pendingClaims) clearTimeout(timer)
      pendingClaims.clear()
    }
  },
})
