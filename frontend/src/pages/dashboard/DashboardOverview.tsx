import { Navigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { DashboardLayout } from '../../components/dashboard/DashboardLayout'
import { InteractiveTelemetryGraph } from '../../components/dashboard/InteractiveTelemetryGraph'
import { Tilt } from '../../components/ui/Tilt'
import { Counter } from '../../components/ui/Counter'
import { usePageMeta } from '../../lib/hooks'
import { getSession, getPortalRole } from '../../lib/authStore'

interface DeploymentItem {
  id: string
  name: string
  model: string
  gpu: string
  status: 'Running' | 'Provisioning'
  price: string
}

const DEPLOYMENTS: DeploymentItem[] = [
  {
    id: 'dep-1',
    name: 'qwen-chat-prod',
    model: 'Qwen2.5 7B',
    gpu: 'L4',
    status: 'Running',
    price: '₹60/HR',
  },
  {
    id: 'dep-2',
    name: 'llama-8b-api',
    model: 'Llama 3.1 8B',
    gpu: 'L40S',
    status: 'Running',
    price: '₹100/HR',
  },
  {
    id: 'dep-3',
    name: 'mistral-eval',
    model: 'Mistral 7B',
    gpu: 'L40S',
    status: 'Provisioning',
    price: '₹100/HR',
  },
]

export default function DashboardOverview() {
  usePageMeta('Cluster Console · Inferxe Dashboard', 'LLM Inference Marketplace overview, live usage telemetry, and GPU routing.')

  const session = getSession()
  const portalRole = getPortalRole(session?.user?.role)

  if (portalRole === 'customer') {
    return <Navigate to="/dashboard/customer" replace />
  }

  return (
    <DashboardLayout
      pageTitle="Dashboard"
      breadcrumb={[]}
      hideHeader={true}
    >
      <div className="dash-overview-grid">
        {/* ── 1. Top 4 Metric Cards with Sparklines ─────────────── */}
        <motion.section
          className="dash-stats-row"
          aria-label="Key Performance Indicators"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Card 1: Active Deployments */}
          <Tilt max={5} className="dash-stat-tilt">
            <div className="dash-stat-card glass glass--lift">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="dash-stat-label engrave">Active Deployments</span>
              </div>
              <div className="dash-stat-value readout">
                <Counter to={3} />
              </div>
              <div className="dash-sparkline-wrap">
                <svg
                  viewBox="0 0 100 32"
                  preserveAspectRatio="none"
                  style={{
                    width: '100%',
                    height: 32,
                    display: 'block',
                    overflow: 'visible',
                    filter: 'drop-shadow(0 0 5px rgba(118, 185, 0, 0.45))',
                  }}
                >
                  <path
                    d="M 0 22 C 10 22, 16 28, 26 28 C 36 28, 42 8, 52 8 C 62 8, 68 28, 78 28 C 88 28, 94 14, 100 14"
                    fill="none"
                    stroke="#a3e635"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </Tilt>

          {/* Card 2: Est. Spend · Today */}
          <Tilt max={5} className="dash-stat-tilt">
            <div className="dash-stat-card glass glass--lift">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="dash-stat-label engrave">Est. Spend · Today</span>
                <span className="engrave" style={{ fontSize: '0.62rem', opacity: 0.7 }}>INR</span>
              </div>
              <div className="dash-stat-value readout">
                <Counter to={1240} prefix="₹" />
              </div>
              <div className="dash-sparkline-wrap">
                <svg
                  viewBox="0 0 100 32"
                  preserveAspectRatio="none"
                  style={{
                    width: '100%',
                    height: 32,
                    display: 'block',
                    overflow: 'visible',
                    filter: 'drop-shadow(0 0 5px rgba(118, 185, 0, 0.45))',
                  }}
                >
                  <path
                    d="M 0 24 C 35 22, 70 17, 100 8"
                    fill="none"
                    stroke="#a3e635"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </Tilt>

          {/* Card 3: P95 TTFT */}
          <Tilt max={5} className="dash-stat-tilt">
            <div className="dash-stat-card glass glass--lift">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="dash-stat-label engrave">P95 TTFT</span>
              </div>
              <div className="dash-stat-value readout">
                <Counter to={0.42} decimals={2} suffix=" s" />
              </div>
              <div className="dash-sparkline-wrap">
                <svg
                  viewBox="0 0 100 32"
                  preserveAspectRatio="none"
                  style={{
                    width: '100%',
                    height: 32,
                    display: 'block',
                    overflow: 'visible',
                    filter: 'drop-shadow(0 0 5px rgba(118, 185, 0, 0.45))',
                  }}
                >
                  <path
                    d="M 0 8 C 30 11, 55 19, 78 23 C 90 25, 100 26"
                    fill="none"
                    stroke="#a3e635"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </Tilt>

          {/* Card 4: Throughput */}
          <Tilt max={5} className="dash-stat-tilt">
            <div className="dash-stat-card glass glass--lift">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <span className="dash-stat-label engrave">Throughput</span>
              </div>
              <div className="dash-stat-value readout">
                <Counter to={118} suffix=" tok/s" />
              </div>
              <div className="dash-sparkline-wrap">
                <svg
                  viewBox="0 0 100 32"
                  preserveAspectRatio="none"
                  style={{
                    width: '100%',
                    height: 32,
                    display: 'block',
                    overflow: 'visible',
                    filter: 'drop-shadow(0 0 5px rgba(118, 185, 0, 0.45))',
                  }}
                >
                  <path
                    d="M 0 20 C 15 24, 25 14, 40 18 C 55 22, 70 12, 85 15 C 95 12, 100 10"
                    fill="none"
                    stroke="#a3e635"
                    strokeWidth="2.2"
                    strokeLinecap="round"
                  />
                </svg>
              </div>
            </div>
          </Tilt>
        </motion.section>

        {/* ── 2. Middle Row: Marketplace Telemetry Graph ─────────── */}
        <motion.section
          className="dash-middle-row"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.1, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Usage Telemetry Interactive Graph */}
          <InteractiveTelemetryGraph />
        </motion.section>

        {/* ── 3. Bottom Section: Active Deployments Rack ───────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '22px 4px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="engrave" style={{ fontSize: '0.74rem', letterSpacing: '0.12em' }}>
              Active Deployments Rack · Dedicated NVLink
            </span>
          </div>
          <span className="tag tag--clay" style={{ fontSize: '0.66rem', color: 'var(--brand-hi)' }}>
            3 Nodes Live
          </span>
        </div>

        <motion.section
          className="dash-deployments-list"
          aria-label="Deployments"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.2, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Table Header Row matching reference design */}
          <div className="dash-deploy-header" role="row">
            <span>Deployment</span>
            <span>Model</span>
            <span>GPU</span>
            <span>Status</span>
            <span style={{ textAlign: 'right' }}>Cost / Hour</span>
          </div>

          {DEPLOYMENTS.map((dep) => (
            <div key={dep.id} className="dash-deploy-row glass glass--lift" style={{ position: 'relative' }}>
              {/* Col 1: Status Dot & Deployment Name */}
              <div className="dash-deploy-name">
                <span
                  className={`dash-deploy-dot ${
                    dep.status === 'Running' ? 'dash-deploy-dot--running' : 'dash-deploy-dot--provisioning'
                  }`}
                  aria-label={dep.status}
                />
                <span style={{ fontWeight: 600 }}>{dep.name}</span>
              </div>

              {/* Col 2: Model Name */}
              <div className="dash-deploy-model" style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>
                {dep.model}
              </div>

              {/* Col 3: GPU Pill Badge */}
              <div>
                <span className="dash-deploy-gpu-badge" style={{ borderRadius: '9999px', padding: '3px 14px' }}>
                  {dep.gpu}
                </span>
              </div>

              {/* Col 4: Status Text */}
              <div className="dash-deploy-status">
                <span className="tag" style={{
                  borderRadius: '9999px',
                  padding: '3px 14px',
                  background: dep.status === 'Running' ? 'rgba(118, 185, 0, 0.14)' : 'rgba(245, 158, 11, 0.14)',
                  color: dep.status === 'Running' ? 'var(--brand-hi)' : 'var(--amber)',
                  fontWeight: 500,
                  fontSize: '0.78rem'
                }}>
                  {dep.status}
                </span>
              </div>

              {/* Col 5: Price Rate with Readout */}
              <div className="dash-deploy-price readout" style={{ fontSize: '0.84rem' }}>
                {dep.price}
              </div>
            </div>
          ))}
        </motion.section>
      </div>
    </DashboardLayout>
  )
}
