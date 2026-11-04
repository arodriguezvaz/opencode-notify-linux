import type { LanguageOption } from "./messages.ts"

export type EventOptions = {
  succeeded: boolean
  failed: boolean
  permission: boolean
  form: boolean
}

export type ResolvedOptions = {
  language: LanguageOption
  onlyWhenUnfocused: boolean
  silent: boolean
  appName: string
  icon: string | undefined
  debug: boolean
  maxBodyLength: number
  replaceNotifications: boolean
  events: EventOptions
}

const DEFAULTS = {
  language: "auto" as LanguageOption,
  onlyWhenUnfocused: true,
  silent: true,
  appName: "OpenCode",
  debug: false,
  maxBodyLength: 180,
  replaceNotifications: true,
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function language(value: unknown): LanguageOption {
  return value === "es" || value === "en" || value === "auto" ? value : DEFAULTS.language
}

export function resolveOptions(raw: unknown): ResolvedOptions {
  const source = record(raw)
  const events = record(source.events)
  return {
    language: language(source.language),
    onlyWhenUnfocused: flag(source.onlyWhenUnfocused, DEFAULTS.onlyWhenUnfocused),
    silent: flag(source.silent, DEFAULTS.silent),
    appName: text(source.appName, DEFAULTS.appName),
    icon: text(source.icon, "") || undefined,
    debug: flag(source.debug, DEFAULTS.debug),
    maxBodyLength: integer(source.maxBodyLength, DEFAULTS.maxBodyLength, 40, 1000),
    replaceNotifications: flag(source.replaceNotifications, DEFAULTS.replaceNotifications),
    events: {
      succeeded: flag(events.succeeded, true),
      failed: flag(events.failed, true),
      permission: flag(events.permission, true),
      form: flag(events.form, true),
    },
  }
}
