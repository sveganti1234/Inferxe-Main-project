import { useEffect, useRef, type RefObject } from 'react'

export type AdminSidebarSectionId = 'admin' | 'provider' | 'super-admin'

interface UseAdminSidebarKeyboardNavOptions {
  enabled: boolean
  sidebarRef: RefObject<HTMLElement | null>
  sidebarNavWrapRef: RefObject<HTMLElement | null>
  isMobile: boolean
  mobileMenuOpen: boolean
  isRailMode: boolean
  hasOpenPopover: boolean
  hasOpenFlyout: boolean
  currentPathname: string
  visibleSections: Record<AdminSidebarSectionId, boolean>
  onNavigate: (to: string) => void
  onOpenSection: (section: AdminSidebarSectionId) => void
  onCloseSection: (section: AdminSidebarSectionId) => void
  onCloseFlyout: () => void
  onCloseMobileMenu: () => void
}

function isEditableElement(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  const tag = el.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (el.isContentEditable) return true
  const role = el.getAttribute('role')
  if (role === 'textbox' || role === 'combobox' || role === 'searchbox') return true
  return Boolean(
    el.closest(
      '[contenteditable="true"], .admin-search-wrap.is-open, .palette, [role="dialog"], [aria-modal="true"]'
    )
  )
}

function isBlockingOverlayOpen(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(
    document.querySelector(
      '.admin-search-wrap.is-open, .palette, [role="dialog"][aria-modal="true"]'
    )
  )
}

function isSectionId(val: string | undefined): val is AdminSidebarSectionId {
  return val === 'admin' || val === 'provider' || val === 'super-admin'
}

function isElementVisibleAndInteractive(
  el: HTMLElement,
  visibleSections: Record<AdminSidebarSectionId, boolean>
): boolean {
  // Skip items inside a submenu that is currently closing/exiting AnimatePresence
  const sectionContainer = el.closest<HTMLElement>('[data-nav-section]')
  const sectionId = sectionContainer?.dataset.navSection
  if (isSectionId(sectionId) && !visibleSections[sectionId]) {
    return false
  }

  if (
    el.hasAttribute('disabled') ||
    el.getAttribute('aria-disabled') === 'true' ||
    el.getAttribute('aria-hidden') === 'true'
  ) {
    return false
  }

  const style = window.getComputedStyle(el)
  if (
    style.display === 'none' ||
    style.visibility === 'hidden' ||
    style.pointerEvents === 'none' ||
    parseFloat(style.opacity) === 0
  ) {
    return false
  }

  const rect = el.getBoundingClientRect()
  return rect.width >= 1 && rect.height >= 1
}

function getVisibleRouteItems(
  navWrap: HTMLElement,
  visibleSections: Record<AdminSidebarSectionId, boolean>
): HTMLAnchorElement[] {
  const candidates = Array.from(navWrap.querySelectorAll<HTMLAnchorElement>('a.dash-nav-item'))
  return candidates.filter((el) => {
    const route = el.dataset.navTo || el.getAttribute('href')
    if (!route) return false
    return isElementVisibleAndInteractive(el, visibleSections)
  })
}

function getVisibleAllItems(
  navWrap: HTMLElement,
  visibleSections: Record<AdminSidebarSectionId, boolean>
): HTMLElement[] {
  const candidates = Array.from(
    navWrap.querySelectorAll<HTMLElement>('a.dash-nav-item, button.dash-nav-section-btn')
  )
  return candidates.filter((el) => isElementVisibleAndInteractive(el, visibleSections))
}

function normalizePath(path: string): string {
  return path.replace(/\/+$/, '') || '/dashboard'
}

function resolveRouteFromAnchor(el: HTMLAnchorElement): string | null {
  const explicit = el.dataset.navTo
  if (explicit) return explicit
  const href = el.getAttribute('href')
  if (!href) return null
  try {
    const parsed = new URL(href, window.location.origin)
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return href
  }
}

