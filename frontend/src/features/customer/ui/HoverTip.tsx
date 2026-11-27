import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * One instant name tooltip for the whole console. Any element inside `.cx-app` opts in with
 * `data-tip="Label"` (and optionally `data-tip-side="right"`; the default is below the element).
 * Rendered on <body> with position: fixed because the console frame clips overflow.
 */
type Side = 'bottom' | 'right'
interface Tip {
  text: string
  side: Side
  x: number // anchor point: bottom → element's centre, right → element's right edge
  y: number
}

const GAP = 10
const EDGE = 8

function anchorFor(el: HTMLElement): Tip {
  const r = el.getBoundingClientRect()
  const side: Side = el.dataset.tipSide === 'right' ? 'right' : 'bottom'
  return side === 'right'
    ? { text: el.dataset.tip ?? '', side, x: r.right + GAP, y: r.top + r.height / 2 }
    : { text: el.dataset.tip ?? '', side, x: r.left + r.width / 2, y: r.bottom + GAP }
}

const target = (e: Event) => (e.target instanceof Element ? e.target.closest<HTMLElement>('.cx-app [data-tip]') : null)

export function HoverTip() {
  const [tip, setTip] = useState<Tip | null>(null)
  const [shift, setShift] = useState(0)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const show = (e: Event) => {
      const el = target(e)
      setTip(el && el.dataset.tip ? anchorFor(el) : null)
    }
    const hide = () => setTip(null)
    document.addEventListener('mouseover', show)
    document.addEventListener('focusin', show)
    document.addEventListener('focusout', hide)
    document.addEventListener('pointerdown', hide)
    window.addEventListener('scroll', hide, true)
    window.addEventListener('resize', hide)
    return () => {
      document.removeEventListener('mouseover', show)
      document.removeEventListener('focusin', show)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('pointerdown', hide)
      window.removeEventListener('scroll', hide, true)
      window.removeEventListener('resize', hide)
    }
  }, [])

  // Keep a below-the-element tooltip inside the viewport (e.g. the account button at the far right).
  useLayoutEffect(() => {
    if (!tip || tip.side !== 'bottom' || !ref.current) return setShift(0)
    const half = ref.current.offsetWidth / 2
    const min = EDGE + half
    const max = window.innerWidth - EDGE - half
    setShift(Math.min(Math.max(tip.x, min), max) - tip.x)
  }, [tip])

  if (!tip) return null
  return createPortal(
    <div
      ref={ref}
      className={`cx-hovertip cx-hovertip--${tip.side}`}
      role="tooltip"
      style={{ left: tip.x + shift, top: tip.y, ['--arrow-shift' as string]: `${-shift}px` }}
    >
      {tip.text}
    </div>,
    document.body,
  )
}
