import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'

/** The console ships a dark (forest) and a light theme. Only this UI preference is stored in the browser. */
export type ConsoleTheme = 'forest' | 'light'
const THEME_KEY = 'inferxe_console_theme_v1'

const isTheme = (value: unknown): value is ConsoleTheme => value === 'forest' || value === 'light'

function readTheme(): ConsoleTheme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    // 'graphite' was the previous second theme; its place on the toggle is now the light theme.
    if (stored === 'graphite') return 'light'
    return isTheme(stored) ? stored : 'forest'
  } catch {
    return 'forest'
  }
}

export function useConsoleTheme(): { theme: ConsoleTheme; toggleTheme: () => void } {
  const [theme, setTheme] = useState<ConsoleTheme>(readTheme)
  useEffect(() => {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // storage unavailable: the choice applies to this visit only
    }
  }, [theme])
  const toggleTheme = useCallback(() => {
    const flip = () => setTheme((t) => (t === 'forest' ? 'light' : 'forest'))
    // Crossfade with the browser's View Transitions API where available; otherwise (or with
    // reduced motion) switch instantly exactly as before.
    const doc = document as Document & { startViewTransition?: (update: () => void) => unknown }
    const reduce = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (typeof doc.startViewTransition !== 'function' || reduce) {
      flip()
      return
    }
    try {
      doc.startViewTransition(() => flushSync(flip))
    } catch {
      flip()
    }
  }, [])
  return { theme, toggleTheme }
}
