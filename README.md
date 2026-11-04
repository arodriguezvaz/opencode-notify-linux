# opencode-notify-linux

Notificaciones de escritorio para **OpenCode TUI** en Linux. Avisa cuando una sesión termina, falla, necesita un permiso o espera una respuesta. Al pulsar la notificación, intenta volver a la ventana de OpenCode correspondiente.

> Native Linux desktop notifications for the OpenCode TUI, with click-to-focus and click-to-reopen support.

[![CI](https://github.com/arodriguezvaz/opencode-notify-linux/actions/workflows/ci.yml/badge.svg)](https://github.com/arodriguezvaz/opencode-notify-linux/actions/workflows/ci.yml)

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
- **No molesta si ya estás delante**: si la ventana de la TUI que aloja la sesión está enfocada, no muestra el aviso (`onlyWhenUnfocused`). Se refiere al foco de la terminal, no a si la sesión está visible.
- **Silenciosas por defecto**: OpenCode ya reproduce sus propios sonidos; la notificación de Linux no los duplica.
- **Reemplaza el aviso anterior del mismo tipo de evento** en vez de apilar notificaciones de la misma sesión.
- **Prefijo de proyecto** (`mi-proyecto · …`) cuando la sesión pertenece a otro directorio.
- **Detalle del permiso**: muestra la acción y el recurso solicitado (por ejemplo `bash: git status`).
- **Español e inglés** según el locale, o forzado con la opción `language`.
- **Wayland**: enfoque de ventanas en sway (`swaymsg`) e Hyprland (`hyprctl`), además de X11.
- **Abrir o descartar**: dos acciones en la propia notificación.
- **Fallback integrado**: si no existe `notify-send` o falla, usa las notificaciones de atención de OpenCode.
- **Comandos externos con timeout**: `wmctrl`, `xprop`, `swaymsg` y `hyprctl` no pueden bloquear la notificación.

## Al pulsar una notificación

- Si la TUI que abrió el turno sigue viva, trae al frente su ventana.
- Si se ha cerrado, intenta abrir una terminal nueva en el directorio del proyecto y recuperar la sesión con `opencode --session <id>`.
- Si no encuentra una terminal compatible, pregunta si quieres abrir la sesión en la terminal actual.
- Si no puede enfocar ni reabrir, cambia a la vista de la sesión en la TUI actual.
- También puedes **descartar** la notificación sin abrir nada.

Se admiten Terminator, GNOME Terminal, Konsole, XFCE Terminal, Kitty, Alacritty, WezTerm, Foot, `xdg-terminal-exec`, `x-terminal-emulator`, `xterm` y `$TERMINAL` (incluido con flags, por ejemplo `kitty --single-instance`).

## Requisitos

- Linux con X11 o Wayland (sway/Hyprland) para poder enfocar ventanas.
- OpenCode v2 (probado con 2.2.5).
- `notify-send` siempre; en X11, `wmctrl` y `xprop`; en sway, `swaymsg`; en Hyprland, `hyprctl`. `xdg-terminal-exec` es opcional para reabrir con la terminal predeterminada del escritorio.

En Debian o Ubuntu:

```bash
sudo apt install libnotify-bin wmctrl x11-utils
```

Las acciones al hacer clic y el reemplazo de notificaciones necesitan libnotify 0.7.9 o superior. En versiones anteriores el aviso se muestra igualmente, pero el clic no abre la sesión. Si no hay `notify-send`, el plugin recurre a las notificaciones integradas de OpenCode (sin enfoque de ventana).

Probado en Cinnamon con Terminator. En Wayland el backend se elige por entorno: Hyprland si existe `HYPRLAND_INSTANCE_SIGNATURE`, sway si existe `SWAYSOCK`, y X11 (incluido XWayland) como último recurso. Los backends de sway e Hyprland están implementados y sus parsers testeados, pero no se han verificado en una sesión real de esos compositores.

GNOME y KDE Wayland no ofrecen una forma fiable de enfocar ventanas por CLI, así que ahí el enfoque puede no funcionar; las notificaciones sí siguen apareciendo. macOS y Windows no están soportados: usa las notificaciones integradas de OpenCode.

## Instalación

Clona el repositorio en el directorio de plugins global de OpenCode:

```bash
git clone https://github.com/arodriguezvaz/opencode-notify-linux.git \
  ~/.config/opencode/plugins/opencode-notify-linux
```

OpenCode descubre los plugins de ese directorio automáticamente y carga el entrypoint `./tui` declarado en `package.json`. **No hace falta compilarlo ni instalar dependencias** para utilizarlo.

Para actualizarlo:

```bash
git -C ~/.config/opencode/plugins/opencode-notify-linux pull
```

## Configuración

Sin opciones funciona directamente. Si quieres cambiar algo, añade el plugin con la forma de objeto en `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    {
      "package": "./plugins/opencode-notify-linux",
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

La ruta es relativa a `~/.config/opencode`. Añadir esta entrada no duplica el plugin: OpenCode lo sigue cargando una sola vez.

| Opción | Por defecto | Descripción |
| --- | --- | --- |
| `language` | `"auto"` | `"auto"`, `"es"` o `"en"`. |
| `onlyWhenUnfocused` | `true` | No notificar si la ventana de la TUI está enfocada (no si la sesión está visible). |
| `silent` | `true` | Silenciar el sonido del sistema; OpenCode ya suena. |
| `appName` | `"OpenCode"` | Nombre de la aplicación en la notificación. |
| `icon` | icono de OpenCode | Ruta a un icono propio (admite `~`). |
| `debug` | `false` | Escribir el registro de diagnóstico (contiene session IDs y rutas). |
| `maxBodyLength` | `180` | Recorte del cuerpo (40–1000 caracteres). |
| `replaceNotifications` | `true` | Reemplazar el aviso anterior del mismo tipo de evento. |
| `events` | todos `true` | Activar o desactivar `succeeded`, `failed`, `permission` y `form`. |

El icono por defecto se lee de `~/.config/opencode/icons/opencode.png`; si no existe se usa el icono del tema.

## Cómo funciona

1. Cada TUI recibe los eventos del servidor. Para no duplicar avisos, la primera que reclama el evento crea un marcador atómico en el directorio de estado (`writeFileSync` con `wx`).
2. Gana la TUI que inició el turno; después la que tiene la sesión abierta y su ventana enfocada; luego la del mismo directorio; finalmente cualquiera.
3. Al pulsar «Abrir», se busca la ventana subiendo por los procesos padre (`/proc`) y se enfoca con el backend activo (X11, sway o Hyprland). Si la ventana ya no existe, se abre una terminal nueva en el proyecto.
4. El estado es privado: el directorio se crea con permisos `0700`, los ficheros con `0600`, y los marcadores caducan a las 24 horas. El log se recorta a 256 KiB.

## Solución de problemas

El registro está desactivado por defecto. Actívalo con `"debug": true` en las opciones. Se guarda en:

```text
$XDG_RUNTIME_DIR/opencode-notify-linux/debug.log      # normalmente
$XDG_STATE_HOME/opencode-notify-linux/debug.log        # sin runtime dir
~/.local/state/opencode-notify-linux/debug.log         # sin XDG_STATE_HOME
```

El directorio es `0700` y el fichero `0600`. Contiene session IDs y rutas de proyectos: revísalo y redáctalo antes de compartirlo. Ahí se ve qué instancia reclamó cada evento, qué backend se seleccionó (`window backend=…`) y si se abrió una terminal nueva.

Comprobaciones habituales:

```bash
# ¿Llegan las notificaciones?
notify-send "Prueba" "Si ves esto, notify-send funciona"

# ¿Soporta acciones y reemplazo?
notify-send --help | grep -E -- '--action|--replace-id'

# X11: ¿se detecta la ventana?
wmctrl -lpx
xprop -root _NET_ACTIVE_WINDOW

# Wayland: backend detectado y ventanas disponibles
echo "$XDG_SESSION_TYPE · $SWAYSOCK · $HYPRLAND_INSTANCE_SIGNATURE"
swaymsg -t get_tree -r    # sway
hyprctl clients -j        # Hyprland

# ¿Está cargado el plugin?
opencode plugin list
```

Si usas GNOME o KDE en Wayland, el enfoque de ventanas puede no funcionar; las notificaciones sí pueden seguir apareciendo. El registro de depuración indica qué backend se seleccionó (`window backend=…`).

## Desarrollo

Solo para desarrollo; para usar el plugin no necesitas Node ni ningún gestor de paquetes.

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run format   # opcional, aplica Biome
```

El código está separado en `src/tui.ts` (cableado y sesiones), `src/lib.ts` (helpers puros), `src/windows.ts` (backends y caché de ventanas), `src/notifier.ts` (`notify-send`), `src/runtime.ts` (estado y log), `src/terminal.ts` (reapertura), `src/messages.ts` y `src/options.ts`.

Los 31 tests cubren parsers de X11/sway/Hyprland, la prioridad de ventanas, los argumentos de `notify-send`, las opciones, los textos y los permisos/symlinks del directorio de estado. No requiere build: OpenCode ejecuta el TypeScript tal cual.

## Seguridad y contribuciones

- Para vulnerabilidades, usa [Security Advisories](https://github.com/arodriguezvaz/opencode-notify-linux/security/advisories/new) y no un issue público. Consulta [SECURITY.md](SECURITY.md).
- Para desarrollo, tests y PRs, consulta [CONTRIBUTING.md](CONTRIBUTING.md).

## Licencia

[MIT](LICENSE) © Andrés Rodríguez Vázquez
