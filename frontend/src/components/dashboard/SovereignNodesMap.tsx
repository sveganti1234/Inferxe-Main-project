import { useState, useMemo } from 'react'
import { AlertCircle, Database, Globe } from 'lucide-react'
import { WorldMapLandmass } from './WorldMapVector'

export type NodeHealthStatus = 'Healthy' | 'Degraded' | 'Maintenance'
export type NodesMapDataSource = 'live' | 'demo'

export interface GeoDistributionItem {
  id: string
  name: string
  percentage: string
  percentVal: number
  cx?: number
  cy?: number
  radius?: number
  nodes: number
  latency: string
  region: string
  dc?: string
  /** Operational health state of the region/provider cluster */
  health?: NodeHealthStatus
  /** Optional provider name (e.g. 'Yotta', 'CtrlS', 'E2E Cloud') */
  provider?: string
  /** Optional list of GPU models hosted at this region */
  gpuModels?: string[]
  /** Optional available / total GPU counts */
  availableGpus?: number
  totalGpus?: number
}

// Illustrative DEMO DATA geographical distribution (preserved export for backward compatibility)
export const GEO_DISTRIBUTION: GeoDistributionItem[] = [
  { id: 'other', name: 'Other', percentage: '68.67%', percentVal: 68.67, nodes: 184, latency: 'Dynamic', region: 'Global Edge & Partner Fabrics', health: 'Healthy' },
  { id: 'us', name: 'United States', percentage: '17.58%', percentVal: 17.58, cx: 178, cy: 418, radius: 26, nodes: 48, latency: '168 ms', region: 'US Central / East', dc: 'Equinix Ashburn & Chicago', health: 'Healthy' },
  { id: 'us-north', name: 'US North / Great Lakes', percentage: '', percentVal: 0, cx: 215, cy: 388, radius: 11, nodes: 16, latency: '172 ms', region: 'North America Central', dc: 'Chicago CH1', health: 'Healthy' },
  { id: 'us-south', name: 'US South Edge', percentage: '', percentVal: 0, cx: 165, cy: 448, radius: 6, nodes: 8, latency: '180 ms', region: 'US South Edge', dc: 'Dallas DA1', health: 'Healthy' },
  { id: 'in', name: 'India', percentage: '3.68%', percentVal: 3.68, cx: 598, cy: 476, radius: 20, nodes: 208, latency: '4 ms', region: 'Indian Sovereign Core', dc: 'Yotta NM1, CtrlS, E2E Noida', health: 'Healthy' },
  { id: 'ph', name: 'Philippines', percentage: '2.52%', percentVal: 2.52, cx: 704, cy: 494, radius: 14, nodes: 14, latency: '52 ms', region: 'Southeast Asia Hub', dc: 'PLDT VITRO Makati', health: 'Healthy' },
  { id: 'gb', name: 'United Kingdom', percentage: '1.8%', percentVal: 1.8, cx: 399, cy: 379, radius: 12, nodes: 16, latency: '92 ms', region: 'Western Europe Gateway', dc: 'Telehouse London Docklands', health: 'Healthy' },
  { id: 'ca', name: 'Canada', percentage: '1.36%', percentVal: 1.36, cx: 185, cy: 348, radius: 9, nodes: 8, latency: '174 ms', region: 'North America North', dc: 'Cologix TOR-1 (Toronto)', health: 'Healthy' },
  { id: 'id', name: 'Indonesia', percentage: '1.22%', percentVal: 1.22, cx: 692, cy: 538, radius: 9, nodes: 8, latency: '46 ms', region: 'ASEAN Interconnect', dc: 'DCI Indonesia (JK1)', health: 'Maintenance' },
  { id: 'za', name: 'South Africa', percentage: '1.18%', percentVal: 1.18, cx: 466, cy: 606, radius: 8, nodes: 6, latency: '136 ms', region: 'Africa Sovereign Point', dc: 'Teraco JB1 (Johannesburg)', health: 'Healthy' },
  { id: 'br', name: 'Brazil', percentage: '0.96%', percentVal: 0.96, cx: 275, cy: 574, radius: 8, nodes: 6, latency: '198 ms', region: 'South America Hub', dc: 'Ascenty SP4 (São Paulo)', health: 'Healthy' },
  { id: 'mx', name: 'Mexico', percentage: '0.96%', percentVal: 0.96, cx: 158, cy: 454, radius: 7, nodes: 6, latency: '178 ms', region: 'Central America Edge', dc: 'KIO Networks QRO1', health: 'Degraded' },
]

