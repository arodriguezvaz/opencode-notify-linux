import assert from "node:assert/strict"
import test from "node:test"
import {
  isCinnamon,
  notificationID,
  opencodeExecutable,
  parseHyprlandClient,
  parseHyprlandClients,
  parseSwayTree,
  parseWindows,
  permissionDetail,
  sameInstance,
  sameLocation,
  sameWindowID,
  selectLanguage,
  terminalAttempts,
  truncate,
} from "../src/lib.ts"

test("truncate respeta el límite y añade elipsis", () => {
  assert.equal(truncate("hola", 10), "hola")
  assert.equal(truncate("  hola  ", 10), "hola")
  assert.equal(truncate("abcdefghij", 5), "abcd…")
  assert.equal(truncate("abcdef", 0), "abcdef")
})

test("parseWindows lee la salida de wmctrl -lpx", () => {
  // Formato real de `wmctrl -lpx`: id, escritorio, pid, WM_CLASS, host, título.
  const output = [
    "0x03e00006  0  29649  gnome-terminal-server.Gnome-terminal  host-generico  OC | Prueba",
    "0x04a00007  1   1234  terminator.Terminator  host-generico  Terminator",
    "linea basura",
  ].join("\n")

  assert.deepEqual(parseWindows(output), [
    { id: "0x03e00006", pid: 29649, title: "OC | Prueba" },
    { id: "0x04a00007", pid: 1234, title: "Terminator" },
  ])
  assert.deepEqual(parseWindows(""), [])
})

test("sameWindowID compara en hexadecimal e ignora ceros a la izquierda", () => {
  assert.equal(sameWindowID("0x03e00006", "0x3e00006"), true)
  assert.equal(sameWindowID("0x03e00006", "0x04a00007"), false)
  assert.equal(sameWindowID(undefined, "0x03e00006"), false)
})

test("parseSwayTree recorre el árbol y conserva el foco", () => {
  const tree = {
    id: 1,
    name: "root",
    nodes: [
      {
        id: 2,
        name: "workspace",
        nodes: [
          { id: 3, pid: 100, name: "OC | Proyecto", focused: true, nodes: [] },
          { id: 4, pid: 200, name: "Otra", focused: false, nodes: [] },
        ],
      },
      { id: 5, pid: 300, window_properties: { title: "Sin name" }, floating_nodes: [] },
    ],
  }

  assert.deepEqual(parseSwayTree(tree), [
    { id: "sway:3", pid: 100, title: "OC | Proyecto", focused: true },
    { id: "sway:4", pid: 200, title: "Otra", focused: false },
    { id: "sway:5", pid: 300, title: "Sin name", focused: false },
  ])
  assert.deepEqual(parseSwayTree(undefined), [])
})

test("parseHyprlandClients filtra clientes ocultos o sin mapear", () => {
  const clients = [
    { address: "0xABC", pid: 100, title: "OC | Proyecto", mapped: true, hidden: false },
    { address: "0xDEF", pid: 200, title: "Oculta", mapped: true, hidden: true },
    { address: "0x123", pid: 300, title: "Sin mapear", mapped: false },
    { address: "", pid: 400, title: "Sin dirección" },
    { address: "0x456", pid: 0, title: "Sin PID" },
  ]

  assert.deepEqual(parseHyprlandClients(clients), [
    { id: "hypr:0xabc", pid: 100, title: "OC | Proyecto" },
  ])
  assert.deepEqual(parseHyprlandClients({}), [])
})

test("parseHyprlandClient acepta el objeto de activewindow", () => {
  assert.deepEqual(parseHyprlandClient({ address: "0xABC", pid: 100, title: "OC" }), {
    id: "hypr:0xabc",
    pid: 100,
    title: "OC",
  })
  assert.equal(parseHyprlandClient({}), undefined)
  assert.equal(parseHyprlandClient({ address: "0x1", pid: 1, hidden: true }), undefined)
})

test("sameLocation normaliza rutas", () => {
  assert.equal(sameLocation("/tmp/proyecto", "/tmp/proyecto/"), true)
  assert.equal(sameLocation("/tmp/proyecto", "/tmp/otro"), false)
  assert.equal(sameLocation(undefined, "/tmp/proyecto"), false)
})

test("sameInstance acepta registros antiguos solo con el mismo PID", () => {
  assert.equal(sameInstance("123:456", "123:456"), true)
  assert.equal(sameInstance("123", "123:456"), true)
  assert.equal(sameInstance("123:1", "123:2"), false)
  assert.equal(sameInstance("123:1", "456:1"), false)
})

test("notificationID es estable, positivo y de 32 bits", () => {
  const first = notificationID("ses_abc123")
  assert.equal(first, notificationID("ses_abc123"))
  assert.ok(Number.isInteger(first))
  assert.ok(first > 0)
  assert.ok(first <= 0xffffffff)
  assert.notEqual(first, notificationID("ses_otra"))
})

test("selectLanguage detecta español y cae a inglés", () => {
  assert.equal(selectLanguage("es_ES.UTF-8"), "es")
  assert.equal(selectLanguage("ES"), "es")
  assert.equal(selectLanguage("en_US.UTF-8"), "en")
  assert.equal(selectLanguage(undefined), "en")
})

test("isCinnamon mira el escritorio y la sesión", () => {
  assert.equal(isCinnamon("X-Cinnamon", "cinnamon"), true)
  assert.equal(isCinnamon("GNOME", "gnome"), false)
  assert.equal(isCinnamon(undefined, undefined), false)
})

test("permissionDetail prefiere el mensaje y compone acción y recurso", () => {
  assert.equal(permissionDetail({ action: "bash", resources: ["git status"] }), "bash: git status")
  assert.equal(permissionDetail({ action: "bash", resources: [], message: "¿Ejecutar?" }), "¿Ejecutar?")
  assert.equal(permissionDetail({ action: "", resources: [] }), undefined)
})

test("terminalAttempts respeta $TERMINAL y usa las flags de cada terminal", () => {
  const command = ["opencode", "--session", "ses_1"]
  const withTerminal = terminalAttempts(command, "/tmp/proyecto", "kitty")
  assert.deepEqual(withTerminal[0], ["kitty", ["-e", ...command]])

  const withoutCwd = terminalAttempts(command, undefined, undefined)
  assert.deepEqual(withoutCwd[0], ["terminator", ["-x", ...command]])

  const withCwd = terminalAttempts(command, "/tmp/proyecto", undefined)
  assert.deepEqual(withCwd[0], ["terminator", ["--working-directory=/tmp/proyecto", "-x", ...command]])
  assert.ok(withCwd.some(([program, args]) => program === "kitty" && args[0] === "--directory"))
  assert.ok(withCwd.some(([program]) => program === "alacritty"))
  assert.ok(withCwd.some(([program, args]) => program === "wezterm" && args[0] === "start"))
})

test("opencodeExecutable solo confía en un execPath que sea OpenCode", () => {
  assert.equal(opencodeExecutable("/home/usuario/.opencode/bin/opencode"), "/home/usuario/.opencode/bin/opencode")
  assert.equal(opencodeExecutable("/usr/bin/node"), "opencode")
})
