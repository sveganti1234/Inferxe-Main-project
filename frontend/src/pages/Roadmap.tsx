import { CheckCircle2 } from 'lucide-react'
import { PageHero } from '../components/PageHero'
import { Plate } from '../components/ui/Glass'
import { LinkButton } from '../components/ui/Button'
import { usePageMeta } from '../lib/hooks'

const MILESTONES = [
  {
    phase: 'Q4 2026',
    status: 'Live / MVP',
    badgeClass: 'chip--lime',
    title: 'Sovereign Indian Mesh & vLLM Control Plane',
    items: [
      'Low-latency routing across Yotta NM1 (Navi Mumbai) and E2E Cloud sovereign nodes.',
      'Unified OpenAI-compatible API layer with continuous token streaming.',
      'Real-time KV-cache and VRAM placement engine for L4, L40S, and H100 clusters.',
      'Enterprise RBAC with custom spend quotas and user invitation workflows.',
    ],
  },
  {
    phase: 'Q1 2027',
    status: 'In Engineering',
    badgeClass: 'chip--cyan',
    title: 'Blackwell Clusters & DeepSeek R1 MoE Support',
    items: [
      'GB200 / B200 NVLink rack-scale topology placement for frontier MoE architectures.',
      'Sovereign spot-market arbitrage: automatic preemptible instance recovery.',
      'Custom LoRA adapter swapping on shared base model memory pools.',
      'Sub-5ms telemetry pipeline for TTFT and P99 latency anomaly detection.',
    ],
  },
  {
    phase: 'Q2 2027',
    status: 'Benchmarking',
    badgeClass: 'chip--amber',
    title: 'Cross-Datacenter KV Caching & Zero-Egress Storage',
    items: [
      'Distributed prefix caching across multi-city Indian datacenters.',
      'Zero-egress model weight sync using encrypted peer-to-peer interconnects.',
      'Automated SLA penalty arbitration backed by immutable telemetry logs.',
      'Self-hosted provider agent with one-command Docker & Kubernetes daemon setup.',
    ],
  },
  {
    phase: 'Q3 2027',
    status: 'Planned',
    badgeClass: '',
    title: 'Global Sovereign Inference Federation',
    items: [
      'Expansion into European & APAC sovereign datacenters with strict local residency.',
      'Decentralized payment clearing in multi-currency fiat and enterprise escrow.',
      'End-to-end confidential compute with hardware-attested enclave verification.',
      'Autonomous dynamic re-routing across 50+ tier-IV datacenter partners.',
    ],
  },
]

export default function Roadmap() {
  usePageMeta('Infrastructure Roadmap · Inferxe', 'Timeline and future milestones for the Inferxe GPU marketplace, sovereign clusters, and intelligent inference routing.')

  return (
    <div className="inner-page">
      <PageHero
        crumb="Roadmap"
        eyebrow="Strategic Roadmap"
        title={['The roadmap to', 'sovereign AI infrastructure']}
        lead="Our technical milestones from MVP sovereign routing to rack-scale Blackwell clusters and global datacenter federation."
        image="/images/nodes.webp"
        actions={
          <div className="row row--wrap" style={{ gap: 12 }}>
            <LinkButton to="/platform" arrow>
              Explore Platform
            </LinkButton>
            <LinkButton to="/contact" variant="glass">
              Request Early Access
            </LinkButton>
          </div>
        }
      />

      <section className="section">
        <div className="container" style={{ maxWidth: 880 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {MILESTONES.map((m) => (
              <Plate key={m.phase} style={{ padding: 24 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div className="row" style={{ gap: 10 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.86rem', fontWeight: 700, color: 'var(--brand-hi)' }}>
                      {m.phase}
                    </span>
                    <span className={`chip ${m.badgeClass}`} style={{ fontSize: '0.68rem', padding: '2px 8px' }}>
                      {m.status}
                    </span>
                  </div>
                </div>

                <h3 className="h3" style={{ fontSize: '1.15rem', color: 'var(--ink)', marginBottom: 14 }}>
                  {m.title}
                </h3>

                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {m.items.map((it) => (
                    <li key={it} className="row" style={{ alignItems: 'flex-start', gap: 10, fontSize: '0.84rem', color: 'var(--ink-2)' }}>
                      <CheckCircle2 size={15} style={{ color: 'var(--brand)', flexShrink: 0, marginTop: 2 }} />
                      <span>{it}</span>
                    </li>
                  ))}
                </ul>
              </Plate>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