export interface SovereignNodesMapProps {
  selectedCountryId?: string | null
  onSelectCountry?: (countryId: string | null) => void
  /**
   * Optional externally supplied provider/region node distribution.
   * When omitted (`undefined`), falls back to illustrative DEMO DATA with a visible badge.
   * When explicitly `null` or `[]`, renders an empty/unavailable state instead of demo data.
   */
  nodes?: GeoDistributionItem[] | null
  /** Explicit data source mode; defaults to 'demo' when `nodes` is undefined, else 'live'. */
  dataSource?: NodesMapDataSource
  /** Loading state while fetching provider nodes */
  loading?: boolean
  /** Unavailable/error state when provider topology backend cannot be reached */
  unavailable?: boolean
  /** Message shown when `unavailable` is true */
  unavailableMessage?: string
  /** Message shown when `nodes` is explicitly empty */
  emptyMessage?: string
}

const HEALTH_STYLE: Record<
  NodeHealthStatus,
  {
    color: string
    bg: string
    border: string
    gradientId: string
    glowId: string
    stroke: string
    pulse: string
  }
> = {
  Healthy: {
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.35)',
    gradientId: 'url(#geo-bubble-green)',
    glowId: 'url(#bubble-glow-green)',
    stroke: 'rgba(110, 224, 161, 0.85)',
    pulse: '#50e396',
  },
  Degraded: {
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(239, 68, 68, 0.38)',
    gradientId: 'url(#geo-bubble-degraded)',
    glowId: 'url(#bubble-glow-degraded)',
    stroke: 'rgba(252, 165, 165, 0.9)',
    pulse: '#ef4444',
  },
  Maintenance: {
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.38)',
    gradientId: 'url(#geo-bubble-maintenance)',
    glowId: 'url(#bubble-glow-maintenance)',
    stroke: 'rgba(253, 230, 138, 0.9)',
    pulse: '#f59e0b',
  },
}

