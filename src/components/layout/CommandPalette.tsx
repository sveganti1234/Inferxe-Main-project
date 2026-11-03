import { AnimatePresence, motion } from 'framer-motion'
import { CornerDownLeft, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PAGE_INDEX } from '../../data/site'

/** Ctrl/⌘ + K quick navigation. */
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [idx, setIdx] = useState(0)
  const nav = useNavigate()
  const input = useRef<HTMLInputElement>(null)

  const results = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (!s) return PAGE_INDEX
    return PAGE_INDEX.filter((p) => p.title.toLowerCase().includes(s) || p.kw.includes(s))
  }, [q])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('inferxe:palette', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('inferxe:palette', onOpen)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setQ('')
      setIdx(0)
      window.setTimeout(() => input.current?.focus(), 30)
    }
  }, [open])

  useEffect(() => setIdx(0), [q])

  const go = (to: string) => {
    setOpen(false)
    nav(to)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="palette" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={() => setOpen(false)}>
          <motion.div
            className="palette__box glass glass--deep"
            role="dialog"
            aria-modal="true"
            aria-label="Search the site"
            initial={{ opacity: 0, y: -18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="palette__input">
              <Search aria-hidden />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a page…  try “pricing”, “h100”, “api”"
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), setIdx((i) => Math.min(i + 1, results.length - 1)))
                  if (e.key === 'ArrowUp') (e.preventDefault(), setIdx((i) => Math.max(i - 1, 0)))
                  if (e.key === 'Enter' && results[idx]) go(results[idx].to)
                }}
                aria-label="Search pages"
              />
              <kbd>Esc</kbd>
            </div>
            <ul className="palette__list">
              {results.length === 0 && <li className="palette__empty">No matching pages.</li>}
              {results.map((r, i) => (
                <li key={r.to}>
                  <button className={i === idx ? 'is-on' : ''} onMouseEnter={() => setIdx(i)} onClick={() => go(r.to)}>
                    <span>{r.title}</span>
                    <small>{r.to}</small>
                    {i === idx && <CornerDownLeft aria-hidden />}
                  </button>
                </li>
              ))}
            </ul>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
