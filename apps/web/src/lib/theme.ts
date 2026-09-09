export type Theme = 'light' | 'dark'

const STORAGE_KEY = 'deskroute-theme'

export function getInitialTheme(): Theme {
  const saved = window.localStorage.getItem(STORAGE_KEY)
  if (saved === 'light' || saved === 'dark') return saved
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')
  document.documentElement.dataset.theme = theme
  document.documentElement.style.colorScheme = theme
}

export function saveTheme(theme: Theme) {
  window.localStorage.setItem(STORAGE_KEY, theme)
  applyTheme(theme)
}
