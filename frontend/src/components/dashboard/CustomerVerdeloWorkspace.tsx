import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { performSignOut } from '../../lib/authStore'

export function CustomerVerdeloWorkspace() {
  const location = useLocation()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // Listen for signout messages sent from inside the iframe
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (
        e.data === 'inferxe:signout' ||
        (typeof e.data === 'object' && e.data !== null && (e.data as { type?: string }).type === 'inferxe:signout')
      ) {
        void performSignOut('/')
      }
    }
    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  // Determine target hash from URL search query (?tab=...) or path
  const getTargetHash = () => {
    const searchParams = new URLSearchParams(location.search)
    const tabParam = searchParams.get('tab')
    if (tabParam) return `#/${tabParam}`

    const path = location.pathname.toLowerCase()
    if (path.includes('/cards')) return '#/cards'
    if (path.includes('/payments')) return '#/payments'
    if (path.includes('/insights')) return '#/insights'
    if (path.includes('/budgets')) return '#/budgets'
    if (path.includes('/goals')) return '#/goals'
    if (path.includes('/household')) return '#/household'
    if (path.includes('/settings')) return '#/settings'
    if (path.includes('/help')) return '#/help'
    return '#/overview'
  }

  const initialHash = getTargetHash()

  // Sync hash changes if user navigated via query param
  useEffect(() => {
    const targetHash = getTargetHash()
    if (iframeRef.current && iframeRef.current.contentWindow) {
      try {
        if (iframeRef.current.contentWindow.location.hash !== targetHash) {
          iframeRef.current.contentWindow.location.hash = targetHash
        }
      } catch {
        // Same-origin, safe
      }
    }
  }, [location.search, location.pathname])

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 99999,
        background: '#0c1210',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <iframe
        ref={iframeRef}
        src={`/verdelo/${initialHash}`}
        title="Inferxe — money for the whole household"
        style={{
          width: '100%',
          height: '100%',
          border: 'none',
          display: 'block',
          backgroundColor: '#0c1210',
        }}
      />
    </div>
  )
}

export default CustomerVerdeloWorkspace

