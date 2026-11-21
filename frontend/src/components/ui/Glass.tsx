import { useRef, type ElementType, type HTMLAttributes, type MouseEvent, type ReactNode } from 'react'

interface GlassProps extends HTMLAttributes<HTMLElement> {
  as?: ElementType
  lift?: boolean
  variant?: 'default' | 'deep' | 'lime'
  radius?: 's' | 'm' | 'l'
  children?: ReactNode
}

/**
 * Glassmorphic surface. Tracks the cursor to drive a soft green spotlight
 * (--mx / --my) without triggering React re-renders.
 */
export function Glass({
  as: Tag = 'div',
  lift = false,
  variant = 'default',
  radius = 'l',
  className = '',
  children,
  onMouseMove,
  ...rest
}: GlassProps) {
  const ref = useRef<HTMLElement>(null)

  const handleMove = (e: MouseEvent<HTMLElement>) => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      el.style.setProperty('--mx', `${e.clientX - r.left}px`)
      el.style.setProperty('--my', `${e.clientY - r.top}px`)
    }
    onMouseMove?.(e)
  }

  const cls = [
    'glass',
    lift && 'glass--lift',
    variant === 'deep' && 'glass--deep',
    variant === 'lime' && 'glass--lime',
    radius === 'm' && 'glass--m',
    radius === 's' && 'glass--s',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <Tag ref={ref} className={cls} onMouseMove={handleMove} {...rest}>
      {children}
    </Tag>
  )
}

/** Brushed-metal plate with four screws. */
export function Plate({
  className = '',
  dark = false,
  children,
  screws = true,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { dark?: boolean; screws?: boolean }) {
  return (
    <div className={`plate ${dark ? 'plate--dark' : ''} ${className}`} {...rest}>
      {screws && (
        <>
          <i className="screw screw--tl" aria-hidden />
          <i className="screw screw--tr" aria-hidden />
          <i className="screw screw--bl" aria-hidden />
          <i className="screw screw--br" aria-hidden />
        </>
      )}
      {children}
    </div>
  )
}
