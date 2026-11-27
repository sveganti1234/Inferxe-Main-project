import { useEffect, useRef } from 'react'

interface NodePoint {
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  phase: number
}

interface PulsePacket {
  from: number
  to: number
  t: number
  speed: number
}

/**
 * Lightweight ambient GPU-routing constellation canvas for the centered hero backdrop.
 * Stays ultra-subtle behind the typography and automatically pauses for reduced motion.
 */
export function HeroBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const reducedMotion =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let dpr = 1
    let rafId = 0
    const mouse = { x: -9999, y: -9999, active: false }

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    resize()

    const nodeCount = width < 640 ? 22 : 40
    const nodes: NodePoint[] = Array.from({ length: nodeCount }, (_, i) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.24,
      radius: 1.2 + (i % 3) * 0.55,
      phase: Math.random() * Math.PI * 2,
    }))

    const pulses: PulsePacket[] = []
    let lastPulseSpawn = 0

    const maxLinkDist = width < 640 ? 125 : 165

    const drawFrame = (now: number) => {
      ctx.clearRect(0, 0, width, height)

      if (!reducedMotion) {
        for (const n of nodes) {
          n.x += n.vx
          n.y += n.vy
          n.phase += 0.015

          if (mouse.active) {
            const dx = mouse.x - n.x
            const dy = mouse.y - n.y
            const distSq = dx * dx + dy * dy
            if (distSq > 100 && distSq < 36000) {
              n.x += dx * 0.0022
              n.y += dy * 0.0022
            }
          }

          if (n.x < -20) n.x = width + 20
          if (n.x > width + 20) n.x = -20
          if (n.y < -20) n.y = height + 20
          if (n.y > height + 20) n.y = -20
        }
      }

      // Faint routing connections between nearby nodes
      const pairs: Array<[number, number]> = []
      for (let i = 0; i < nodes.length; i += 1) {
        for (let j = i + 1; j < nodes.length; j += 1) {
          const dx = nodes[i].x - nodes[j].x
          const dy = nodes[i].y - nodes[j].y
          const dist = Math.hypot(dx, dy)
          if (dist < maxLinkDist) {
            const strength = 1 - dist / maxLinkDist
            ctx.strokeStyle = `rgba(110, 224, 161, ${(strength * 0.14).toFixed(3)})`
            ctx.lineWidth = 0.8
            ctx.beginPath()
            ctx.moveTo(nodes[i].x, nodes[i].y)
            ctx.lineTo(nodes[j].x, nodes[j].y)
            ctx.stroke()
            pairs.push([i, j])
          }
        }
      }

      // Occasional glowing routing packet gliding along a live connection
      if (!reducedMotion && pairs.length > 0 && now - lastPulseSpawn > 950 && pulses.length < 6) {
        const [from, to] = pairs[Math.floor(Math.random() * pairs.length)]
        pulses.push({ from, to, t: 0, speed: 0.012 + Math.random() * 0.01 })
        lastPulseSpawn = now
      }

      for (let i = pulses.length - 1; i >= 0; i -= 1) {
        const p = pulses[i]
        p.t += p.speed
        if (p.t >= 1) {
          pulses.splice(i, 1)
          continue
        }
        const a = nodes[p.from]
        const b = nodes[p.to]
        const px = a.x + (b.x - a.x) * p.t
        const py = a.y + (b.y - a.y) * p.t
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 7)
        glow.addColorStop(0, 'rgba(140, 234, 182, 0.78)')
        glow.addColorStop(0.5, 'rgba(110, 224, 161, 0.28)')
        glow.addColorStop(1, 'rgba(85, 207, 140, 0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(px, py, 7, 0, Math.PI * 2)
        ctx.fill()
      }

      // Draw subtle compute nodes
      for (const n of nodes) {
        const pulseAlpha = 0.16 + 0.14 * Math.sin(n.phase)
        ctx.fillStyle = `rgba(140, 234, 182, ${pulseAlpha.toFixed(3)})`
        ctx.beginPath()
        ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2)
        ctx.fill()
      }

      if (!reducedMotion) {
        rafId = window.requestAnimationFrame(drawFrame)
      }
    }

    const onPointerMove = (e: PointerEvent) => {
      const rect = canvas.getBoundingClientRect()
      mouse.x = e.clientX - rect.left
      mouse.y = e.clientY - rect.top
      mouse.active = true
    }

    const onPointerLeave = () => {
      mouse.active = false
    }

    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave)

    rafId = window.requestAnimationFrame(drawFrame)

    return () => {
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [])

  return (
    <div className="hero__backdrop" aria-hidden="true">
      <div className="hero__aurora hero__aurora--a" />
      <div className="hero__aurora hero__aurora--b" />
      <div className="hero__beam" />
      <canvas ref={canvasRef} className="hero__canvas" />
    </div>
  )
}
