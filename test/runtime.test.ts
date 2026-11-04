import assert from "node:assert/strict"
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createRuntime, stateDir } from "../src/runtime.ts"

test("stateDir prioriza runtime y luego state", () => {
  assert.equal(stateDir({ XDG_RUNTIME_DIR: "/run/user/1000" }, "/home/usuario"), "/run/user/1000/opencode-notify-linux")
  assert.equal(
    stateDir({ XDG_STATE_HOME: "/home/usuario/.state" }, "/home/usuario"),
    "/home/usuario/.state/opencode-notify-linux",
  )
  assert.equal(stateDir({}, "/home/usuario"), "/home/usuario/.local/state/opencode-notify-linux")
})

test("claim es atómico y los permisos son privados", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-notify-test-"))
  try {
    const first = createRuntime({ debug: false, dir })
    const second = createRuntime({ debug: false, dir })
    assert.equal(first.claim("evt_1"), true)
    assert.equal(second.claim("evt_1"), false)
    assert.equal(statSync(dir).mode & 0o777, 0o700)
    assert.equal(statSync(join(dir, "evt_1")).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("debug no sigue un symlink plantado", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-notify-test-"))
  try {
    const victim = join(dir, "victim.txt")
    writeFileSync(victim, "importante")
    symlinkSync(victim, join(dir, "debug.log"))
    const runtime = createRuntime({ debug: true, dir })
    runtime.debug("hola")
    assert.equal(readFileSync(victim, "utf8"), "importante")
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("debug escribe el log con permisos privados", () => {
  const dir = mkdtempSync(join(tmpdir(), "opencode-notify-test-"))
  try {
    const runtime = createRuntime({ debug: true, dir })
    runtime.debug("mensaje")
    const log = join(dir, "debug.log")
    assert.match(readFileSync(log, "utf8"), /mensaje/)
    assert.equal(statSync(log).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
