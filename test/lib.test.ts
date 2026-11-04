import assert from "node:assert/strict"
import test from "node:test"
import {
  buildNotifyArgs,
  chooseBackend,
  chooseWindow,
  isCinnamon,
  notificationID,
  opencodeExecutable,
  parseHyprlandClient,
  parseHyprlandClients,
  parseSwayTree,
  parseWindows,
  permissionDetail,
  projectPrefixFor,
  sameInstance,
  sameLocation,
  sameWindowID,
  selectLanguage,
  splitCommand,
  terminalAttempts,
  truncate,
} from "../src/lib.ts"

test("truncate respeta el límite y añade elipsis", () => {
  assert.equal(truncate("hola", 10), "hola")
  assert.equal(truncate("  hola  ", 10), "hola")
  assert.equal(truncate("abcdefghij", 5), "abcd…")
  assert.equal(truncate("abcdef", 0), "abcdef")
  // No debe partir un par sustituto (emoji).
  assert.equal(truncate("😀😀😀", 2), "😀…")
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

  assert.deepEqual(parseHyprlandClients(clients), [{ id: "hypr:0xabc", pid: 100, title: "OC | Proyecto" }])
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
  const withTerminal = terminalAttempts(command, "/tmp/proyecto", "kitty --single-instance")
  assert.deepEqual(withTerminal[0], ["kitty", ["--single-instance", "-e", ...command]])

  const withoutTerminal = terminalAttempts(command, undefined, undefined)
  assert.deepEqual(withoutTerminal[0], ["xdg-terminal-exec", command])

  const withCwd = terminalAttempts(command, "/tmp/proyecto", undefined)
  const terminator = withCwd.find(([program]) => program === "terminator")
  assert.deepEqual(terminator, ["terminator", ["--working-directory=/tmp/proyecto", "-x", ...command]])
  assert.ok(withCwd.some(([program, args]) => program === "kitty" && args[0] === "--directory"))
  assert.ok(withCwd.some(([program]) => program === "alacritty"))
  assert.ok(withCwd.some(([program, args]) => program === "wezterm" && args[0] === "start"))
})

test("splitCommand separa programas y flags sin shell", () => {
  assert.deepEqual(splitCommand("kitty --single-instance"), ["kitty", "--single-instance"])
  assert.deepEqual(splitCommand('"/opt/My Terminal/bin/term" --flag'), ["/opt/My Terminal/bin/term", "--flag"])
  assert.deepEqual(splitCommand("   "), [])
})

test("projectPrefixFor no genera un prefijo vacío para la raíz", () => {
  assert.equal(projectPrefixFor("/tmp/proyecto", "/tmp/proyecto/"), "")
  assert.equal(projectPrefixFor("/tmp/proyecto", "/tmp/otro"), "proyecto · ")
  assert.equal(projectPrefixFor("/", "/tmp/otro"), "/ · ")
  assert.equal(projectPrefixFor(undefined, "/tmp/otro"), "")
})

test("buildNotifyArgs construye acciones, urgencia y reemplazo", () => {
  const base = {
    appName: "OpenCode",
    body: "Hola",
    urgency: "normal" as const,
    silent: false,
    icon: "utilities-terminal",
    cinnamon: false,
  }
  assert.deepEqual(buildNotifyArgs(base), [
    "--app-name=OpenCode",
    "--urgency=normal",
    "--icon=utilities-terminal",
    "OpenCode",
    "Hola",
  ])

  const critical = buildNotifyArgs({ ...base, urgency: "critical" })
  assert.ok(critical.includes("--urgency=critical"))
  assert.ok(critical.includes("--expire-time=0"))
  assert.ok(critical.includes("--hint=boolean:resident:true"))

  const cinnamon = buildNotifyArgs({ ...base, urgency: "critical", cinnamon: true })
  assert.ok(cinnamon.includes("--urgency=normal"))
  assert.ok(cinnamon.includes("--hint=boolean:resident:true"))

  const actions = buildNotifyArgs({
    ...base,
    labels: { open: "Abrir", dismiss: "Descartar" },
    replaceID: 42,
    silent: true,
  })
  assert.ok(actions.includes("--replace-id=42"))
  assert.ok(actions.includes("--hint=boolean:suppress-sound:true"))
  assert.ok(actions.includes("--action=default=Abrir"))
  assert.ok(actions.includes("--action=dismiss=Descartar"))
  assert.ok(actions.includes("--wait"))
})

test("chooseWindow prioriza título, preferencia, activa y fallback", () => {
  const sameID = (left?: string, right?: string) => left === right
  const windows = [
    { id: "a", pid: 10, title: "OC | Otra" },
    { id: "b", pid: 10, title: "OC | Sesión" },
    { id: "c", pid: 20, title: "Otra ventana" },
  ]

  assert.equal(chooseWindow({ ancestors: [10], windows, expectedTitle: "OC | Sesión", sameID })?.id, "b")
  assert.equal(chooseWindow({ ancestors: [10], windows, expectedTitle: "OC | Otra", sameID })?.id, "a")
  assert.equal(chooseWindow({ ancestors: [10], windows, activeID: "c", sameID })?.id, "a")
  assert.equal(chooseWindow({ ancestors: [10], windows, preferredTitle: "OC | Sesión", sameID })?.id, "b")
  assert.equal(chooseWindow({ ancestors: [20], windows, sameID })?.id, "c")
  assert.equal(chooseWindow({ ancestors: [99], windows, sameID }), undefined)

  const duplicates = [
    { id: "a", pid: 10, title: "OC" },
    { id: "b", pid: 10, title: "OC" },
  ]
  assert.equal(
    chooseWindow({ ancestors: [10], windows: duplicates, expectedTitle: "OC", activeID: "b", sameID })?.id,
    "b",
  )
})

test("chooseBackend elige Hyprland, sway o X11", () => {
  assert.deepEqual(chooseBackend({ platform: "darwin", display: ":0" }), [])
  assert.deepEqual(chooseBackend({ platform: "linux", display: ":0" }), ["x11"])
  assert.deepEqual(
    chooseBackend({
      platform: "linux",
      xdgSessionType: "wayland",
      swaySocket: "/run/sway",
      display: ":0",
    }),
    ["sway", "x11"],
  )
  assert.deepEqual(
    chooseBackend({
      platform: "linux",
      waylandDisplay: "wayland-1",
      hyprlandSignature: "sig",
      swaySocket: "/run/sway",
      display: ":0",
    }),
    ["hyprland", "sway", "x11"],
  )
  assert.deepEqual(chooseBackend({ platform: "linux", xdgSessionType: "wayland" }), [])
})

test("opencodeExecutable solo confía en un execPath que sea OpenCode", () => {
  assert.equal(opencodeExecutable("/home/usuario/.opencode/bin/opencode"), "/home/usuario/.opencode/bin/opencode")
  assert.equal(opencodeExecutable("/usr/bin/node"), "opencode")
})
