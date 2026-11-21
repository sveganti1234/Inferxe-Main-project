/**
 * Decorative GPU illustration (pure SVG, no data, no image asset). It is a visual device only:
 * it carries no figures and is hidden from assistive technology.
 */
export function GpuVisual({ className }: { className?: string }) {
  return (
    <svg className={`cx-gpuvisual${className ? ` ${className}` : ''}`} viewBox="0 0 320 200" role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="cx-gv-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#1d3a2b" />
          <stop offset="100%" stopColor="#0d1d15" />
        </linearGradient>
        <linearGradient id="cx-gv-die" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8cf2bd" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#2aa772" stopOpacity="0.85" />
        </linearGradient>
        <radialGradient id="cx-gv-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#72e6ac" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#72e6ac" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="160" cy="104" rx="150" ry="86" fill="url(#cx-gv-glow)" />
      <rect x="22" y="40" width="276" height="124" rx="14" fill="url(#cx-gv-body)" stroke="#72e6ac" strokeOpacity="0.28" />
      <g stroke="#72e6ac" strokeOpacity="0.4" fill="none">
        <circle cx="92" cy="102" r="34" />
        <circle cx="92" cy="102" r="10" fill="#0b1711" />
        <path d="M92 68v24M92 112v24M58 102h24M102 102h24M68 78l17 17M99 109l17 17M116 78l-17 17M85 109l-17 17" strokeOpacity="0.25" />
        <circle cx="228" cy="102" r="34" />
        <circle cx="228" cy="102" r="10" fill="#0b1711" />
        <path d="M228 68v24M228 112v24M194 102h24M238 102h24M204 78l17 17M235 109l17 17M252 78l-17 17M221 109l-17 17" strokeOpacity="0.25" />
      </g>
      <rect x="132" y="76" width="56" height="56" rx="8" fill="#0b1711" stroke="#72e6ac" strokeOpacity="0.5" />
      <rect x="142" y="86" width="36" height="36" rx="5" fill="url(#cx-gv-die)" />
      <g stroke="#0b1711" strokeOpacity="0.55">
        <path d="M142 98h36M142 110h36M154 86v36M166 86v36" />
      </g>
      <g fill="#72e6ac" fillOpacity="0.55">
        {Array.from({ length: 16 }, (_, i) => (
          <rect key={i} x={50 + i * 13.5} y="164" width="7" height="12" rx="1.5" />
        ))}
      </g>
    </svg>
  )
}
