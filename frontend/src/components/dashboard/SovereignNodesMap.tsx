import { useState, useMemo } from 'react'
import { WorldMapLandmass } from './WorldMapVector'

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
}

export const GEO_DISTRIBUTION: GeoDistributionItem[] = [
  { id: 'other', name: 'Other', percentage: '68.67%', percentVal: 68.67, nodes: 184, latency: 'Dynamic', region: 'Global Edge & Partner Fabrics' },
  { id: 'us', name: 'United States', percentage: '17.58%', percentVal: 17.58, cx: 178, cy: 418, radius: 26, nodes: 48, latency: '168 ms', region: 'US Central / East', dc: 'Equinix Ashburn & Chicago' },
  { id: 'us-north', name: 'US North / Great Lakes', percentage: '', percentVal: 0, cx: 215, cy: 388, radius: 11, nodes: 16, latency: '172 ms', region: 'North America Central', dc: 'Chicago CH1' },
  { id: 'us-south', name: 'US South Edge', percentage: '', percentVal: 0, cx: 165, cy: 448, radius: 6, nodes: 8, latency: '180 ms', region: 'US South Edge', dc: 'Dallas DA1' },
  { id: 'in', name: 'India', percentage: '3.68%', percentVal: 3.68, cx: 598, cy: 476, radius: 20, nodes: 208, latency: '4 ms', region: 'Indian Sovereign Core', dc: 'Yotta NM1, CtrlS, E2E Noida' },
  { id: 'ph', name: 'Philippines', percentage: '2.52%', percentVal: 2.52, cx: 704, cy: 494, radius: 14, nodes: 14, latency: '52 ms', region: 'Southeast Asia Hub', dc: 'PLDT VITRO Makati' },
  { id: 'gb', name: 'United Kingdom', percentage: '1.8%', percentVal: 1.8, cx: 399, cy: 379, radius: 12, nodes: 16, latency: '92 ms', region: 'Western Europe Gateway', dc: 'Telehouse London Docklands' },
  { id: 'ca', name: 'Canada', percentage: '1.36%', percentVal: 1.36, cx: 185, cy: 348, radius: 9, nodes: 8, latency: '174 ms', region: 'North America North', dc: 'Cologix TOR-1 (Toronto)' },
  { id: 'id', name: 'Indonesia', percentage: '1.22%', percentVal: 1.22, cx: 692, cy: 538, radius: 9, nodes: 8, latency: '46 ms', region: 'ASEAN Interconnect', dc: 'DCI Indonesia (JK1)' },
  { id: 'za', name: 'South Africa', percentage: '1.18%', percentVal: 1.18, cx: 466, cy: 606, radius: 8, nodes: 6, latency: '136 ms', region: 'Africa Sovereign Point', dc: 'Teraco JB1 (Johannesburg)' },
  { id: 'br', name: 'Brazil', percentage: '0.96%', percentVal: 0.96, cx: 275, cy: 574, radius: 8, nodes: 6, latency: '198 ms', region: 'South America Hub', dc: 'Ascenty SP4 (São Paulo)' },
  { id: 'mx', name: 'Mexico', percentage: '0.96%', percentVal: 0.96, cx: 158, cy: 454, radius: 7, nodes: 6, latency: '178 ms', region: 'Central America Edge', dc: 'KIO Networks QRO1' },
]

interface SovereignNodesMapProps {
  selectedCountryId?: string | null
  onSelectCountry?: (countryId: string | null) => void
}

