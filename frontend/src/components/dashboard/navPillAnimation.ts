/**
 * Nav Pill Animation Engine — Unified Position-Based Rounded Pill
 * 
 * Translates the active green pill smoothly between ALL navigation items
 * across both Administration and Provider Management groups using
 * hardware-accelerated transform: translate3d(x, y, 0).
 * 
 * Guarantees:
 * - Constant height and width matching the active menu item.
 * - Perfectly consistent rounded corners (no oval deformation).
 * - Smooth cubic-bezier(0.22, 1, 0.36, 1) position translation across sections.
 * - Single unified pill element across all sidebar navigation items.
 * - Seamless glide across group boundaries (e.g. Sovereign Nodes Map -> Provider Overview).
 * - Non-interrupting ResizeObserver guards (no stutter/mid-glide cancellation).
 * - Instant snap (transition: none) on initial mount only.
 */

export interface PillBounds {
  x: number
  y: number
  w: number
  h: number
}

interface PillElementWithState extends HTMLElement {
  __pillInitialized?: boolean
  __lastTarget?: PillBounds
  __isTransitioning?: boolean
  __transitionHandler?: (e: TransitionEvent) => void
}

export function animateNavPill(
  pillEl: HTMLElement | null,
  activeItemEl: HTMLElement | null | undefined,
  options: { animate?: boolean; radius?: number } = {}
) {
  if (!pillEl) return
  const parent = pillEl.parentElement
  if (!activeItemEl || !activeItemEl.offsetWidth || !parent) {
    pillEl.style.opacity = '0'
    return
  }

  const { animate = true, radius = 9999 } = options
  const parentRect = parent.getBoundingClientRect()
  const itemRect = activeItemEl.getBoundingClientRect()

  const targetX = Math.round(itemRect.left - parentRect.left)
  const targetY = Math.round(itemRect.top - parentRect.top)
  const targetW = Math.round(itemRect.width)
  const targetH = Math.round(itemRect.height)

  const pillState = pillEl as PillElementWithState
  const prefersReduced =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const isFirstRun = !pillState.__pillInitialized
  const isHidden = pillEl.style.opacity === '0'

  const last = pillState.__lastTarget
  const isSameTarget =
    last &&
    Math.abs(last.x - targetX) < 1 &&
    Math.abs(last.y - targetY) < 1 &&
    Math.abs(last.w - targetW) < 1 &&
    Math.abs(last.h - targetH) < 1

  // If animate=false is called (e.g. from ResizeObserver during navigation)
  // and the target is identical and the pill is already in motion, do NOT interrupt the glide!
  if (!animate && isSameTarget && pillState.__isTransitioning) {
    return
  }

  // Bind transitionend & transitioncancel listeners once to track when active motion completes
  if (!pillState.__transitionHandler) {
    pillState.__transitionHandler = (e: TransitionEvent) => {
      if (e.target === pillEl && e.propertyName === 'transform') {
        pillState.__isTransitioning = false
      }
    }
    pillEl.addEventListener('transitionend', pillState.__transitionHandler)
    pillEl.addEventListener('transitioncancel', pillState.__transitionHandler)
  }

  // If the pill is already visible at this exact target, avoid setting __isTransitioning
  // since CSS won't fire transitionend when transform does not change
  if (animate && isSameTarget && !isHidden && !isFirstRun) {
    pillEl.style.opacity = '1'
    return
  }

  // Apply dimensions & border radius
  pillEl.style.borderRadius = `${radius}px`
  pillEl.style.width = `${targetW}px`
  pillEl.style.height = `${targetH}px`

  if (!animate || prefersReduced || isFirstRun) {
    // If a glide is already in progress, do not abruptly kill it with transition: none!
    if (!prefersReduced && !isFirstRun && pillState.__isTransitioning) {
      pillEl.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
      pillState.__lastTarget = { x: targetX, y: targetY, w: targetW, h: targetH }
      return
    }

    // Instant snap without transition on initial mount
    pillEl.style.setProperty('transition', 'none', 'important')
    pillEl.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
    pillEl.style.opacity = '1'
    pillState.__pillInitialized = true
    pillState.__isTransitioning = false
    pillState.__lastTarget = { x: targetX, y: targetY, w: targetW, h: targetH }

    // Reflow to flush styles so subsequent animated changes animate properly
    void pillEl.offsetHeight
    pillEl.style.removeProperty('transition')
  } else if (isHidden) {
    // If pill was previously hidden (e.g. returning from non-sidebar route),
    // position it at the target instantly before fading in so it doesn't fly from far away
    pillEl.style.setProperty('transition', 'none', 'important')
    pillEl.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
    void pillEl.offsetHeight
    pillEl.style.removeProperty('transition')
    pillEl.style.opacity = '1'
    pillState.__pillInitialized = true
    pillState.__isTransitioning = false
    pillState.__lastTarget = { x: targetX, y: targetY, w: targetW, h: targetH }
  } else {
    // Smooth GPU-accelerated position translation with natural easing across ALL items and groups!
    pillEl.style.removeProperty('transition')
    pillEl.style.opacity = '1'
    pillEl.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
    pillState.__isTransitioning = true
    pillState.__pillInitialized = true
    pillState.__lastTarget = { x: targetX, y: targetY, w: targetW, h: targetH }
  }
}
