import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

// Used by GPU marketplace and LLM catalog cards: wrap the card in <div className="cx-tilt" {...useTilt()}>.
/** Cursor-following 3D tilt: writes CSS vars on the (untransformed) wrapper, CSS does the rest. Mouse only. */
export function useTilt() {
  const frame = useRef(0)
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== 'mouse') return
    const el = e.currentTarget
    const { clientX, clientY } = e
    cancelAnimationFrame(frame.current)
    frame.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect()
      const x = Math.min(1, Math.max(0, (clientX - r.left) / r.width))
      const y = Math.min(1, Math.max(0, (clientY - r.top) / r.height))
      el.style.setProperty('--tilt-x', `${((0.5 - y) * 12).toFixed(2)}deg`)
      el.style.setProperty('--tilt-y', `${((x - 0.5) * 14).toFixed(2)}deg`)
      el.style.setProperty('--glare-x', `${(x * 100).toFixed(1)}%`)
      el.style.setProperty('--glare-y', `${(y * 100).toFixed(1)}%`)
      // border glow: 1 on the edge, 0 once the cursor is 30% of the card inward from the nearest edge
      el.style.setProperty('--edge', Math.max(0, 1 - Math.min(x, 1 - x, y, 1 - y) / 0.3).toFixed(3))
      el.dataset.tilting = 'true'
    })
  }
  const onPointerLeave = (e: ReactPointerEvent<HTMLDivElement>) => {
    cancelAnimationFrame(frame.current)
    const el = e.currentTarget
    delete el.dataset.tilting
    el.style.removeProperty('--tilt-x')
    el.style.removeProperty('--tilt-y')
    el.style.removeProperty('--edge')
  }
  return { onPointerMove, onPointerLeave }
}
