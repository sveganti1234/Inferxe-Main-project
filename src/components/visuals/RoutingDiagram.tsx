import { useId } from 'react'

/**
 * One API in → control plane → adapters → many providers.
 * Packets travel along each path via SMIL animateMotion (no JS per frame).
 */
export function RoutingDiagram() {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const paths = [
    { id: 'a', d: 'M 478 180 C 540 180 540 70 610 70', live: true },
    { id: 'b', d: 'M 478 180 C 540 180 540 180 610 180', live: false },
    { id: 'c', d: 'M 478 180 C 540 180 540 290 610 290', live: false },
  ]
  return (
    <svg viewBox="0 0 800 360" className="routing" role="img" aria-label="Diagram: an application sends one API request to the Inferxe control plane, which routes it through provider adapters to one of many GPU providers.">
      <defs>
        <linearGradient id={`ln${id}`} x1="0" x2="1">
          <stop offset="0" stopColor="#76b900" stopOpacity=".15" />
          <stop offset="1" stopColor="#9be015" stopOpacity=".9" />
        </linearGradient>
        <radialGradient id={`core${id}`} cx=".5" cy=".4" r=".7">
          <stop offset="0" stopColor="#b6f23a" stopOpacity=".95" />
          <stop offset=".55" stopColor="#4b7a00" />
          <stop offset="1" stopColor="#101a10" />
        </radialGradient>
        <filter id={`g${id}`} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* app → control plane */}
      <path id={`in${id}`} d="M 150 180 L 322 180" stroke={`url(#ln${id})`} strokeWidth="2" fill="none" />
      <path d="M 150 180 L 322 180" stroke="#76b900" strokeOpacity=".25" strokeWidth="6" fill="none" strokeDasharray="2 10" strokeLinecap="round" className="routing__flow" />

      {/* control plane → providers */}
      {paths.map((p) => (
        <g key={p.id}>
          <path id={`p${p.id}${id}`} d={p.d} stroke={p.live ? `url(#ln${id})` : '#76b900'} strokeOpacity={p.live ? 1 : 0.28} strokeWidth="2" fill="none" strokeDasharray={p.live ? undefined : '5 6'} />
        </g>
      ))}

      {/* packets */}
      <circle r="4.5" fill="#b6f23a" filter={`url(#g${id})`}>
        <animateMotion dur="2.4s" repeatCount="indefinite" begin="0s">
          <mpath href={`#in${id}`} />
        </animateMotion>
      </circle>
      <circle r="4.5" fill="#b6f23a" filter={`url(#g${id})`}>
        <animateMotion dur="2.4s" repeatCount="indefinite" begin="1.2s">
          <mpath href={`#in${id}`} />
        </animateMotion>
      </circle>
      <circle r="4.5" fill="#b6f23a" filter={`url(#g${id})`}>
        <animateMotion dur="2s" repeatCount="indefinite" begin="1.2s">
          <mpath href={`#pa${id}`} />
        </animateMotion>
      </circle>
      <circle r="3.5" fill="#76b900" opacity=".5">
        <animateMotion dur="3.4s" repeatCount="indefinite" begin="2s">
          <mpath href={`#pb${id}`} />
        </animateMotion>
      </circle>
      <circle r="3.5" fill="#76b900" opacity=".5">
        <animateMotion dur="3.4s" repeatCount="indefinite" begin="3s">
          <mpath href={`#pc${id}`} />
        </animateMotion>
      </circle>

      {/* application */}
      <g transform="translate(26 132)">
        <rect width="124" height="96" rx="16" fill="#0f1511" stroke="#2a372d" />
        <rect x=".5" y=".5" width="123" height="95" rx="15.5" fill="none" stroke="#fff" strokeOpacity=".08" />
        <g fill="none" stroke="#9be015" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M 40 40 l -10 8 l 10 8" />
          <path d="M 84 40 l 10 8 l -10 8" />
          <path d="M 56 60 l 12 -24" />
        </g>
        <text x="62" y="84" textAnchor="middle" fill="#8e9c8c" fontSize="10.5" letterSpacing="1.6" fontFamily="'JetBrains Mono Variable', monospace">
          YOUR APP
        </text>
      </g>

      {/* control plane */}
      <g transform="translate(400 180)">
        <circle r="92" fill="none" stroke="#76b900" strokeOpacity=".18" className="routing__ring" />
        <circle r="74" fill="none" stroke="#76b900" strokeOpacity=".3" strokeDasharray="3 8" className="routing__ring routing__ring--slow" />
        <polygon points="0,-58 50,-29 50,29 0,58 -50,29 -50,-29" fill={`url(#core${id})`} stroke="#b6f23a" strokeOpacity=".7" strokeWidth="1.5" filter={`url(#g${id})`} />
        <polygon points="0,-42 36,-21 36,21 0,42 -36,21 -36,-21" fill="#0a100c" stroke="#76b900" strokeOpacity=".5" />
        <g stroke="#b6f23a" strokeWidth="2.4" strokeLinecap="round" fill="none">
          <path d="M -20 0 h 12 M -8 0 c 8 0 8 -14 16 -14 h 8 M -8 0 h 28 M -8 0 c 8 0 8 14 16 14 h 8" />
        </g>
        <circle cx="-20" cy="0" r="3.6" fill="#76b900" />
        <text y="112" textAnchor="middle" fill="#b4c0b2" fontSize="11" letterSpacing="2" fontFamily="'JetBrains Mono Variable', monospace">
          INFERXE CONTROL PLANE
        </text>
      </g>

      {/* providers */}
      {[
        { y: 22, name: 'JarvisLabs', tag: 'LIVE IN MVP', live: true },
        { y: 132, name: 'Provider B', tag: 'PHASE 2', live: false },
        { y: 242, name: 'Provider C', tag: 'PHASE 2', live: false },
      ].map((p) => (
        <g key={p.name} transform={`translate(610 ${p.y})`}>
          <rect width="170" height="96" rx="16" fill="#0f1511" stroke={p.live ? '#76b900' : '#2a372d'} strokeOpacity={p.live ? 0.8 : 1} strokeDasharray={p.live ? undefined : '5 5'} />
          {p.live && <rect width="170" height="96" rx="16" fill="#76b900" opacity=".07" />}
          {[0, 1, 2].map((i) => (
            <g key={i} transform={`translate(16 ${22 + i * 17})`}>
              <rect width="50" height="10" rx="3" fill="#18211b" stroke="#2a372d" />
              <circle cx="43" cy="5" r="2.2" fill={p.live ? '#9be015' : '#3a443c'}>
                {p.live && <animate attributeName="opacity" values="1;.2;1" dur={`${1.4 + i * 0.5}s`} repeatCount="indefinite" />}
              </circle>
            </g>
          ))}
          <text x="80" y="44" fill={p.live ? '#eef2ea' : '#8e9c8c'} fontSize="12.5" fontWeight="600" fontFamily="'Rubik Variable', sans-serif">
            {p.name}
          </text>
          <text x="80" y="60" fill={p.live ? '#9be015' : '#5c6759'} fontSize="8.5" letterSpacing="1.2" fontFamily="'JetBrains Mono Variable', monospace">
            {p.tag}
          </text>
        </g>
      ))}

      {/* adapter ticks */}
      {[70, 180, 290].map((y) => (
        <g key={y} transform={`translate(536 ${y})`}>
          <rect x="-14" y="-9" width="28" height="18" rx="5" fill="#0a100c" stroke="#76b900" strokeOpacity=".5" />
          <text textAnchor="middle" y="3.6" fill="#9be015" fontSize="8" letterSpacing="1" fontFamily="'JetBrains Mono Variable', monospace">
            ADP
          </text>
        </g>
      ))}

      <text x="26" y="266" fill="#5c6759" fontSize="10" letterSpacing="2" fontFamily="'JetBrains Mono Variable', monospace">
        ONE API
      </text>
      <text x="610" y="352" fill="#5c6759" fontSize="10" letterSpacing="2" fontFamily="'JetBrains Mono Variable', monospace">
        MANY PROVIDERS
      </text>
    </svg>
  )
}
