# Changelog

## 1.3.0

- Timeouts en los comandos externos para que un `wmctrl`/`xprop`/`swaymsg`/`hyprctl` colgado no suprima la notificación.
- Directorio de estado privado (`0700`), ficheros `0600` y protección contra symlinks; el fallback ya no usa `/tmp`.
- El log de depuración se desactiva por defecto y deja de borrarse con los marcadores.
- IDs de reemplazo por tipo de evento para no ocultar un permiso pendiente.
- Fallback a las notificaciones de atención cuando `notify-send` falla, no solo cuando falta.
- Reintento y plan B al enfocar: si el ID es de otro backend o la ventana desapareció, se navega a la sesión.
- Caché de ventanas y ancestros, y eliminación de la doble comprobación de foco.
- `xdg-terminal-exec` y `$TERMINAL` con flags.
- `truncate` seguro con emojis y prefijo correcto para el directorio raíz.
- Tests (31), Biome, CI en Node 20/22/24, Dependabot y guías de seguridad/contribución.

## 1.2.0

- Enfoque de ventanas en Wayland para sway (`swaymsg`) e Hyprland (`hyprctl`), con X11 como fallback.
- Acciones «Abrir» y «Descartar» en la notificación.

## 1.1.0

- No notificar cuando la terminal de la sesión ya está enfocada (`onlyWhenUnfocused`).
- Mostrar la acción y el recurso de las solicitudes de permiso, y el título del formulario.
- Opciones de configuración: idioma, silencio, icono, eventos, longitud y depuración.
- Directorio de estado por usuario (`XDG_RUNTIME_DIR` o `/tmp` con UID).
- Reemplazo de notificaciones por sesión con `--replace-id`.
- Urgencia crítica real fuera de Cinnamon.
- Compatibilidad con más terminales y con `$TERMINAL`.
- Fallback a las notificaciones de atención de OpenCode sin `notify-send`.
- Textos en español e inglés.
- Tests, typecheck y CI.

## 1.0.0

- Primera versión: notificaciones al terminar, fallar, pedir permiso o pedir respuesta.
- Enfoque de la ventana al pulsar la notificación y reapertura en una terminal nueva.
- Reclamo atómico de eventos entre varias instancias de la TUI.
