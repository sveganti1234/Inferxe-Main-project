import { useEffect, useState } from 'react'

/**
 * AdminContentSkeleton
 * 
 * Subtle, high-performance loading skeleton displayed inside <main className="dash-main">
 * while a lazy-loaded route chunk or page data is loading.
 * 
 * Guarantees:
 * - Admin sidebar and topbar remain 100% visible and responsive.
 * - Prevents full-screen blanking and layout shift.
 * - Theme-aware (dark charcoal glass in dark mode, off-white frosted glass in light mode).
 * - Smooth glowing progress bar at the top of the content pane.
 */
export function AdminContentSkeleton() {
  const [theme, setTheme] = useState<'dark' | 'light'>('dark')

  useEffect(() => {
    try {
      const saved = localStorage.getItem('inferxe_dash_theme')
      if (saved === 'light' || saved === 'dark') {
        setTheme(saved)
        return
      }
    } catch {}
    const root = document.querySelector('.dash-shell') || document.documentElement
    const currentTheme = root.getAttribute('data-theme') === 'light' ? 'light' : 'dark'
    setTheme(currentTheme)
  }, [])

  const isLight = theme === 'light'

  return (
    <div
      className="dash-skeleton-content"
      aria-busy="true"
      aria-label="Loading page content"
      style={{
        width: '100%',
        minHeight: '100%',
        position: 'relative',
        padding: '6px 4px 32px',
        animation: 'fadeInQuick 0.15s ease-out',
      }}
    >
      {/* Top ambient progress bar */}
      <div className="dash-skeleton-bar" />

      {/* Header Row Skeleton */}
      <div
        className="dash-skeleton-header"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 24,
          paddingTop: 4,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 240,
              height: 26,
              borderRadius: 8,
              background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
            }}
          />
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 380,
              maxWidth: '80%',
              height: 14,
              borderRadius: 6,
              background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
            }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 88,
              height: 36,
              borderRadius: 99,
              background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
            }}
          />
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 110,
              height: 36,
              borderRadius: 99,
              background: isLight ? 'rgba(19, 122, 80, 0.12)' : 'rgba(80, 227, 150, 0.12)',
            }}
          />
        </div>
      </div>

      {/* 4-Card KPI Stat Grid Skeleton */}
      <div
        className="dash-skeleton-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))',
          gap: 14,
          marginBottom: 22,
        }}
      >
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="dash-card dash-skeleton-card"
            style={{
              padding: '18px 20px',
              borderRadius: 20,
              minHeight: 112,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: isLight ? 'rgba(255, 255, 255, 0.62)' : 'rgba(10, 20, 16, 0.45)',
              border: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(80, 227, 150, 0.08)'}`,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: 90,
                  height: 12,
                  borderRadius: 5,
                  background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                }}
              />
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: isLight ? 'rgba(19, 122, 80, 0.1)' : 'rgba(80, 227, 150, 0.1)',
                }}
              />
            </div>
            <div
              className="dash-skeleton-pulse"
              style={{
                width: 120,
                height: 26,
                borderRadius: 6,
                margin: '10px 0 6px',
                background: isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
              }}
            />
            <div
              className="dash-skeleton-pulse"
              style={{
                width: 75,
                height: 11,
                borderRadius: 4,
                background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
              }}
            />
          </div>
        ))}
      </div>

      {/* Main Content Workspace Card Skeleton */}
      <div
        className="dash-card dash-skeleton-card"
        style={{
          padding: '24px',
          borderRadius: 22,
          minHeight: 380,
          display: 'flex',
          flexDirection: 'column',
          gap: 18,
          background: isLight ? 'rgba(255, 255, 255, 0.62)' : 'rgba(10, 20, 16, 0.45)',
          border: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(80, 227, 150, 0.08)'}`,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: `1px solid ${isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(80, 227, 150, 0.08)'}`,
            paddingBottom: 14,
          }}
        >
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 180,
              height: 18,
              borderRadius: 6,
              background: isLight ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.07)',
            }}
          />
          <div
            className="dash-skeleton-pulse"
            style={{
              width: 130,
              height: 32,
              borderRadius: 99,
              background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
            }}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 4 }}>
          {[1, 2, 3, 4, 5].map((row) => (
            <div
              key={row}
              style={{
                display: 'flex',
                gap: 16,
                alignItems: 'center',
                padding: '8px 0',
              }}
            >
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  flexShrink: 0,
                  background: isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)',
                }}
              />
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: '32%',
                  height: 15,
                  borderRadius: 5,
                  background: isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.05)',
                }}
              />
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: '22%',
                  height: 15,
                  borderRadius: 5,
                  background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                }}
              />
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: '18%',
                  height: 15,
                  borderRadius: 5,
                  background: isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.04)',
                }}
              />
              <div
                className="dash-skeleton-pulse"
                style={{
                  width: 65,
                  height: 22,
                  borderRadius: 99,
                  marginLeft: 'auto',
                  background: isLight ? 'rgba(19, 122, 80, 0.1)' : 'rgba(80, 227, 150, 0.1)',
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
