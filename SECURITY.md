# Seguridad

## Versiones soportadas

La última versión etiquetada (`v*`) recibe correcciones. Al ser un plugin pequeño no se mantienen ramas de versiones anteriores.

## Cómo reportar una vulnerabilidad

No abras un issue público. Usa la pestaña **Security → Report a vulnerability** del repositorio:

https://github.com/arodriguezvaz/opencode-notify-linux/security/advisories/new

Incluye, si puedes:

- Versión de OpenCode (`opencode --version`).
- Distribución y escritorio (Cinnamon, GNOME, KDE, sway, Hyprland…).
- Tipo de sesión (X11 o Wayland).
- Pasos para reproducirlo.
- El `debug.log` **redactado**: quita session IDs, rutas de proyectos y cualquier comando que pueda contener secretos.

No publiques tokens, claves SSH, rutas personales ni el contenido de tus conversaciones.
