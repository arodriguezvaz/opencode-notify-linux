import assert from "node:assert/strict"
import test from "node:test"
import { messagesFor, resolveLanguage } from "../src/messages.ts"

test("mensajes en español", () => {
  const messages = messagesFor("es")
  assert.equal(messages.session, "Sesión")
  assert.equal(messages.completed("Comprar pan"), "Sesión completada: Comprar pan")
  assert.equal(messages.completed(), "Sesión completada")
  assert.equal(messages.permission("Comprar pan", undefined), "Se requiere tu permiso en Comprar pan")
  assert.equal(
    messages.permission("Comprar pan", "bash: rm -rf"),
    "Se requiere tu permiso en Comprar pan\nbash: rm -rf",
  )
  assert.equal(messages.form(undefined, "¿Qué dosis?"), "Se requiere tu respuesta: ¿Qué dosis?")
  assert.equal(messages.form("Comprar pan", undefined), "Se requiere tu respuesta en Comprar pan")
  assert.equal(messages.form(undefined, undefined), "Se requiere tu respuesta")
})

test("mensajes en inglés", () => {
  const messages = messagesFor("en")
  assert.equal(messages.completed("Buy bread"), "Session completed: Buy bread")
  assert.equal(messages.permission(undefined, undefined), "Permission required")
  assert.equal(messages.form("Buy bread", undefined), "Response required in Buy bread")
  assert.equal(messages.open, "Open")
})

test("resolveLanguage respeta la opción y detecta el locale", () => {
  assert.equal(resolveLanguage("es", "en_US"), "es")
  assert.equal(resolveLanguage("en", "es_ES"), "en")
  assert.equal(resolveLanguage("auto", "es_ES.UTF-8"), "es")
  assert.equal(resolveLanguage("auto", "fr_FR.UTF-8"), "en")
})
