import { selectLanguage } from "./lib.ts"

export type Language = "es" | "en"
export type LanguageOption = "auto" | Language

export type Messages = {
  session: string
  completed: (title?: string) => string
  failedFallback: string
  permission: (sessionTitle: string | undefined, detail: string | undefined) => string
  form: (sessionTitle: string | undefined, formTitle: string | undefined) => string
  noWindowTitle: string
  noWindowMessage: (title: string) => string
  openHere: string
  cancel: string
  open: string
}

const spanish: Messages = {
  session: "Sesión",
  completed: (title) => (title ? `Sesión completada: ${title}` : "Sesión completada"),
  failedFallback: "La sesión terminó con un error",
  permission: (sessionTitle, detail) => {
    const base = sessionTitle ? `Se requiere tu permiso en ${sessionTitle}` : "Se requiere tu permiso"
    return detail ? `${base}\n${detail}` : base
  },
  form: (sessionTitle, formTitle) => {
    if (formTitle) return `Se requiere tu respuesta: ${formTitle}`
    return sessionTitle ? `Se requiere tu respuesta en ${sessionTitle}` : "Se requiere tu respuesta"
  },
  noWindowTitle: "Sesión sin ventana",
  noWindowMessage: (title) =>
    `«${title}» ya no tiene ventana abierta y no he podido abrir una nueva. ¿Abrirla en esta terminal?`,
  openHere: "Abrir aquí",
  cancel: "Cancelar",
  open: "Abrir",
}

const english: Messages = {
  session: "Session",
  completed: (title) => (title ? `Session completed: ${title}` : "Session completed"),
  failedFallback: "The session ended with an error",
  permission: (sessionTitle, detail) => {
    const base = sessionTitle ? `Permission required in ${sessionTitle}` : "Permission required"
    return detail ? `${base}\n${detail}` : base
  },
  form: (sessionTitle, formTitle) => {
    if (formTitle) return `Response required: ${formTitle}`
    return sessionTitle ? `Response required in ${sessionTitle}` : "Response required"
  },
  noWindowTitle: "Session without a window",
  noWindowMessage: (title) =>
    `“${title}” no longer has an open window and I couldn't open a new one. Open it in this terminal?`,
  openHere: "Open here",
  cancel: "Cancel",
  open: "Open",
}

export function messagesFor(language: Language): Messages {
  return language === "es" ? spanish : english
}

export function resolveLanguage(option: LanguageOption, locale: string | undefined): Language {
  return option === "auto" ? selectLanguage(locale) : option
}
