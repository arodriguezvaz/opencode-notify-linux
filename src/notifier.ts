import { execFile, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Context } from "@opencode/plugin/tui/context"
import { buildNotifyArgs, isCinnamon, notificationID, truncate } from "./lib.ts"
import type { Messages } from "./messages.ts"
import type { ResolvedOptions } from "./options.ts"

export type NotifyKind = "success" | "failure" | "permission" | "form"

export type NotifyInput = {
  body: string
  urgency?: "low" | "normal" | "critical"
  kind: NotifyKind
  sessionID?: string
  onOpen?: () => void
}

export type Notifier = (input: NotifyInput) => void

type NotifyCapabilities = {
  available: boolean
  actions: boolean
  replace: boolean
}

const CAPABILITY_TIMEOUT_MS = 1000
const CONFIG_DIR = process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config")
const DEFAULT_ICON = join(CONFIG_DIR, "opencode", "icons", "opencode.png")

/**
 * `--action` and `--replace-id` need libnotify 0.7.9+. Detect them once so an
 * old notify-send still shows the notification instead of failing outright.
 * `spawnSync` captures both streams (some versions print help on stderr) and
 * has a timeout, so a broken binary cannot block plugin setup.
 */
export function notifySendCapabilities(): NotifyCapabilities {
  const result = spawnSync("notify-send", ["--help"], {
    encoding: "utf8",
    timeout: CAPABILITY_TIMEOUT_MS,
  })
  if (result.error || result.status !== 0) return { available: false, actions: false, replace: false }
  const help = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  return { available: true, actions: help.includes("--action"), replace: help.includes("--replace-id") }
}

function expandHome(path: string): string {
  return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

function unrefStream(stream: NodeJS.ReadableStream | NodeJS.WritableStream | null) {
  ;(stream as { unref?: () => void } | null)?.unref?.()
}

export function createNotifier(
  context: Context,
  options: ResolvedOptions,
  messages: Messages,
  debug: (message: string) => void,
): Notifier {
  const capabilities = notifySendCapabilities()
  const icon = options.icon ? expandHome(options.icon) : DEFAULT_ICON

  const fallback = (body: string) => {
    // No libnotify (or notify-send failed): use OpenCode's attention pipeline.
    // It cannot focus a window on click, but at least the user gets the notice.
    void context.attention
      .notify({ title: options.appName, message: body, notification: { when: "always" } })
      .then((result) => debug(`attention ok=${result.ok} skipped=${result.skipped ?? "none"}`))
      .catch(() => {})
  }

  return (input: NotifyInput) => {
    const body = truncate(input.body, options.maxBodyLength)
    if (!body) return

    if (!capabilities.available) {
      fallback(body)
      return
    }

    const labels = input.onOpen && capabilities.actions ? { open: messages.open, dismiss: messages.dismiss } : undefined
    const replaceID =
      input.sessionID && capabilities.replace ? notificationID(`${input.sessionID}:${input.kind}`) : undefined

    const args = buildNotifyArgs({
      appName: options.appName,
      body,
      urgency: input.urgency ?? "normal",
      silent: options.silent,
      replaceID,
      icon: existsSync(icon) ? icon : "utilities-terminal",
      cinnamon: isCinnamon(process.env.XDG_CURRENT_DESKTOP, process.env.DESKTOP_SESSION),
      labels,
    })

    const child = execFile("notify-send", args, { encoding: "utf8" }, (error, stdout) => {
      if (error) {
        debug(`notify-send failed: ${error.message}`)
        fallback(body)
        return
      }
      const choice = stdout.trim()
      if (choice === "dismiss") {
        debug("notification dismissed")
        return
      }
      if (input.onOpen && choice === "default") input.onOpen()
    })

    // A notification can stay open for a long time waiting for a click. Do not
    // let it keep the TUI process alive after the user quits.
    child.unref()
    unrefStream(child.stdin)
    unrefStream(child.stdout)
    unrefStream(child.stderr)
  }
}
