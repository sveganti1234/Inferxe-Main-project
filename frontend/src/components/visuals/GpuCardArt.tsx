import { useId } from 'react'

const BLADES = 9
const BLADE = 'M -5 -24 C -15 -46 -22 -68 -13 -86 C 8 -91 31 -82 35 -71 C 27 -57 19 -41 12 -24 Z'

function Fan({ cx, cy, id, reverse = false }: { cx: number; cy: number; id: string; reverse?: boolean }) {
  return (
    <g transform={`translate(${cx} ${cy})`}>
      {/* intake well */}
      <circle r="100" fill="#050805" />
      <circle r="98" fill="none" stroke={`url(#ring${id})`} strokeWidth="4" />
      <circle r="92" fill="#0a0e0b" stroke="#000" strokeWidth="1" />
      {/* spinning blades */}
      <g className={`gpu-fan ${reverse ? 'gpu-fan--rev' : ''}`}>
        {Array.from({ length: BLADES }).map((_, i) => (
          <path key={i} d={BLADE} transform={`rotate(${(360 / BLADES) * i})`} fill={`url(#blade${id})`} stroke="#050805" strokeWidth="0.8" />
        ))}
      </g>
      {/* hub */}
      <circle r="26" fill={`url(#hub${id})`} stroke="#000" strokeWidth="1" />
      <circle r="19" fill="#0b100c" />
      <circle r="19" fill="none" stroke="#76b900" strokeOpacity=".55" strokeWidth="1.2" />
      <path d="M-9 0h5m0 0c3 0 3-6 6-6h4M-4 0h10m-6 0c3 0 3 6 6 6h4" stroke="#9be015" strokeWidth="1.6" strokeLinecap="round" fill="none" />
      <circle cx="-9" cy="0" r="1.7" fill="#b6f23a" />
    </g>
  )
}

/** A hand-built, front-on illustration of a data-centre GPU card. */
export function GpuCardArt({ label = 'L40S · 48 GB' }: { label?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    <svg viewBox="0 0 740 330" className="gpu-art" role="img" aria-label="Illustration of an NVIDIA-class GPU accelerator card">
      <defs>
        <linearGradient id={`shroud${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2e3a32" />
          <stop offset=".08" stopColor="#1c251e" />
          <stop offset=".6" stopColor="#101612" />
          <stop offset="1" stopColor="#0a0e0b" />
        </linearGradient>
        <linearGradient id={`edge${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity=".5" />
          <stop offset=".35" stopColor="#ffffff" stopOpacity=".06" />
          <stop offset="1" stopColor="#76b900" stopOpacity=".45" />
        </linearGradient>
        <linearGradient id={`ring${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6c786f" />
          <stop offset=".5" stopColor="#222b24" />
          <stop offset="1" stopColor="#55615a" />
        </linearGradient>
        <linearGradient id={`blade${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#3b473f" />
          <stop offset=".55" stopColor="#1a221c" />
          <stop offset="1" stopColor="#566259" />
        </linearGradient>
        <radialGradient id={`hub${id}`} cx=".35" cy=".3" r=".9">
          <stop offset="0" stopColor="#8d998f" />
          <stop offset=".5" stopColor="#38423b" />
          <stop offset="1" stopColor="#111712" />
        </radialGradient>
        <linearGradient id={`gold${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f5dc8e" />
          <stop offset=".5" stopColor="#c9a44b" />
          <stop offset="1" stopColor="#8a6a21" />
        </linearGradient>
        <linearGradient id={`lime${id}`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#76b900" stopOpacity="0" />
          <stop offset=".4" stopColor="#9be015" />
          <stop offset="1" stopColor="#b6f23a" />
        </linearGradient>
        <radialGradient id={`floor${id}`} cx=".5" cy=".5" r=".5">
          <stop offset="0" stopColor="#76b900" stopOpacity=".45" />
          <stop offset="1" stopColor="#76b900" stopOpacity="0" />
        </radialGradient>
        <filter id={`glow${id}`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="5" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`clip${id}`}>
          <rect x="14" y="34" width="712" height="226" rx="26" />
        </clipPath>
      </defs>

      {/* floor glow */}
      <ellipse cx="370" cy="296" rx="330" ry="20" fill={`url(#floor${id})`} />

      {/* PCIe contacts */}
      <g transform="translate(90 258)">
        <rect width="300" height="26" rx="2" fill="#0a0e0b" />
        {Array.from({ length: 52 }).map((_, i) => (
          <rect key={i} x={5 + i * 5.6} y="3" width="3.4" height="20" fill={`url(#gold${id})`} />
        ))}
        <rect x="170" y="0" width="8" height="26" fill="#0a0e0b" />
      </g>

      {/* body */}
      <rect x="14" y="34" width="712" height="226" rx="26" fill={`url(#shroud${id})`} />
      <rect x="14.5" y="34.5" width="711" height="225" rx="25.5" fill="none" stroke={`url(#edge${id})`} />

      <g clipPath={`url(#clip${id})`}>
        {/* heat-sink fin slits along the top edge */}
        {Array.from({ length: 78 }).map((_, i) => (
          <rect key={i} x={34 + i * 8.8} y="40" width="3.2" height="14" rx="1.2" fill="#050705" opacity={0.85} />
        ))}
        {/* carbon-weave texture */}
        <rect x="14" y="34" width="712" height="226" fill="url(#weave)" opacity=".6" />
        {/* lime accent blade */}
        <g filter={`url(#glow${id})`}>
          <path d="M-20 214 L 560 214 L 600 190 L 740 190 L 740 202 L 610 202 L 566 226 L -20 226 Z" fill={`url(#lime${id})`} opacity=".95" />
        </g>
        {/* specular sweep */}
        <path d="M 120 34 L 360 34 L 250 260 L 10 260 Z" fill="#fff" opacity=".035" />
      </g>

      <Fan cx={218} cy={135} id={id} />
      <Fan cx={522} cy={135} id={id} reverse />

      {/* power connector */}
      <g transform="translate(560 22)">
        <rect width="104" height="16" rx="4" fill="#050705" stroke="#2a342d" />
        {Array.from({ length: 6 }).map((_, i) => (
          <rect key={i} x={8 + i * 15} y="4" width="9" height="8" rx="1.5" fill="#1b231d" />
        ))}
      </g>

      {/* badge */}
      <g transform="translate(44 232)">
        <circle cx="5" cy="5" r="4" fill="#9be015">
          <animate attributeName="opacity" values="1;.35;1" dur="2.2s" repeatCount="indefinite" />
        </circle>
        <text x="18" y="9" fill="#8a978a" fontSize="11" letterSpacing="2.4" fontFamily="'JetBrains Mono Variable', monospace">
          INFERXE · {label.toUpperCase()}
        </text>
      </g>

      <defs>
        <pattern id="weave" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="3" height="6" fill="#ffffff" opacity=".035" />
        </pattern>
      </defs>
    </svg>
  )
}
