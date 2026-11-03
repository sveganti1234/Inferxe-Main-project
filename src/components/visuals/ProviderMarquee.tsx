import { FC } from 'react'

export interface ProviderItem {
  id: string
  name: string
  badge?: string
  isLive?: boolean
  renderLogo: () => React.ReactNode
}

export const PROVIDERS: ProviderItem[] = [
  {
    id: 'jarvislabs',
    name: 'JarvisLabs',
    badge: 'Live in MVP',
    isLive: true,
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="12 2 2 7 12 12 22 7 12 2" />
        <polyline points="2 17 12 22 22 17" />
        <polyline points="2 12 12 17 22 12" />
      </svg>
    ),
  },
  {
    id: 'openai',
    name: 'OpenAI',
    badge: 'LLM API',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 20 L11 4 L14 11 L20 20" />
        <path d="M10 13 L17 20" />
      </svg>
    ),
  },
  {
    id: 'Nvdia',
    name: 'Nvdia',
    badge: 'LLM API',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="18" x="3" y="3" rx="4" />
        <circle cx="12" cy="12" r="3.5" fill="currentColor" fillOpacity="0.2" />
        <path d="M12 3v3 M12 18v3 M3 12h3 M18 12h3" />
      </svg>
    ),
  },
  {
    id: 'aws',
    name: 'AWS',
    badge: 'LLM API',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="6" cy="6" r="2.5" />
        <circle cx="18" cy="6" r="2.5" />
        <circle cx="6" cy="18" r="2.5" />
        <circle cx="18" cy="18" r="2.5" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" fillOpacity="0.3" />
        <path d="M8.5 6h7 M6 8.5v7 M18 8.5v7 M8.5 18h7 M7.8 7.8l8.4 8.4 M16.2 7.8l-8.4 8.4" />
      </svg>
    ),
  },
  {
    id: 'e2e',
    name: 'E2E Networks',
    badge: 'India Cloud',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="8" strokeDasharray="3 3" />
        <path d="M8 12h8 M12 8v8" />
        <circle cx="12" cy="12" r="3" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'yotta',
    name: 'Yotta',
    badge: 'NM1 Sovereign',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3 L4 8 L12 13 L20 8 Z" fill="currentColor" fillOpacity="0.15" />
        <path d="M4 8 V16 L12 21 V13 Z" />
        <path d="M20 8 V16 L12 21" />
      </svg>
    ),
  },
  {
    id: 'tata',
    name: 'Tata Communications',
    badge: 'Vayu Cloud',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <ellipse cx="12" cy="12" rx="9" ry="5" />
        <path d="M3 12c0 4.97 4.03 9 9 9s9-4.03 9-9" />
        <circle cx="12" cy="12" r="2.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'nebius',
    name: 'Nebius AI',
    badge: 'AI-Centric',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 15a5 5 0 1 1 5-5 5 5 0 0 1-5 5z" />
        <circle cx="12" cy="12" r="1.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'cyfuture',
    name: 'Cyfuture Cloud',
    badge: 'Tier-IV',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
  {
    id: 'together',
    name: 'Together AI',
    badge: 'Compute Fabric',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="8" cy="12" r="5" />
        <circle cx="16" cy="12" r="5" strokeDasharray="2 2" />
        <path d="M12 8.5v7" />
      </svg>
    ),
  },
  {
    id: 'crusoe',
    name: 'Crusoe Cloud',
    badge: 'Climate-Aligned',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
      </svg>
    ),
  },
  {
    id: 'neysa',
    name: 'Neysa AI',
    badge: 'Enterprise GenAI',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <polygon points="12 2 22 12 12 22 2 12 12 2" />
        <polygon points="12 6 18 12 12 18 6 12 12 6" fill="currentColor" fillOpacity="0.2" />
      </svg>
    ),
  },
  {
    id: 'sify',
    name: 'Sify Technologies',
    badge: 'Green HPC',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="7" height="7" x="3" y="3" rx="1" />
        <rect width="7" height="7" x="14" y="3" rx="1" />
        <rect width="7" height="7" x="3" y="14" rx="1" />
        <rect width="7" height="7" x="14" y="14" rx="1" fill="currentColor" fillOpacity="0.2" />
      </svg>
    ),
  },
  {
    id: 'fluidstack',
    name: 'FluidStack',
    badge: 'Global Fleet',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect width="18" height="4" x="3" y="4" rx="1" />
        <rect width="18" height="4" x="3" y="10" rx="1" />
        <rect width="18" height="4" x="3" y="16" rx="1" />
        <circle cx="7" cy="6" r="0.8" fill="currentColor" />
        <circle cx="7" cy="12" r="0.8" fill="currentColor" />
        <circle cx="7" cy="18" r="0.8" fill="currentColor" />
      </svg>
    ),
  },
  {
    id: 'nxtgen',
    name: 'NxtGen',
    badge: 'Datacenter Cloud',
    renderLogo: () => (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M4 17l6-6-6-6" />
        <path d="M12 17l6-6-6-6" />
        <path d="M18 19h2" />
      </svg>
    ),
  },
]

export const ProviderMarquee: FC = () => {
  return (
    <section className="strip" aria-label="Supported GPU providers">
      <div className="marquee">
        {[0, 1].map((n) => (
          <div className="marquee__track" key={n} aria-hidden={n === 1}>
            {PROVIDERS.map((p, i) => (
              <div className="strip__provider" key={`${n}-${p.id}-${i}`}>
                <span className="strip__logo">{p.renderLogo()}</span>
                <span className="strip__name">{p.name}</span>
                {p.badge && (
                  <span className={`strip__badge ${p.isLive ? '' : 'strip__badge--dim'}`}>
                    {p.badge}
                  </span>
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
