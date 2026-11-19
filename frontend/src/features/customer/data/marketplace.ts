/**
 * GPU marketplace view models, built only from the customer's workspace records
 * (`gpu_providers`, `gpu_listings`, `saved_gpu_listings`).
 *
 * Nothing is invented: providers, specs, prices and quantities are shown exactly as recorded.
 * Specs (`vram`, `bandwidth`, `tflops`) are free text in the database, so they are displayed
 * verbatim without assuming units. There are no ratings, scores or availability estimates.
 */
import { toFiniteNumber } from './selectors'
import type { CustomerWorkspace } from './types'

export interface ListingView {
  id: string
  name: string
  gpuModel: string
  providerId: string | null
  providerName: string | null
  region: string | null
  vram: string | null
  architecture: string | null
  bandwidth: string | null
  tflops: string | null
  quantity: number | null
  hourlyPrice: number | null
  currency: string | null
  saved: boolean
  savedAt: string | null
}

export type ListingSort = 'price-asc' | 'price-desc' | 'name' | 'quantity-desc'

const text = (value: unknown): string | null => {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s ? s : null
}

export function selectListings(ws: CustomerWorkspace): ListingView[] {
  const providers = new Map(ws.gpu_providers.map((p) => [p.id, p]))
  const saved = new Map(ws.saved_gpu_listings.map((s) => [s.listing_id, s]))
  return ws.gpu_listings.map((l): ListingView => {
    const provider = l.provider_id ? providers.get(l.provider_id) : undefined
    const quantity = toFiniteNumber(l.quantity)
    return {
      id: l.id,
      name: text(l.name) ?? text(l.gpu_model) ?? 'GPU listing',
      gpuModel: text(l.gpu_model) ?? text(l.name) ?? 'GPU',
      providerId: l.provider_id ?? null,
      providerName: provider ? text(provider.name) : null,
      region: text(l.region) ?? (provider ? text(provider.region) : null),
      vram: text(l.vram),
      architecture: text(l.architecture),
      bandwidth: text(l.bandwidth),
      tflops: text(l.tflops),
      quantity: quantity === null ? null : Math.max(0, Math.trunc(quantity)),
      hourlyPrice: toFiniteNumber(l.hourly_price),
      currency: text(l.currency),
      saved: saved.has(l.id),
      savedAt: saved.get(l.id)?.created_at ?? null,
    }
  })
}

/** Saved listings that are no longer in the available listings (so they can only be removed). */
export function selectUnavailableSaved(ws: CustomerWorkspace): Array<{ listingId: string; savedAt: string | null }> {
  const available = new Set(ws.gpu_listings.map((l) => l.id))
  return ws.saved_gpu_listings
    .filter((s) => !available.has(s.listing_id))
    .map((s) => ({ listingId: s.listing_id, savedAt: s.created_at }))
}

/* ── Deployment records (read-only) ── */

export interface DeploymentView {
  id: string
  name: string
  model: string | null
  gpu: string | null
  region: string | null
  /** The status value stored on the record. It does not mean anything is running. */
  recordedStatus: string | null
  /** Recorded hourly rate — only when its currency is also recorded (otherwise both are null). */
  hourlyRate: number | null
  currency: string | null
  createdAt: string | null
}

/**
 * Deployment records exactly as stored. A rate is shown only together with its recorded currency.
 * Endpoint URLs, metadata and identifiers are intentionally left out.
 */
export function selectDeployments(ws: CustomerWorkspace): DeploymentView[] {
  return ws.deployments
    .map((d): DeploymentView => {
      const rate = toFiniteNumber(d.hourly_rate)
      const currency = text(d.currency ?? null)?.toUpperCase() ?? null
      const priced = rate !== null && rate >= 0 && !!currency && /^[A-Z]{3}$/.test(currency)
      return {
        id: d.id,
        name: text(d.name) ?? 'Untitled deployment',
        model: text(d.model_name),
        gpu: text(d.gpu_model),
        region: text(d.region),
        recordedStatus: text(d.status),
        hourlyRate: priced ? rate : null,
        currency: priced ? currency : null,
        createdAt: d.created_at ?? null,
      }
    })
    .sort((a, b) => (Date.parse(b.createdAt ?? '') || 0) - (Date.parse(a.createdAt ?? '') || 0))
}

export interface Burn {
  /** Sum of recorded rates of running deployments priced in `currency`, or null when none are. */
  perHour: number | null
  /** Running deployments that have no rate in `currency` (not counted in perHour). */
  unpriced: number
}

/** Hourly burn of deployments recorded as running, in one currency only (currencies are never mixed). */
export function selectBurn(deployments: DeploymentView[], currency: string): Burn {
  const running = deployments.filter((d) => (d.recordedStatus ?? '').toLowerCase() === 'running')
  const priced = running.filter((d) => d.hourlyRate !== null && d.currency === currency)
  return {
    perHour: priced.length ? priced.reduce((sum, d) => sum + d.hourlyRate!, 0) : null,
    unpriced: running.length - priced.length,
  }
}

export interface ListingFilters {
  query: string
  providerId: string
  region: string
  savedOnly: boolean
}

export function filterListings(listings: ListingView[], f: ListingFilters): ListingView[] {
  const q = f.query.trim().toLowerCase()
  return listings.filter((l) => {
    if (f.providerId && l.providerId !== f.providerId) return false
    if (f.region && l.region !== f.region) return false
    if (f.savedOnly && !l.saved) return false
    if (!q) return true
    return [l.name, l.gpuModel, l.providerName, l.region, l.architecture].some((v) => (v ?? '').toLowerCase().includes(q))
  })
}

export function sortListings(listings: ListingView[], sort: ListingSort): ListingView[] {
  const byName = (a: ListingView, b: ListingView) => a.gpuModel.localeCompare(b.gpuModel) || a.name.localeCompare(b.name)
  const sorted = [...listings]
  switch (sort) {
    case 'price-asc':
      return sorted.sort((a, b) => (a.hourlyPrice ?? Infinity) - (b.hourlyPrice ?? Infinity) || byName(a, b))
    case 'price-desc':
      // listings without a price always sort last
      return sorted.sort((a, b) => (b.hourlyPrice ?? -Infinity) - (a.hourlyPrice ?? -Infinity) || byName(a, b))
    case 'quantity-desc':
      return sorted.sort((a, b) => (b.quantity ?? -1) - (a.quantity ?? -1) || byName(a, b))
    default:
      return sorted.sort(byName)
  }
}

/** Distinct, sorted values for the filter dropdowns. */
export function selectFilterOptions(listings: ListingView[]): { providers: Array<{ id: string; name: string }>; regions: string[] } {
  const providers = new Map<string, string>()
  const regions = new Set<string>()
  for (const l of listings) {
    if (l.providerId && l.providerName) providers.set(l.providerId, l.providerName)
    if (l.region) regions.add(l.region)
  }
  return {
    providers: [...providers.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    regions: [...regions].sort((a, b) => a.localeCompare(b)),
  }
}
