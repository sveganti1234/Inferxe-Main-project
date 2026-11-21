import {
  getAuthenticatedPortalRole,
  getSession,
  isDevelopmentBypassToken,
  type SuperadminGpuCluster,
  type SuperadminTelemetryData,
} from './authStore'
import type { GeoDistributionItem, NodeHealthStatus } from '../components/dashboard/SovereignNodesMap'
import type { GpuModel } from '../components/dashboard/InteractivePriceHistoryChart'

export type InfrastructureDataSource = 'live' | 'demo'

export interface GpuNodeHealthCardData {
  id: string
  clusterId: string
  clusterName: string
  gpuModel: string
  provider: string
  region: string
  totalGpus: number
  availableGpus: number
  allocatedGpus: number
  status: NodeHealthStatus
  utilizationPct: number
  vramUsedGb: number
  vramTotalGb: number
  vramUtilizationPct: number
  temperatureC: number
  powerW: number
  spotRateHour: number
  onDemandRateHour: number
  marginPct: number
  uptime: string
  dataSource: InfrastructureDataSource
}

export interface GpuTelemetryFetchResult {
  ok: boolean
  telemetry?: SuperadminTelemetryData
  dataSource?: InfrastructureDataSource
  status?: number
  unauthorized?: boolean
  forbidden?: boolean
  serviceUnavailable?: boolean
  error?: string
}

export interface GpuHourlyRateTarget {
  id: string
  clusterId: string
  clusterName: string
  gpuModel: string
  provider: string
  region: string
  currentSpotRate: number
  currentOnDemandRate: number
}

export interface GpuHourlyRateUpdateRequest {
  targetId: string
  clusterId: string
  gpuModel: string
  newHourlyRate: number
  reason: string
}

export interface GpuHourlyRateUpdateResult {
  ok: boolean
  status?: number
  backendPending?: boolean
  message?: string
  error?: string
}

export interface GpuPricingPersistenceConfig {
  backendPersistenceAvailable: boolean
  plannedEndpoint: string
  pendingReason: string
}

/**
 * Explicit capability flag for Super Admin GPU pricing persistence.
 * Set to `false` until Phase 3 implements the authenticated, audited backend endpoint.
 */
export const GPU_PRICING_PERSISTENCE_CONFIG: GpuPricingPersistenceConfig = {
  backendPersistenceAvailable: false,
  plannedEndpoint: 'PATCH /api/superadmin/gpu/listings/:id/pricing',
  pendingReason:
    'Backend GPU pricing persistence is pending Phase 3 integration. Saving is disabled so changes are never falsely reported as persisted.',
}

function getAuthHeaders(): HeadersInit {
  const session = getSession()
  return {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(session?.token ? { Authorization: `Bearer ${session.token}` } : {}),
  }
}

/**
 * Fetch GPU infrastructure cluster telemetry using the verified HS256 Super Admin JWT.
 * Fails closed on 401, 403, 503, invalid payloads, and network errors.
 */
export async function fetchGpuInfrastructureTelemetry(): Promise<GpuTelemetryFetchResult> {
  const session = getSession()
  if (!session?.token || isDevelopmentBypassToken(session.token)) {
    return {
      ok: false,
      status: 401,
      unauthorized: true,
      error:
        'A verified Super Admin session is required to load GPU infrastructure telemetry. Please sign in again.',
    }
  }

  try {
    const res = await fetch('/api/superadmin/telemetry', {
      headers: getAuthHeaders(),
    })

    const payload = await res.json().catch(() => null)

    if (res.status === 401) {
      return {
        ok: false,
        status: 401,
        unauthorized: true,
        error:
          (payload && typeof payload.error === 'string' && payload.error) ||
          'Authentication expired or invalid. Please sign in again with a Super Admin account.',
      }
    }

    if (res.status === 403) {
      return {
        ok: false,
        status: 403,
        forbidden: true,
        error:
          (payload && typeof payload.error === 'string' && payload.error) ||
          'Access denied: Super Admin privileges are required to view privileged GPU infrastructure controls.',
      }
    }

    if (res.status === 503) {
      return {
        ok: false,
        status: 503,
        serviceUnavailable: true,
        error:
          (payload && typeof payload.error === 'string' && payload.error) ||
          'GPU infrastructure telemetry service is temporarily unavailable.',
      }
    }

    if (!res.ok || !payload || typeof payload !== 'object' || payload.ok !== true) {
      return {
        ok: false,
        status: res.status,
        error:
          (payload && typeof payload.error === 'string' && payload.error) ||
          `Failed to load GPU infrastructure telemetry (HTTP ${res.status}).`,
      }
    }

    const telemetry = payload.telemetry as SuperadminTelemetryData | undefined
    if (!telemetry || !Array.isArray(telemetry.clusters) || !telemetry.summary) {
      return {
        ok: false,
        status: res.status,
        error: 'Backend returned an invalid GPU telemetry payload.',
      }
    }

    // Only classify telemetry as 'live' when the backend explicitly attests live hardware/DB backing.
    const isLive = Boolean(
      (payload as { is_live?: unknown }).is_live === true ||
        (telemetry as { isLive?: unknown }).isLive === true,
    )

    return {
      ok: true,
      status: res.status,
      telemetry,
      dataSource: isLive ? 'live' : 'demo',
    }
  } catch (err) {
    return {
      ok: false,
      serviceUnavailable: true,
      error:
        err instanceof Error
          ? `Unable to reach GPU telemetry backend: ${err.message}`
          : 'Unable to reach GPU telemetry backend.',
    }
  }
}

