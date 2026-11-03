# Changelog

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
- Tests, typecheck, CI y publicación con procedencia.

## 1.0.0

- Primera versión: notificaciones al terminar, fallar, pedir permiso o pedir respuesta.
- Enfoque de la ventana al pulsar la notificación y reapertura en una terminal nueva.
- Reclamo atómico de eventos entre varias instancias de la TUI.
