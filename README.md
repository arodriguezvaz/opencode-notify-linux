# opencode-notify-linux

Notificaciones de escritorio nativas para **OpenCode TUI** en Linux. Te avisa cuando una sesión termina, falla, pide un permiso o espera una respuesta, y al pulsar la notificación te lleva a la ventana correcta.

> Native Linux desktop notifications for the OpenCode TUI, with click-to-focus and click-to-reopen support.

## Qué notifica

| Evento | Notificación | Urgencia |
| --- | --- | --- |
| La sesión termina correctamente | `Sesión completada: <título>` | normal |
| La sesión falla | El mensaje de error | crítica (permanece visible) |
| OpenCode pide un permiso | `Se requiere tu permiso en <título>` | crítica (permanece visible) |
| OpenCode espera una respuesta (formulario) | `Se requiere tu respuesta en <título>` | normal |

Las sesiones de subagentes se ignoran: solo se notifica la sesión principal.

## Al pulsar la notificación

- Si la terminal que abrió el turno sigue viva, se trae al frente esa ventana (aunque haya cambiado el título de la sesión).
- Si la ventana ya no existe, abre una terminal nueva en el directorio del proyecto y retoma la sesión con `opencode --session <id>`.
- Si no encuentra ninguna terminal compatible, pregunta si quieres abrir la sesión en la terminal actual.

Se admiten Terminator, GNOME Terminal y `x-terminal-emulator` (el primero que esté instalado).

## Características

- **Una sola notificación por evento** aunque tengas varias instancias de la TUI abiertas: el evento se reclama de forma atómica con un fichero marcador.
- **Prioridad al cliente correcto**: gana la TUI que inició el turno; después la que tiene la sesión abierta y está enfocada.
- **Prefijo de proyecto** (`mi-proyecto · ...`) cuando la sesión pertenece a un directorio distinto del actual.
- **Silenciosas**: OpenCode ya reproduce sus propios sonidos, así que la notificación de Linux no duplica el aviso.
- **Críticas residentes**: los errores y las peticiones de permiso no desaparecen solos.
- **Icono opcional** en `~/.config/opencode/icons/opencode.png`; si no existe se usa el icono del tema.

## Requisitos

- Linux con **X11** (`wmctrl` y `xprop` no funcionan en Wayland nativo).
- OpenCode **v2**.
- `notify-send` (paquete `libnotify-bin` en Debian/Ubuntu).
- `wmctrl` y `xprop` para enfocar la ventana.
- Opcional: `terminator`, `gnome-terminal` o `x-terminal-emulator` para reabrir sesiones cerradas.

```bash
sudo apt install libnotify-bin wmctrl x11-utils
```

Probado en Cinnamon con Terminator. Debería funcionar en GNOME, KDE, XFCE y la mayoría de terminales y editores (VS Code, JetBrains) porque la ventana se localiza recorriendo los procesos padre de la TUI.

## Instalación

Clona el repositorio dentro del directorio de plugins global de OpenCode:

```bash
git clone https://github.com/arodriguezvaz/opencode-notify-linux.git \
  ~/.config/opencode/plugins/opencode-notify-linux
```

OpenCode descubre los plugins de ese directorio automáticamente y carga el entrypoint `./tui` declarado en `package.json`. **No hace falta compilar ni ejecutar `npm install`**: OpenCode resuelve `@opencode/plugin/tui` en tiempo de ejecución y ejecuta el TypeScript directamente.

Si prefieres no clonar el repositorio, también puedes copiar solo `src/tui.ts` como `~/.config/opencode/plugins/desktop-notify/tui.ts`.

Para actualizar:

```bash
git -C ~/.config/opencode/plugins/opencode-notify-linux pull
```

Este paquete todavía no está publicado en npm. Cuando lo esté, bastará con añadirlo a `~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": ["opencode-notify-linux"]
}
```

## Configuración

No hay opciones obligatorias. Lo único configurable es el icono:

```bash
mkdir -p ~/.config/opencode/icons
cp mi-icono.png ~/.config/opencode/icons/opencode.png
```

## Solución de problemas

El plugin escribe un registro acotado (256 KiB) en:

```
/tmp/opencode-desktop-notify/debug.log
```

Ahí se ve qué instancia reclamó cada evento, qué ventana se detectó y si se abrió una terminal nueva. Los marcadores de eventos se guardan en el mismo directorio y se limpian a las 24 horas.

Comprobaciones habituales:

```bash
# ¿Llegan las notificaciones?
notify-send "Prueba" "Si ves esto, notify-send funciona"

# ¿Se detecta la ventana?
wmctrl -lpx
xprop -root _NET_ACTIVE_WINDOW
```

Si usas Wayland, el enfoque de ventanas no funcionará; las notificaciones sí pueden seguir apareciendo.

## Desarrollo

```bash
npm install
npm run typecheck
```

El código está en `src/tui.ts` y no requiere build: OpenCode ejecuta el TypeScript tal cual.

## Licencia

[MIT](LICENSE) © Andrés Rodríguez Vázquez