export function SovereignNodesMap({
  selectedCountryId,
  onSelectCountry,
  nodes,
  dataSource,
  loading = false,
  unavailable = false,
  unavailableMessage = 'Provider region topology could not be loaded from the backend.',
  emptyMessage = 'No active GPU provider regions are registered yet.',
}: SovereignNodesMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const isUsingDemoFallback = nodes === undefined
  const effectiveSource: NodesMapDataSource =
    dataSource ?? (isUsingDemoFallback ? 'demo' : 'live')
  const isDemo = effectiveSource === 'demo'

  const effectiveNodes: GeoDistributionItem[] = useMemo(() => {
    if (isUsingDemoFallback) return GEO_DISTRIBUTION
    return nodes ?? []
  }, [isUsingDemoFallback, nodes])

  const activeId = hoveredId || selectedCountryId || null

  const activeItem = useMemo(() => {
    return effectiveNodes.find((g) => g.id === activeId) || null
  }, [activeId, effectiveNodes])

  const mapMarkers = useMemo(() => {
    return effectiveNodes.filter((g) => g.cx !== undefined && g.cy !== undefined)
  }, [effectiveNodes])

  const listItems = useMemo(() => {
    return effectiveNodes.filter((g) => g.percentage || g.nodes > 0)
  }, [effectiveNodes])

  const isEmpty = !loading && !unavailable && effectiveNodes.length === 0

  return (
    <div className="mw-geo-map-card">
      {/* ── Left Pane: Geographical Distribution List ───────── */}
      <div className="mw-geo-list-pane">
        <div
          className="mw-geo-header"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}
        >
          <span className="mw-geo-title">GEOGRAPHICAL DISTRIBUTION</span>
          {isDemo ? (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'rgba(245, 158, 11, 0.16)',
                color: '#f59e0b',
                border: '1px solid rgba(245, 158, 11, 0.38)',
              }}
              title="Displaying illustrative sample regional distribution"
            >
              <Database size={9} />
              <span>DEMO DATA</span>
            </span>
          ) : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 7px',
                borderRadius: 999,
                fontFamily: 'var(--font-mono)',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                background: 'rgba(16, 185, 129, 0.16)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.38)',
              }}
            >
              <Globe size={9} />
              <span>LIVE TOPOLOGY</span>
            </span>
          )}
        </div>

        {/* Health Status Legend */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '6px 14px',
            borderBottom: '1px solid var(--line)',
            fontSize: '0.66rem',
            color: 'var(--ink-3)',
            flexWrap: 'wrap',
          }}
        >
          {(['Healthy', 'Degraded', 'Maintenance'] as NodeHealthStatus[]).map((status) => (
            <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  background: HEALTH_STYLE[status].color,
                  display: 'inline-block',
                }}
              />
              <span>{status}</span>
            </span>
          ))}
        </div>

        <div className="mw-geo-items" role="list">
          {loading ? (
            <div style={{ padding: '24px 14px', fontSize: '0.78rem', color: 'var(--ink-3)', textAlign: 'center' }}>
              Loading provider regions...
            </div>
          ) : unavailable || isEmpty ? (
            <div style={{ padding: '24px 14px', fontSize: '0.76rem', color: 'var(--ink-3)', textAlign: 'center' }}>
              {unavailable ? 'Provider topology unavailable.' : 'No provider regions available.'}
            </div>
          ) : (
            listItems
              .filter((g) => g.percentage || !isUsingDemoFallback)
              .map((item) => {
                const isHovered = activeId === item.id
                const isSelected = selectedCountryId === item.id
                const isIndia = item.id === 'in'
                const health: NodeHealthStatus = item.health ?? 'Healthy'
                const healthStyle = HEALTH_STYLE[health]

                return (
                  <div
                    key={item.id}
                    role="listitem"
                    className={`mw-geo-item ${isHovered ? 'is-hovered' : ''} ${isSelected ? 'is-active' : ''}`}
                    onMouseEnter={() => setHoveredId(item.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onClick={() => {
                      if (onSelectCountry) {
                        onSelectCountry(isSelected ? null : item.id)
                      }
                    }}
                  >
                    <div className="mw-geo-country">
                      <span
                        title={`Health: ${health}`}
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: healthStyle.color,
                          flexShrink: 0,
                        }}
                      />
                      <span className="mw-geo-name">{item.name}</span>
                      {isIndia && <span className="mw-geo-core-tag">Core</span>}
                    </div>
                    <div className="mw-geo-meta">
                      <span className="mw-geo-pct">
                        {item.percentage || `${item.nodes} GPUs`}
                      </span>
                    </div>
                  </div>
                )
              })
          )}
        </div>
      </div>

      {/* ── Right Pane: Vector World Map Canvas ───────────────── */}
      <div className="mw-geo-map-pane" style={{ position: 'relative' }}>
        <svg
          viewBox="30 240 785 460"
          className="mw-world-map-svg"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Interactive world map showing compute node regions and health status"
        >
          <defs>
            {/* Healthy Bubble */}
            <radialGradient id="geo-bubble-green" cx="42%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#a7f3d0" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#50e396" stopOpacity="0.85" />
              <stop offset="80%" stopColor="#137a50" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#0e5b3c" stopOpacity="0.60" />
            </radialGradient>

            {/* Indian Sovereign Core Healthy Beacon */}
            <radialGradient id="geo-bubble-india" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
              <stop offset="25%" stopColor="#6ee0a1" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#50e396" stopOpacity="0.90" />
              <stop offset="100%" stopColor="#0e5b3c" stopOpacity="0.75" />
            </radialGradient>

            {/* Degraded Bubble */}
            <radialGradient id="geo-bubble-degraded" cx="42%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#fecaca" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#ef4444" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#991b1b" stopOpacity="0.72" />
            </radialGradient>

            {/* Maintenance Bubble */}
            <radialGradient id="geo-bubble-maintenance" cx="42%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#fef3c7" stopOpacity="0.95" />
              <stop offset="45%" stopColor="#f59e0b" stopOpacity="0.88" />
              <stop offset="100%" stopColor="#92400e" stopOpacity="0.72" />
            </radialGradient>

            <filter id="geo-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000000" floodOpacity="0.25" />
            </filter>

            <filter id="bubble-glow-green" x="-45%" y="-45%" width="190%" height="190%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#50e396" floodOpacity="0.8" />
            </filter>

            <filter id="bubble-glow-india" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#6ee0a1" floodOpacity="0.95" />
            </filter>

            <filter id="bubble-glow-degraded" x="-45%" y="-45%" width="190%" height="190%">
              <feDropShadow dx="0" dy="0" stdDeviation="7" floodColor="#ef4444" floodOpacity="0.85" />
            </filter>

            <filter id="bubble-glow-maintenance" x="-45%" y="-45%" width="190%" height="190%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#f59e0b" floodOpacity="0.8" />
            </filter>
          </defs>

          {/* Continents and Landmasses */}
          <WorldMapLandmass />

          {/* ── Interactive Health-Coded Node Markers ─────────── */}
          {!loading &&
            !unavailable &&
            mapMarkers.map((m) => {
              if (!m.cx || !m.cy || !m.radius) return null
              const isHovered = activeId === m.id || (m.id.startsWith('us-') && activeId === 'us')
              const isIndia = m.id === 'in'
              const health: NodeHealthStatus = m.health ?? 'Healthy'
              const hStyle = HEALTH_STYLE[health]
              const currentR = isHovered ? m.radius * 1.25 : m.radius

              const bubbleFill =
                isIndia && health === 'Healthy' ? 'url(#geo-bubble-india)' : hStyle.gradientId
              const strokeColor = isIndia && health === 'Healthy' ? '#ffffff' : hStyle.stroke
              const pulseStroke = isIndia && health === 'Healthy' ? '#6ee0a1' : hStyle.pulse
              const filterUrl =
                isIndia && health === 'Healthy' ? 'url(#bubble-glow-india)' : hStyle.glowId

              return (
                <g
                  key={m.id}
                  className="mw-map-node-group"
                  style={{ cursor: 'pointer', transition: 'transform 0.25s ease' }}
                  onMouseEnter={() => setHoveredId(m.id.startsWith('us-') ? 'us' : m.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => {
                    if (onSelectCountry) {
                      const targetId = m.id.startsWith('us-') ? 'us' : m.id
                      onSelectCountry(selectedCountryId === targetId ? null : targetId)
                    }
                  }}
                >
                  <circle
                    cx={m.cx}
                    cy={m.cy}
                    r={currentR}
                    fill="none"
                    stroke={pulseStroke}
                    strokeWidth="1.2"
                    opacity={isHovered ? 0.95 : 0.45}
                  >
                    <animate
                      attributeName="r"
                      values={`${currentR};${currentR * 1.55};${currentR}`}
                      dur={isIndia ? '2.4s' : '3.4s'}
                      repeatCount="indefinite"
                    />
                    <animate
                      attributeName="opacity"
                      values="0.6;0.05;0.6"
                      dur={isIndia ? '2.4s' : '3.4s'}
                      repeatCount="indefinite"
                    />
                  </circle>

                  <circle
                    cx={m.cx}
                    cy={m.cy}
                    r={currentR}
                    fill={bubbleFill}
                    stroke={strokeColor}
                    strokeWidth={isHovered ? 2 : 1.2}
                    filter={filterUrl}
                    style={{ transition: 'r 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
                  />

                  <circle
                    cx={m.cx}
                    cy={m.cy}
                    r={isHovered ? 3.5 : 2.2}
                    fill="#ffffff"
                    opacity={0.95}
                  />
                </g>
              )
            })}
        </svg>

        {/* Empty / Unavailable Map Overlay */}
        {(unavailable || isEmpty) && (
          <div
            role={unavailable ? 'alert' : 'status'}
            style={{
              position: 'absolute',
              inset: 16,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              textAlign: 'center',
              background: 'rgba(7, 13, 10, 0.78)',
              backdropFilter: 'blur(4px)',
              borderRadius: 10,
              border: unavailable
                ? '1px solid rgba(239, 68, 68, 0.35)'
                : '1px dashed rgba(255, 255, 255, 0.14)',
              padding: 20,
              color: 'var(--ink-2)',
            }}
          >
            {unavailable ? (
              <AlertCircle size={22} style={{ color: '#ef4444', marginBottom: 8 }} />
            ) : (
              <Globe size={22} style={{ color: 'var(--ink-3)', marginBottom: 8 }} />
            )}
            <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--ink)' }}>
              {unavailable ? 'Provider Topology Unavailable' : 'No Live Provider Nodes'}
            </div>
            <div style={{ fontSize: '0.76rem', color: 'var(--ink-3)', marginTop: 4, maxWidth: 360 }}>
              {unavailable ? unavailableMessage : emptyMessage}
            </div>
          </div>
        )}

        {/* ── Floating Tooltip when hovering any marker ───────── */}
        {!unavailable && !isEmpty && activeItem && activeItem.cx && activeItem.cy && (
          <div
            className="mw-map-tooltip"
            style={{
              left: `${((activeItem.cx - 30) / 785) * 100}%`,
              top: `${((activeItem.cy - 240) / 460) * 100}%`,
              transform:
                activeItem.cx > 520 ? 'translate(calc(-100% - 14px), -60%)' : 'translate(14px, -60%)',
            }}
          >
            <div className="mw-map-tooltip__top">
              <span className="mw-map-tooltip__title">{activeItem.name}</span>
              <span
                style={{
                  fontSize: '0.62rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: HEALTH_STYLE[activeItem.health ?? 'Healthy'].bg,
                  color: HEALTH_STYLE[activeItem.health ?? 'Healthy'].color,
                  border: `1px solid ${HEALTH_STYLE[activeItem.health ?? 'Healthy'].border}`,
                }}
              >
                {activeItem.health ?? 'Healthy'}
              </span>
            </div>
            <div className="mw-map-tooltip__detail">
              <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--ink-4)' }}>Datacenter:</span>
                <strong style={{ color: 'var(--ink)' }}>{activeItem.dc || activeItem.region}</strong>
              </div>
              {activeItem.provider && (
                <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                  <span style={{ color: 'var(--ink-4)' }}>Provider:</span>
                  <strong style={{ color: 'var(--ink)' }}>{activeItem.provider}</strong>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                <span style={{ color: 'var(--ink-4)' }}>Compute Nodes:</span>
                <strong style={{ color: 'var(--brand-hi)' }}>
                  {activeItem.availableGpus !== undefined && activeItem.totalGpus !== undefined
                    ? `${activeItem.availableGpus}/${activeItem.totalGpus} GPUs`
                    : `${activeItem.nodes} GPUs`}
                </strong>
              </div>
              {activeItem.gpuModels && activeItem.gpuModels.length > 0 && (
                <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                  <span style={{ color: 'var(--ink-4)' }}>Hardware:</span>
                  <strong style={{ color: 'var(--ink)' }}>{activeItem.gpuModels.join(', ')}</strong>
                </div>
              )}
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                <span style={{ color: 'var(--ink-4)' }}>Ping Latency:</span>
                <strong style={{ color: 'var(--brand-hi)' }}>{activeItem.latency}</strong>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
