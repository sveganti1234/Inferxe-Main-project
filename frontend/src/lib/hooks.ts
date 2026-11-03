import { useEffect, useState } from 'react'

/** Sets <title> and meta description per route. */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title === 'Home' ? 'Inferxe — One API, many GPU providers' : `${title} — Inferxe`
    if (description) {
      let m = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      if (!m) {
        m = document.createElement('meta')
        m.name = 'description'
        document.head.appendChild(m)
      }
      m.content = description
    }
  }, [title, description])
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches))
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setMatch(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}

/** Lightweight copy-to-clipboard with transient "copied" flag. */
export function useCopy(timeout = 1600) {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), timeout)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }
  return { copied, copy }
}
