# Contribuir

Gracias por dedicar tiempo al plugin. Es un proyecto personal, pero los issues y PRs son bienvenidos.

## Desarrollo

Requisitos: Node.js 20 o superior y npm.

```bash
npm ci
npm run lint
npm run typecheck
npm test
```

- `npm run format` aplica Biome.
- No hay build: OpenCode ejecuta el TypeScript de `src/` directamente.
- Los tests usan `node:test` con `tsx` y cubren los helpers puros.

## Estructura

- `src/tui.ts`: cableado del plugin, sesiones y prioridad de notificaciones.
- `src/lib.ts`: helpers puros (parsers, ventanas, argumentos de notify-send).
- `src/windows.ts`: backends X11/sway/Hyprland y caché de ventanas.
- `src/notifier.ts`: detección de capacidades y `notify-send`/attention.
- `src/runtime.ts`: directorio de estado, permisos, marcadores y log.
- `src/terminal.ts`: reapertura de sesiones en una terminal nueva.
- `src/messages.ts` / `src/options.ts`: textos y opciones.

Los textos visibles están en `src/messages.ts`; no añadas cadenas de UI en `tui.ts`.

## Cómo probar el plugin

Clona el repositorio dentro de la configuración global de OpenCode:

```bash
git clone https://github.com/arodriguezvaz/opencode-notify-linux.git \
  ~/.config/opencode/plugins/opencode-notify-linux
```

OpenCode lo descubre automáticamente. Para activar el log:

```jsonc
// ~/.config/opencode/cli.json
{
  "plugins": [
    {
      "package": "./plugins/opencode-notify-linux",
      "options": { "debug": true }
    }
  ]
}
```

El log está en `$XDG_RUNTIME_DIR/opencode-notify-linux/debug.log` (o en `$XDG_STATE_HOME` / `~/.local/state` si no hay runtime dir) y contiene session IDs y rutas: no lo adjuntes sin redactar.

## PRs

- Una rama por cambio, con un título claro.
- Ejecuta `npm run lint`, `npm run typecheck` y `npm test` antes de abrir el PR.
- Añade un test para cada helper puro nuevo.
- No subas `node_modules`, logs, `*.tgz` ni ficheros de configuración personal.
- Mantén los mensajes de UI en español e inglés en `src/messages.ts`.
