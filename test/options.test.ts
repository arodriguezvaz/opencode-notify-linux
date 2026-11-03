import assert from "node:assert/strict"
import test from "node:test"
import { resolveOptions } from "../src/options.ts"

test("opciones por defecto", () => {
  assert.deepEqual(resolveOptions(undefined), {
    language: "auto",
    onlyWhenUnfocused: true,
    silent: true,
    appName: "OpenCode",
    icon: undefined,
    debug: true,
    maxBodyLength: 180,
    replaceNotifications: true,
    events: { succeeded: true, failed: true, permission: true, form: true },
  })
})

test("las opciones anidadas de eventos se respetan", () => {
  const options = resolveOptions({ events: { succeeded: false, permission: false } })
  assert.equal(options.events.succeeded, false)
  assert.equal(options.events.permission, false)
  assert.equal(options.events.failed, true)
  assert.equal(options.events.form, true)
})

test("los valores inválidos caen a los valores por defecto", () => {
  const options = resolveOptions({
    language: "fr",
    onlyWhenUnfocused: "no",
    silent: 1,
    appName: "   ",
    icon: "",
    debug: null,
    maxBodyLength: "mucho",
    replaceNotifications: 0,
    events: [],
  })
  assert.equal(options.language, "auto")
  assert.equal(options.onlyWhenUnfocused, true)
  assert.equal(options.silent, true)
  assert.equal(options.appName, "OpenCode")
  assert.equal(options.icon, undefined)
  assert.equal(options.debug, true)
  assert.equal(options.maxBodyLength, 180)
  assert.equal(options.replaceNotifications, true)
  assert.deepEqual(options.events, { succeeded: true, failed: true, permission: true, form: true })
})

test("maxBodyLength se recorta al rango útil", () => {
  assert.equal(resolveOptions({ maxBodyLength: 10 }).maxBodyLength, 40)
  assert.equal(resolveOptions({ maxBodyLength: 5000 }).maxBodyLength, 1000)
  assert.equal(resolveOptions({ maxBodyLength: 240.4 }).maxBodyLength, 240)
})

test("se pueden desactivar el silencio y el reemplazo", () => {
  const options = resolveOptions({ silent: false, replaceNotifications: false, language: "es" })
  assert.equal(options.silent, false)
  assert.equal(options.replaceNotifications, false)
  assert.equal(options.language, "es")
})
