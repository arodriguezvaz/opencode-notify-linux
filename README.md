# opencode-notify-linux

Notificaciones de escritorio para **OpenCode TUI** en Linux. Avisa cuando una sesión termina, falla, necesita un permiso o espera una respuesta. Al pulsar la notificación, intenta volver a la ventana de OpenCode correspondiente.

> Native Linux desktop notifications for the OpenCode TUI, with click-to-focus and click-to-reopen support.

[![CI](https://github.com/arodriguezvaz/opencode-notify-linux/actions/workflows/ci.yml/badge.svg)](https://github.com/arodriguezvaz/opencode-notify-linux/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/opencode-notify-linux)](https://www.npmjs.com/package/opencode-notify-linux)

## Notificaciones

| Evento | Notificación | Urgencia |
| --- | --- | --- |
| Sesión completada | `Sesión completada: <título>` | Normal |
| Error | Mensaje de error | Crítica |
| Solicitud de permiso | `Se requiere tu permiso en <título>` + detalle | Crítica |
| Solicitud de respuesta | `Se requiere tu respuesta: <título del formulario>` | Normal |

Las sesiones de los subagentes se ignoran. Los errores y las solicitudes de permiso permanecen visibles hasta que se descartan en la mayoría de escritorios.

## Características

- **Una sola notificación por evento** aunque tengas varias TUI abiertas: el evento se reclama de forma atómica en disco.
- **No molesta si ya estás delante**: si la terminal que aloja la sesión está enfocada, no muestra el aviso (`onlyWhenUnfocused`).
- **Silenciosas por defecto**: OpenCode ya reproduce sus propios sonidos; la notificación de Linux no los duplica.
- **Reemplaza el aviso anterior** de la misma sesión en vez de apilar notificaciones.
- **Prefijo de proyecto** (`mi-proyecto · …`) cuando la sesión pertenece a otro directorio.
- **Detalle del permiso**: muestra la acción y el recurso solicitado (por ejemplo `bash: git status`).
- **Español e inglés** según el locale, o forzado con la opción `language`.
- **Fallback integrado**: si no existe `notify-send`, usa las notificaciones de atención de OpenCode.

## Al pulsar una notificación

- Si la TUI que abrió el turno sigue viva, trae al frente su ventana.
- Si se ha cerrado, intenta abrir una terminal nueva en el directorio del proyecto y recuperar la sesión con `opencode --session <id>`.
- Si no encuentra una terminal compatible, pregunta si quieres abrir la sesión en la terminal actual.

Se admiten Terminator, GNOME Terminal, Konsole, XFCE Terminal, Kitty, Alacritty, WezTerm, Foot, `x-terminal-emulator`, `xterm` y `$TERMINAL`.

## Requisitos

- Linux con X11 para poder enfocar ventanas.
- OpenCode v2.
- `notify-send`, `wmctrl` y `xprop`.

En Debian o Ubuntu:

```bash
sudo apt install libnotify-bin wmctrl x11-utils
```

Las acciones al hacer clic y el reemplazo de notificaciones necesitan libnotify 0.7.9 o superior. En versiones anteriores el aviso se muestra igualmente, pero el clic no abre la sesión. Si no hay `notify-send`, el plugin recurre a las notificaciones integradas de OpenCode (sin enfoque de ventana).

Probado en Cinnamon con Terminator. El enfoque de ventanas no funciona en Wayland nativo, aunque las notificaciones pueden seguir apareciendo.

## Instalación

### Desde npm (recomendado)

```bash
opencode plugin add opencode-notify-linux
```

Esto instala el paquete y lo añade a la configuración global. También puedes añadirlo a mano a `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": ["opencode-notify-linux"]
}
```

### Desde el repositorio

```bash
git clone https://github.com/arodriguezvaz/opencode-notify-linux.git \
  ~/.config/opencode/plugins/opencode-notify-linux
```

OpenCode descubre los plugins de ese directorio automáticamente y carga el entrypoint `./tui` declarado en `package.json`. **No hace falta compilarlo ni ejecutar `npm install`** para utilizarlo.

Para actualizarlo:

```bash
git -C ~/.config/opencode/plugins/opencode-notify-linux pull
```

## Configuración

Sin opciones funciona directamente. Si quieres cambiar algo, usa la forma de objeto en `cli.json` (o en `opencode.json`):

```jsonc
{
  "plugins": [
    {
      "package": "opencode-notify-linux",
      "options": {
        "onlyWhenUnfocused": true,
        "language": "es",
        "silent": false,
        "events": { "form": false }
      }
    }
  ]
}
```

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `language` | `"auto"` | `"auto"`, `"es"` o `"en"`. |
| `onlyWhenUnfocused` | `true` | No notificar si la ventana de la TUI está enfocada. |
| `silent` | `true` | Silenciar el sonido del sistema; OpenCode ya suena. |
| `appName` | `"OpenCode"` | Nombre de la aplicación en la notificación. |
| `icon` | icono de OpenCode | Ruta a un icono propio (admite `~`). |
| `debug` | `true` | Escribir el registro de diagnóstico. |
| `maxBodyLength` | `180` | Recorte del cuerpo (40–1000 caracteres). |
| `replaceNotifications` | `true` | Reemplazar el aviso anterior de la misma sesión. |
| `events` | todos `true` | Activar o desactivar `succeeded`, `failed`, `permission` y `form`. |

El icono por defecto se lee de `~/.config/opencode/icons/opencode.png`; si no existe se usa el icono del tema.

## Solución de problemas

El registro de depuración se guarda en:

```text
$XDG_RUNTIME_DIR/opencode-notify-linux/debug.log     # normalmente
/tmp/opencode-notify-linux-<uid>/debug.log           # sin XDG_RUNTIME_DIR
```

Ahí se ve qué instancia reclamó cada evento, qué ventana se detectó y si se abrió una terminal nueva.

Comprobaciones habituales:

```bash
# ¿Llegan las notificaciones?
notify-send "Prueba" "Si ves esto, notify-send funciona"

# ¿Soporta acciones y reemplazo?
notify-send --help | grep -E -- '--action|--replace-id'

# ¿Se detecta la ventana?
wmctrl -lpx
xprop -root _NET_ACTIVE_WINDOW

# ¿Está cargado el plugin?
opencode plugin list
```

Si usas Wayland, el enfoque de ventanas no funcionará; las notificaciones sí pueden seguir apareciendo.

## Desarrollo

```bash
npm install
npm run typecheck
npm test
```

El código está en `src/tui.ts`, con los helpers puros en `src/lib.ts`, los textos en `src/messages.ts` y las opciones en `src/options.ts`. No requiere build: OpenCode ejecuta el TypeScript tal cual.

## Licencia

[MIT](LICENSE) © Andrés Rodríguez Vázquez
