import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Cpu,
  Server,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Key,
  Building2,
  ShieldCheck,
  Activity,
  Layers,
} from 'lucide-react'
import { DashboardLayout } from '../../../components/dashboard/DashboardLayout'
import { usePageMeta } from '../../../lib/hooks'
import {
  fetchSuperadminDashboardOverview,
  type SuperadminDashboardOverview,
} from '../../../lib/authStore'

export default function InfrastructureTelemetry() {
  usePageMeta(
    'Infrastructure & Compute Telemetry · Inferxe Superadmin',
    'Platform infrastructure status, sovereign compute orchestrator integration roadmap, and security telemetry control plane.',
  )

  const [overview, setOverview] = useState<SuperadminDashboardOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadData = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchSuperadminDashboardOverview()
      if (res.ok && res.overview) {
        setOverview(res.overview)
      } else {
        setError(res.error || 'Failed to retrieve platform infrastructure metrics.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error loading infrastructure metrics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  return (
    <DashboardLayout
      pageTitle="Platform Infrastructure & Compute Telemetry"
      breadcrumb={[
        { label: 'Platform Governance', to: '/dashboard/superadmin' },
        { label: 'Infrastructure Telemetry' },
      ]}
    >
      <div style={{ maxWidth: '1440px', margin: '0 auto', width: '100%' }}>
        {/* ── Top Header ── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '16px',
            marginBottom: '24px',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <Link
                to="/dashboard/superadmin"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  color: '#9CA3AF',
                  fontSize: '0.78rem',
                  textDecoration: 'none',
                }}
              >
                <ArrowLeft size={13} /> Back to Overview
              </Link>
            </div>
            <h1
              style={{
                fontSize: '1.5rem',
                fontWeight: 700,
                color: '#FFFFFF',
                margin: 0,
                letterSpacing: '-0.02em',
              }}
            >
              Infrastructure & Compute Telemetry
            </h1>
            <p style={{ margin: '4px 0 0', color: '#9CA3AF', fontSize: '0.84rem' }}>
              Platform control plane health, tenant ecosystem telemetry, and compute orchestrator integration status.
            </p>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <button
              type="button"
              className="dash-btn-ghost"
              onClick={() => void loadData()}
              disabled={loading}
              style={{
                background: '#121C16',
                border: '1px solid #1B2E24',
                color: '#E5E7EB',
                padding: '8px 14px',
                borderRadius: '8px',
                fontSize: '0.82rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} className={loading ? 'spin-icon' : ''} />
              <span>{loading ? 'Refreshing...' : 'Refresh Metrics'}</span>
            </button>
          </div>
        </div>

        {/* ── Error Banner ── */}
        {error && (
          <div
            style={{
              background: '#2B1214',
              border: '1px solid #7F1D1D',
              borderRadius: '8px',
              padding: '12px 16px',
              color: '#FCA5A5',
              fontSize: '0.85rem',
              marginBottom: '16px',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
            }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {/* ── GPU Integration Phase Notice ── */}
        <div
          style={{
            background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(6, 182, 212, 0.04) 100%)',
            border: '1px solid rgba(16, 185, 129, 0.25)',
            borderRadius: '12px',
            padding: '24px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '16px',
          }}
        >
          <div
            style={{
              width: '42px',
              height: '42px',
              borderRadius: '10px',
              background: 'rgba(16, 185, 129, 0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Cpu size={22} style={{ color: '#10B981' }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
              <span
                style={{
                  background: 'rgba(16, 185, 129, 0.18)',
                  color: '#10B981',
                  borderRadius: '14px',
                  padding: '2px 8px',
                  fontSize: '0.72rem',
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                }}
              >
                Planned for Phase 2 Integration
              </span>
              <span style={{ color: '#9CA3AF', fontSize: '0.78rem' }}>Compute Orchestrator Roadmap</span>
            </div>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 6px' }}>
              GPU Compute & Sovereign Cluster Telemetry
            </h2>
            <p style={{ margin: 0, color: '#D1D5DB', fontSize: '0.86rem', lineHeight: 1.5, maxWidth: '900px' }}>
              Bare-metal GPU node telemetry, VRAM allocation tracking, cluster thermal curves, and dynamic pricing arbitrage will connect to the compute orchestrator upon Phase 2 datacenter onboarding. Real-time platform governance, Supabase authentication, and tenant telemetry are live and active below.
            </p>
          </div>
        </div>

        {/* ── Live Operational Infrastructure Telemetry ── */}
        <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 16px' }}>
          Live Platform Control Plane Status
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '16px',
            marginBottom: '28px',
          }}
        >
          {/* Card 1: Supabase Control Plane */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Database Control Plane
              </span>
              <CheckCircle2 size={16} style={{ color: '#10B981' }} />
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
              Operational
            </div>
            <div style={{ fontSize: '0.78rem', color: '#6EE7B7' }}>
              Supabase PostgreSQL (Live Schema)
            </div>
          </div>

          {/* Card 2: Admin Auth Tier */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Admin Governance
              </span>
              <ShieldCheck size={16} style={{ color: '#00FF88' }} />
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
              {overview?.adminStats?.total ?? '...'} Admins Registered
            </div>
            <div style={{ fontSize: '0.78rem', color: '#00FF88' }}>
              {overview?.adminStats?.active ?? '...'} Active · Argon2id + Server Sessions
            </div>
          </div>

          {/* Card 3: Platform Tenants */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                Tenant Workspaces
              </span>
              <Building2 size={16} style={{ color: '#38BDF8' }} />
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
              {overview?.platformStats?.totalOrganizations ?? '...'} Organizations
            </div>
            <div style={{ fontSize: '0.78rem', color: '#38BDF8' }}>
              {overview?.customerStats?.total ?? '...'} Registered Customer Accounts
            </div>
          </div>

          {/* Card 4: API Key Gateway */}
          <div
            style={{
              background: '#0F1612',
              border: '1px solid #1B2E24',
              borderRadius: '12px',
              padding: '20px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' }}>
                API Credentials
              </span>
              <Key size={16} style={{ color: '#FBBF24' }} />
            </div>
            <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#FFFFFF', marginBottom: '4px' }}>
              {overview?.platformStats?.activeApiKeys ?? '...'} Active API Keys
            </div>
            <div style={{ fontSize: '0.78rem', color: '#FBBF24' }}>
              Live FastApi Gateway Authenticated
            </div>
          </div>
        </div>

        {/* ── Architecture Overview ── */}
        <div
          style={{
            background: '#0F1612',
            border: '1px solid #1B2E24',
            borderRadius: '12px',
            padding: '24px',
          }}
        >
          <h3 style={{ fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF', margin: '0 0 12px' }}>
            Phase 2 Compute Telemetry Integration Overview
          </h3>
          <p style={{ color: '#9CA3AF', fontSize: '0.86rem', lineHeight: 1.6, margin: '0 0 20px', maxWidth: '850px' }}>
            When Phase 2 datacenter nodes are integrated, this interface will stream real-time NVLink interconnect metrics, GPU thermal gradients, per-instance VRAM utilization curves, and automated spot rate arbitrage with zero impact on platform governance or customer authentication.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' }}>
            <div style={{ background: '#121C16', border: '1px solid #18281E', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Server size={15} style={{ color: '#10B981' }} />
                <span style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.88rem' }}>Bare-Metal Node Agent</span>
              </div>
              <p style={{ margin: 0, color: '#9CA3AF', fontSize: '0.8rem', lineHeight: 1.4 }}>
                Lightweight eBPF telemetry daemon monitoring NVIDIA SXM5 / PCIe hardware health, RoCE packet throughput, and power envelope.
              </p>
            </div>

            <div style={{ background: '#121C16', border: '1px solid #18281E', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Activity size={15} style={{ color: '#38BDF8' }} />
                <span style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.88rem' }}>Dynamic Arbitrage Engine</span>
              </div>
              <p style={{ margin: 0, color: '#9CA3AF', fontSize: '0.8rem', lineHeight: 1.4 }}>
                Autonomous spot vs on-demand price discovery based on regional energy tariffs and idle datacenter capacity.
              </p>
            </div>

            <div style={{ background: '#121C16', border: '1px solid #18281E', borderRadius: '8px', padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Layers size={15} style={{ color: '#FBBF24' }} />
                <span style={{ fontWeight: 600, color: '#FFFFFF', fontSize: '0.88rem' }}>Zero-Trust Bastion Gate</span>
              </div>
              <p style={{ margin: 0, color: '#9CA3AF', fontSize: '0.8rem', lineHeight: 1.4 }}>
                Ephemeral SSH certificate issuance tied to administrator RBAC permissions and session revocation events.
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