/**
 * Service contract for Super Admin hourly rate updates.
 * Enforces role, positive pricing, and audit reason validation client-side,
 * and refuses to fake persistence while the Phase 3 backend endpoint is unavailable.
 */
export async function updateGpuHourlyRate(
  request: GpuHourlyRateUpdateRequest,
): Promise<GpuHourlyRateUpdateResult> {
  const session = getSession()
  if (!session?.token || isDevelopmentBypassToken(session.token)) {
    return {
      ok: false,
      status: 401,
      error: 'A verified Super Admin session is required to update GPU pricing.',
    }
  }

  if (getAuthenticatedPortalRole(session) !== 'superadmin') {
    return {
      ok: false,
      status: 403,
      error: 'Forbidden: Only Super Admin accounts can modify global GPU hourly pricing.',
    }
  }

  if (!Number.isFinite(request.newHourlyRate) || request.newHourlyRate <= 0) {
    return {
      ok: false,
      status: 400,
      error: 'Hourly rate must be a valid positive number greater than ₹0.',
    }
  }

  if (!request.reason || request.reason.trim().length < 5) {
    return {
      ok: false,
      status: 400,
      error: 'Please provide an audit reason of at least 5 characters for this pricing change.',
    }
  }

  if (!GPU_PRICING_PERSISTENCE_CONFIG.backendPersistenceAvailable) {
    return {
      ok: false,
      status: 501,
      backendPending: true,
      error: GPU_PRICING_PERSISTENCE_CONFIG.pendingReason,
    }
  }

  return {
    ok: false,
    status: 501,
    backendPending: true,
    error: GPU_PRICING_PERSISTENCE_CONFIG.pendingReason,
  }
}

function mapClusterStatusToHealth(
  clusterStatus: SuperadminGpuCluster['status'],
  avgTempC: number,
): NodeHealthStatus {
  if (clusterStatus === 'degraded' || avgTempC >= 80) return 'Degraded'
  if (clusterStatus === 'warning') return 'Maintenance'
  return 'Healthy'
}

/**
 * Derive typed GPU Node Health Cards from cluster telemetry.
 */
export function mapClustersToNodeHealthCards(
  clusters: SuperadminGpuCluster[],
  dataSource: InfrastructureDataSource,
): GpuNodeHealthCardData[] {
  const cards: GpuNodeHealthCardData[] = []

  for (const cluster of clusters) {
    for (let idx = 0; idx < cluster.gpus.length; idx++) {
      const gpu = cluster.gpus[idx]
      const totalGpus = Math.max(0, gpu.total)
      const allocatedGpus = Math.max(0, Math.min(totalGpus, gpu.allocated))
      const availableGpus = Math.max(0, totalGpus - allocatedGpus)
      const utilizationPct = totalGpus > 0 ? Math.round((allocatedGpus / totalGpus) * 100) : 0
      const vramUtilizationPct =
        gpu.vramTotalGb > 0 ? Math.round((gpu.vramUsedGb / gpu.vramTotalGb) * 100) : 0

      cards.push({
        id: `${cluster.id}::${idx}`,
        clusterId: cluster.id,
        clusterName: cluster.name,
        gpuModel: gpu.type,
        provider: cluster.provider,
        region: cluster.region,
        totalGpus,
        availableGpus,
        allocatedGpus,
        status: mapClusterStatusToHealth(cluster.status, gpu.avgTempC),
        utilizationPct,
        vramUsedGb: gpu.vramUsedGb,
        vramTotalGb: gpu.vramTotalGb,
        vramUtilizationPct,
        temperatureC: gpu.avgTempC,
        powerW: gpu.powerW,
        spotRateHour: cluster.spotRateHour,
        onDemandRateHour: cluster.onDemandRateHour,
        marginPct: cluster.marginPct,
        uptime: cluster.uptime,
        dataSource,
      })
    }
  }

  return cards
}

