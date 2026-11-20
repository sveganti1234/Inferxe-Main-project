import { Cpu, Database, Layers, MapPin, Server, Thermometer, Zap } from 'lucide-react'
import type { GpuNodeHealthCardData } from '../../lib/gpuInfrastructureService'
import type { NodeHealthStatus } from './SovereignNodesMap'

export interface GpuNodeHealthCardProps {
  node: GpuNodeHealthCardData
}

const STATUS_BADGE_STYLES: Record<
  NodeHealthStatus,
  { color: string; bg: string; border: string }
> = {
  Healthy: {
    color: '#10b981',
    bg: 'rgba(16, 185, 129, 0.14)',
    border: 'rgba(16, 185, 129, 0.32)',
  },
  Degraded: {
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.14)',
    border: 'rgba(239, 68, 68, 0.35)',
  },
  Maintenance: {
    color: '#f59e0b',
    bg: 'rgba(245, 158, 11, 0.14)',
    border: 'rgba(245, 158, 11, 0.35)',
  },
}

export function GpuNodeHealthCard({ node }: GpuNodeHealthCardProps) {
  const statusStyle = STATUS_BADGE_STYLES[node.status]
  const isDemo = node.dataSource === 'demo'

  return (
    <div
      style={{
        background: '#0F1612',
        border: '1px solid #1B2E24',
        borderRadius: '12px',
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxShadow: '0 4px 18px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Top Row: GPU Model + Status + Demo/Live Tag */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: '10px',
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Cpu size={16} style={{ color: '#00FF88', flexShrink: 0 }} />
            <h3 style={{ margin: 0, fontSize: '0.96rem', fontWeight: 700, color: '#FFFFFF' }}>
              {node.gpuModel}
            </h3>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '4px',
              fontSize: '0.75rem',
              color: '#9CA3AF',
              flexWrap: 'wrap',
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <Server size={12} style={{ color: '#6EE7B7' }} />
              {node.provider}
            </span>
            <span>·</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <MapPin size={12} style={{ color: '#6EE7B7' }} />
              {node.region}
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '2px 8px',
              borderRadius: '999px',
              fontSize: '0.68rem',
              fontWeight: 700,
              background: statusStyle.bg,
              color: statusStyle.color,
              border: `1px solid ${statusStyle.border}`,
            }}
          >
            <span
              style={{
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                background: statusStyle.color,
              }}
            />
            {node.status}
          </span>

          {isDemo && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '2px 7px',
                borderRadius: '999px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.62rem',
                fontWeight: 700,
                letterSpacing: '0.05em',
                background: 'rgba(245, 158, 11, 0.14)',
                color: '#F59E0B',
                border: '1px solid rgba(245, 158, 11, 0.35)',
              }}
              title="Sample hardware telemetry values"
            >
              <Database size={9} />
              DEMO DATA
            </span>
          )}
        </div>
      </div>

      {/* Capacity Summary Strip */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '8px',
          background: '#0B130F',
          border: '1px solid #15241C',
          borderRadius: '8px',
          padding: '10px 12px',
        }}
      >
        <div>
          <div style={{ fontSize: '0.66rem', color: '#9CA3AF', textTransform: 'uppercase' }}>
            Total GPUs
          </div>
          <div style={{ fontSize: '0.96rem', fontWeight: 700, color: '#FFFFFF', marginTop: '2px' }}>
            {node.totalGpus}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.66rem', color: '#9CA3AF', textTransform: 'uppercase' }}>
            Available
          </div>
          <div
            style={{
              fontSize: '0.96rem',
              fontWeight: 700,
              color: node.availableGpus > 0 ? '#10B981' : '#F59E0B',
              marginTop: '2px',
            }}
          >
            {node.availableGpus}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.66rem', color: '#9CA3AF', textTransform: 'uppercase' }}>
            Spot Rate
          </div>
          <div style={{ fontSize: '0.96rem', fontWeight: 700, color: '#6EE7B7', marginTop: '2px' }}>
            ₹{node.spotRateHour}/hr
          </div>
        </div>
      </div>

      {/* Utilization & VRAM Progress Bars */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.74rem',
              marginBottom: '4px',
            }}
          >
            <span style={{ color: '#9CA3AF' }}>GPU Utilization</span>
            <span style={{ color: '#E5E7EB', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {node.utilizationPct}% ({node.allocatedGpus}/{node.totalGpus} allocated)
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '6px',
              background: '#121C16',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${node.utilizationPct}%`,
                height: '100%',
                background:
                  node.utilizationPct > 90
                    ? '#EF4444'
                    : node.utilizationPct > 75
                      ? '#10B981'
                      : '#38BDF8',
                borderRadius: '3px',
              }}
            />
          </div>
        </div>

        <div>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.74rem',
              marginBottom: '4px',
            }}
          >
            <span style={{ color: '#9CA3AF', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
              <Layers size={12} style={{ color: '#38BDF8' }} />
              VRAM Usage
            </span>
            <span style={{ color: '#E5E7EB', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {node.vramUsedGb.toLocaleString()} / {node.vramTotalGb.toLocaleString()} GB ({node.vramUtilizationPct}%)
            </span>
          </div>
          <div
            style={{
              width: '100%',
              height: '6px',
              background: '#121C16',
              borderRadius: '3px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${node.vramUtilizationPct}%`,
                height: '100%',
                background:
                  node.vramUtilizationPct > 90
                    ? '#EF4444'
                    : node.vramUtilizationPct > 75
                      ? '#10B981'
                      : '#38BDF8',
                borderRadius: '3px',
              }}
            />
          </div>
        </div>
      </div>

      {/* Bottom Row: Thermal + Power */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingTop: '10px',
          borderTop: '1px solid #15241C',
          fontSize: '0.76rem',
          color: '#D1D5DB',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Thermometer
            size={14}
            style={{ color: node.temperatureC >= 75 ? '#EF4444' : '#10B981' }}
          />
          <span>
            Temp:{' '}
            <strong
              style={{
                color: node.temperatureC >= 75 ? '#FCA5A5' : '#FFFFFF',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {node.temperatureC}°C
            </strong>
          </span>
        </span>

        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Zap size={14} style={{ color: '#FBBF24' }} />
          <span>
            Power:{' '}
            <strong style={{ color: '#FFFFFF', fontFamily: 'var(--font-mono)' }}>
              {node.powerW} W/unit
            </strong>
          </span>
        </span>
      </div>
    </div>
  )
}

