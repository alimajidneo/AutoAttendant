import { useEffect, useState } from 'react'
import { applyTheme, getInitialTheme, saveTheme, type Theme } from '@/lib/theme'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => getInitialTheme())

  function setTheme(next: Theme) {
    setThemeState(next)
    saveTheme(next)
  }

  useEffect(() => applyTheme(theme), [theme])
  return { theme, setTheme }
}