export function SovereignNodesMap({ selectedCountryId, onSelectCountry }: SovereignNodesMapProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null)

  const activeId = hoveredId || selectedCountryId || null

  const activeItem = useMemo(() => {
    return GEO_DISTRIBUTION.find((g) => g.id === activeId) || null
  }, [activeId])

  const mapMarkers = useMemo(() => {
    return GEO_DISTRIBUTION.filter((g) => g.cx !== undefined && g.cy !== undefined)
  }, [])

  return (
    <div className="mw-geo-map-card">
      {/* ── Left Pane: Geographical Distribution List ───────── */}
      <div className="mw-geo-list-pane">
        <div className="mw-geo-header">
          <span className="mw-geo-title">GEOGRAPHICAL DISTRIBUTION</span>
        </div>

        <div className="mw-geo-items" role="list">
          {GEO_DISTRIBUTION.filter((g) => g.percentage).map((item) => {
            const isHovered = activeId === item.id
            const isSelected = selectedCountryId === item.id
            const isIndia = item.id === 'in'

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
                  <span className="mw-geo-name">{item.name}</span>
                  {isIndia && (
                    <span className="mw-geo-core-tag">Core</span>
                  )}
                </div>
                <div className="mw-geo-meta">
                  <span className="mw-geo-pct">{item.percentage}</span>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Right Pane: Vector World Map Canvas ───────────────── */}
      <div className="mw-geo-map-pane">
        <svg
          viewBox="30 240 785 460"
          className="mw-world-map-svg"
          preserveAspectRatio="xMidYMid meet"
          aria-label="High-precision interactive world map showing sovereign compute nodes distribution"
        >
          <defs>
            {/* Bubble radial gradient for global edge nodes - Inferxe Signature Green */}
            <radialGradient id="geo-bubble-green" cx="42%" cy="42%" r="58%">
              <stop offset="0%" stopColor="#bef264" stopOpacity="0.95" />
              <stop offset="40%" stopColor="#84cc16" stopOpacity="0.85" />
              <stop offset="80%" stopColor="#65a300" stopOpacity="0.75" />
              <stop offset="100%" stopColor="#4d7c0f" stopOpacity="0.60" />
            </radialGradient>

            {/* Bubble radial gradient for Indian Sovereign Core - Flagship Beacon */}
            <radialGradient id="geo-bubble-india" cx="40%" cy="40%" r="60%">
              <stop offset="0%" stopColor="#ffffff" stopOpacity="0.98" />
              <stop offset="25%" stopColor="#bef264" stopOpacity="0.95" />
              <stop offset="60%" stopColor="#76b900" stopOpacity="0.90" />
              <stop offset="100%" stopColor="#3f6212" stopOpacity="0.75" />
            </radialGradient>

            <filter id="geo-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="#000000" floodOpacity="0.25" />
            </filter>

            <filter id="bubble-glow-green" x="-45%" y="-45%" width="190%" height="190%">
              <feDropShadow dx="0" dy="0" stdDeviation="6" floodColor="#76b900" floodOpacity="0.8" />
            </filter>

            <filter id="bubble-glow-india" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="9" floodColor="#84cc16" floodOpacity="0.95" />
            </filter>
          </defs>

          {/* Continents and Landmasses */}
          <WorldMapLandmass />

          {/* ── Interactive Translucent Pulse Bubbles ─────────── */}
          {mapMarkers.map((m) => {
            if (!m.cx || !m.cy || !m.radius) return null
            const isHovered = activeId === m.id || (m.id.startsWith('us-') && activeId === 'us')
            const isIndia = m.id === 'in'
            const currentR = isHovered ? m.radius * 1.25 : m.radius
            const bubbleFill = isIndia ? 'url(#geo-bubble-india)' : 'url(#geo-bubble-green)'
            const strokeColor = isIndia ? '#ecfccb' : 'rgba(163, 230, 53, 0.85)'
            const pulseStroke = isIndia ? '#84cc16' : '#76b900'
            const filterUrl = isIndia ? 'url(#bubble-glow-india)' : 'url(#bubble-glow-green)'

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
                {/* Concentric Pulse Ring */}
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

                {/* Primary Translucent Bubble Circle */}
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

                {/* Center Core Dot */}
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

        {/* ── Floating Tooltip when hovering any marker ───────── */}
        {activeItem && activeItem.cx && activeItem.cy && (
          <div
            className="mw-map-tooltip"
            style={{
              left: `${((activeItem.cx - 30) / 785) * 100}%`,
              top: `${((activeItem.cy - 240) / 460) * 100}%`,
              transform: activeItem.cx > 520 ? 'translate(calc(-100% - 14px), -60%)' : 'translate(14px, -60%)',
            }}
          >
            <div className="mw-map-tooltip__top">
              <span className="mw-map-tooltip__title">{activeItem.name}</span>
              <span className="mw-map-tooltip__pct">{activeItem.percentage || 'Edge Node'}</span>
            </div>
            <div className="mw-map-tooltip__detail">
              <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <span style={{ color: 'var(--ink-4)' }}>Datacenter:</span>
                <strong style={{ color: 'var(--ink)' }}>{activeItem.dc || activeItem.region}</strong>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12, marginTop: 4 }}>
                <span style={{ color: 'var(--ink-4)' }}>Compute Nodes:</span>
                <strong style={{ color: 'var(--brand-hi)' }}>
                  {activeItem.nodes} GPUs
                </strong>
              </div>
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