/**
 * Derive Hourly Rate Editor targets from loaded clusters.
 */
export function mapClustersToPricingTargets(
  clusters: SuperadminGpuCluster[],
): GpuHourlyRateTarget[] {
  const targets: GpuHourlyRateTarget[] = []
  for (const cluster of clusters) {
    for (let idx = 0; idx < cluster.gpus.length; idx++) {
      const gpu = cluster.gpus[idx]
      targets.push({
        id: `${cluster.id}::${idx}`,
        clusterId: cluster.id,
        clusterName: cluster.name,
        gpuModel: gpu.type,
        provider: cluster.provider,
        region: cluster.region,
        currentSpotRate: cluster.spotRateHour,
        currentOnDemandRate: cluster.onDemandRateHour,
      })
    }
  }
  return targets
}

/**
 * Map cluster regions to SovereignNodesMap markers with health status.
 */
export function mapClustersToMapNodes(
  clusters: SuperadminGpuCluster[],
  averageLatencyMs?: number,
): GeoDistributionItem[] {
  const totalGpusAcrossClusters = clusters.reduce(
    (sum, c) => sum + c.gpus.reduce((s, g) => s + g.total, 0),
    0,
  )

  return clusters.map((cluster, idx) => {
    const totalGpus = cluster.gpus.reduce((s, g) => s + g.total, 0)
    const allocatedGpus = cluster.gpus.reduce((s, g) => s + g.allocated, 0)
    const availableGpus = Math.max(0, totalGpus - allocatedGpus)
    const maxTemp = cluster.gpus.reduce((m, g) => Math.max(m, g.avgTempC), 0)
    const health = mapClusterStatusToHealth(cluster.status, maxTemp)
    const pct = totalGpusAcrossClusters > 0 ? Math.round((totalGpus / totalGpusAcrossClusters) * 100) : 0

    // Spread Indian datacenter pins slightly so clusters remain individually hoverable on the vector map
    const regionLower = cluster.region.toLowerCase()
    let cx = 598
    let cy = 476
    if (regionLower.includes('bangalore') || regionLower.includes('bengaluru')) {
      cx = 598
      cy = 492
    } else if (regionLower.includes('navi mumbai')) {
      cx = 588
      cy = 478
    } else if (regionLower.includes('mumbai')) {
      cx = 582
      cy = 472
    } else if (regionLower.includes('hyderabad')) {
      cx = 602
      cy = 482
    } else if (regionLower.includes('delhi') || regionLower.includes('noida')) {
      cx = 596
      cy = 456
    } else {
      cx = 590 + idx * 8
      cy = 474 + idx * 6
    }

    return {
      id: cluster.id,
      name: cluster.name,
      percentage: `${pct}%`,
      percentVal: pct,
      cx,
      cy,
      radius: Math.max(10, Math.min(20, Math.round(totalGpus / 6))),
      nodes: totalGpus,
      availableGpus,
      totalGpus,
      latency:
        typeof averageLatencyMs === 'number' && Number.isFinite(averageLatencyMs)
          ? `${averageLatencyMs.toFixed(1)} ms`
          : '—',
      region: cluster.region,
      dc: cluster.provider,
      provider: cluster.provider,
      gpuModels: cluster.gpus.map((g) => g.type),
      health,
    }
  })
}

/**
 * Resolve a matching live hourly rate for a selected GPU model when live backend data is active.
 */
export function resolveLiveRateForGpuModel(
  clusters: SuperadminGpuCluster[],
  gpuModel: GpuModel,
  dataSource: InfrastructureDataSource,
): number | null {
  if (dataSource !== 'live') return null
  const needle = gpuModel.toLowerCase()
  for (const cluster of clusters) {
    if (cluster.gpus.some((g) => g.type.toLowerCase().includes(needle))) {
      return cluster.spotRateHour
    }
  }
  return null
}