export function useAdminSidebarKeyboardNav(options: UseAdminSidebarKeyboardNavOptions) {
  const isPointerInsideRef = useRef(false)
  const latestRef = useRef(options)
  latestRef.current = options

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const cfg = latestRef.current
      if (!cfg.enabled || e.defaultPrevented) return

      // Never interfere with modifier shortcuts (Ctrl+K, Cmd+K, Ctrl+B, Alt+Arrows, etc.)
      if (e.ctrlKey || e.metaKey || e.altKey) return

      const key = e.key
      if (
        key !== 'ArrowDown' &&
        key !== 'ArrowUp' &&
        key !== 'ArrowLeft' &&
        key !== 'ArrowRight' &&
        key !== 'Home' &&
        key !== 'End' &&
        key !== 'Escape'
      ) {
        return
      }

      // Never steal input when header popovers, search dropdown, command palette, modals, or editable fields are active
      if (cfg.hasOpenPopover || isBlockingOverlayOpen()) return
      const activeEl = document.activeElement
      if (isEditableElement(activeEl) || isEditableElement(e.target)) return

      const sidebarEl = cfg.sidebarRef.current
      const navWrapEl = cfg.sidebarNavWrapRef.current
      if (!sidebarEl || !navWrapEl) return

      const focusInSidebar = Boolean(activeEl && sidebarEl.contains(activeEl))
      const pointerInDesktopSidebar =
        !cfg.isMobile && (isPointerInsideRef.current || sidebarEl.matches(':hover'))
      const mobileDrawerActive = cfg.isMobile && cfg.mobileMenuOpen

      if (!focusInSidebar && !pointerInDesktopSidebar && !mobileDrawerActive) {
        return
      }

      // Accordion heading ArrowLeft / ArrowRight expand/collapse support (only when focused on heading)
      if (key === 'ArrowRight' || key === 'ArrowLeft') {
        if (
          !cfg.isRailMode &&
          focusInSidebar &&
          activeEl instanceof HTMLElement &&
          activeEl.classList.contains('dash-nav-section-btn')
        ) {
          const toggleSection = activeEl.dataset.navSectionToggle
          if (isSectionId(toggleSection)) {
            const isExpanded = activeEl.getAttribute('aria-expanded') === 'true'
            if (key === 'ArrowRight' && !isExpanded) {
              e.preventDefault()
              cfg.onOpenSection(toggleSection)
            } else if (key === 'ArrowLeft' && isExpanded) {
              e.preventDefault()
              cfg.onCloseSection(toggleSection)
            }
          }
        }
        return
      }

      // Handle Escape: close flyout, mobile drawer, open submenu, or release sidebar focus
      if (key === 'Escape') {
        if (cfg.hasOpenFlyout) {
          e.preventDefault()
          cfg.onCloseFlyout()
          if (focusInSidebar && activeEl instanceof HTMLElement) {
            activeEl.blur()
          }
          return
        }

        if (mobileDrawerActive) {
          e.preventDefault()
          cfg.onCloseMobileMenu()
          return
        }

        if (focusInSidebar && activeEl instanceof HTMLElement) {
          if (!cfg.isRailMode) {
            const parentSection =
              activeEl.closest<HTMLElement>('[data-nav-section]')?.dataset.navSection
            if (isSectionId(parentSection) && cfg.visibleSections[parentSection]) {
              e.preventDefault()
              cfg.onCloseSection(parentSection)
              const toggleBtn = navWrapEl.querySelector<HTMLElement>(
                `[data-nav-section-toggle="${parentSection}"]`
              )
              toggleBtn?.focus({ preventScroll: true })
              return
            }

            const toggleSection = activeEl.dataset.navSectionToggle
            if (
              isSectionId(toggleSection) &&
              activeEl.getAttribute('aria-expanded') === 'true'
            ) {
              e.preventDefault()
              cfg.onCloseSection(toggleSection)
              return
            }
          }

          e.preventDefault()
          activeEl.blur()
        }
        return
      }

      // Mobile drawer: preserve focus-based navigation (Arrow moves focus, Enter activates & closes drawer)
      if (cfg.isMobile) {
        const mobileItems = getVisibleAllItems(navWrapEl, cfg.visibleSections)
        if (mobileItems.length === 0) return

        e.preventDefault()
        const currentIdx =
          activeEl instanceof HTMLElement ? mobileItems.indexOf(activeEl) : -1
        let nextItem: HTMLElement
        if (key === 'Home') {
          nextItem = mobileItems[0]
        } else if (key === 'End') {
          nextItem = mobileItems[mobileItems.length - 1]
        } else if (currentIdx !== -1) {
          const delta = key === 'ArrowDown' ? 1 : -1
          nextItem = mobileItems[(currentIdx + delta + mobileItems.length) % mobileItems.length]
        } else {
          const activeIdx = mobileItems.findIndex((el) => el.classList.contains('is-active'))
          if (activeIdx !== -1) {
            const delta = key === 'ArrowDown' ? 1 : -1
            nextItem = mobileItems[(activeIdx + delta + mobileItems.length) % mobileItems.length]
          } else {
            nextItem = key === 'ArrowDown' ? mobileItems[0] : mobileItems[mobileItems.length - 1]
          }
        }

        nextItem.focus({ preventScroll: true })
        if (typeof nextItem.scrollIntoView === 'function') {
          nextItem.scrollIntoView({ block: 'nearest' })
        }
        return
      }

      // Desktop (expanded & collapsed rail): immediate single-step page navigation on ArrowDown / ArrowUp / Home / End
      const routeItems = getVisibleRouteItems(navWrapEl, cfg.visibleSections)

      // Fallback if all accordion groups are currently collapsed: cycle focus across visible section headings
      if (routeItems.length === 0) {
        const sectionButtons = getVisibleAllItems(navWrapEl, cfg.visibleSections)
        if (sectionButtons.length === 0) return
        e.preventDefault()
        const currentBtnIdx =
          activeEl instanceof HTMLElement ? sectionButtons.indexOf(activeEl) : -1
        let nextBtn: HTMLElement
        if (key === 'Home') {
          nextBtn = sectionButtons[0]
        } else if (key === 'End') {
          nextBtn = sectionButtons[sectionButtons.length - 1]
        } else if (currentBtnIdx !== -1) {
          const delta = key === 'ArrowDown' ? 1 : -1
          nextBtn =
            sectionButtons[(currentBtnIdx + delta + sectionButtons.length) % sectionButtons.length]
        } else {
          nextBtn =
            key === 'ArrowDown' ? sectionButtons[0] : sectionButtons[sectionButtons.length - 1]
        }
        nextBtn.focus({ preventScroll: true })
        if (typeof nextBtn.scrollIntoView === 'function') {
          nextBtn.scrollIntoView({ block: 'nearest' })
        }
        return
      }

      e.preventDefault()

      let targetAnchor: HTMLAnchorElement
      const focusedRouteIdx =
        activeEl instanceof HTMLAnchorElement ? routeItems.indexOf(activeEl) : -1
      const isFocusedSectionHeading =
        activeEl instanceof HTMLElement && activeEl.classList.contains('dash-nav-section-btn')

      if (key === 'Home') {
        targetAnchor = routeItems[0]
      } else if (key === 'End') {
        targetAnchor = routeItems[routeItems.length - 1]
      } else if (isFocusedSectionHeading && activeEl instanceof HTMLElement) {
        // From an accordion group heading, jump directly to the adjacent visible page in DOM order
        if (key === 'ArrowDown') {
          const following = routeItems.find(
            (item) =>
              (activeEl.compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
          )
          targetAnchor = following ?? routeItems[0]
        } else {
          let preceding: HTMLAnchorElement | undefined
          for (let i = routeItems.length - 1; i >= 0; i--) {
            if (
              (activeEl.compareDocumentPosition(routeItems[i]) &
                Node.DOCUMENT_POSITION_PRECEDING) !==
              0
            ) {
              preceding = routeItems[i]
              break
            }
          }
          targetAnchor = preceding ?? routeItems[routeItems.length - 1]
        }
      } else if (focusedRouteIdx !== -1) {
        // Repeated Arrow presses advance synchronously from the focused route item
        const delta = key === 'ArrowDown' ? 1 : -1
        targetAnchor = routeItems[(focusedRouteIdx + delta + routeItems.length) % routeItems.length]
      } else {
        // First Arrow press with pointer over desktop sidebar: advance from the currently active route
        const activeRouteIdx = routeItems.findIndex((el) => el.classList.contains('is-active'))
        if (activeRouteIdx !== -1) {
          const delta = key === 'ArrowDown' ? 1 : -1
          targetAnchor =
            routeItems[(activeRouteIdx + delta + routeItems.length) % routeItems.length]
        } else {
          targetAnchor = key === 'ArrowDown' ? routeItems[0] : routeItems[routeItems.length - 1]
        }
      }

      targetAnchor.focus({ preventScroll: true })
      if (typeof targetAnchor.scrollIntoView === 'function') {
        targetAnchor.scrollIntoView({ block: 'nearest' })
      }

      const nextRoute = resolveRouteFromAnchor(targetAnchor)
      if (nextRoute && normalizePath(nextRoute) !== normalizePath(cfg.currentPathname)) {
        cfg.onNavigate(nextRoute)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return {
    sidebarPointerHandlers: {
      onPointerEnter: () => {
        isPointerInsideRef.current = true
      },
      onPointerMove: () => {
        if (!isPointerInsideRef.current) {
          isPointerInsideRef.current = true
        }
      },
      onPointerLeave: () => {
        isPointerInsideRef.current = false
      },
    },
  }
}
