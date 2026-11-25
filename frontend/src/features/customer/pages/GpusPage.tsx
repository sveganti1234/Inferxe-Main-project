/**
 * GPU marketplace — sovereign GPU capacity and hardware listings.
 * Displays real provider records from GET /api/customer/workspace when available.
 * If live data is unavailable or unpopulated in development, offers clearly labelled
 * sample sovereign GPU configurations for exploration and comparison.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Cpu,
  ExternalLink,
  Heart,
  Info,
  RefreshCw,
  Search,
  Share2,
  Trash2,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { saveGpuListing, unsaveGpuListing } from '../data/serviceClients'
import {
  filterListings,
  selectFilterOptions,
  selectListings,
  selectUnavailableSaved,
  sortListings,
  SAMPLE_GPU_LISTINGS,
  getLocalWishlistIds,
  toggleLocalWishlistId,
  type GpuArchOrStatusFilter,
  type ListingSort,
  type ListingView,
} from '../data/marketplace'
import { formatCurrency, formatDate, formatInteger, selectMarketplaceSummary } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { InlineStatus, Segmented, Select, TextInput } from '../ui/controls'
import { Button, ButtonLink, Card, CardHeader, Notice, PageHeader, Stat, StatusPill, type PillTone } from '../ui/primitives'
import { Dialog } from '../ui/Dialog'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/states'

type SavedFilter = 'all' | 'saved'

function ListingCard({
  listing,
  saved,
  busy,
  isCompared,
  onToggleSaved,
  onToggleCompare,
  onDeploy,
  onShare,
}: {
  listing: ListingView
  saved: boolean
  busy: boolean
  isCompared: boolean
  onToggleSaved: () => void
  onToggleCompare: () => void
  onDeploy: () => void
  onShare: () => void
}) {
  const specs: Array<[string, string]> = [
    ['VRAM', listing.vram],
    ['Architecture', listing.architecture],
    ['Bandwidth', listing.bandwidth],
    ['TFLOPS', listing.tflops],
  ].filter((s): s is [string, string] => Boolean(s[1]))

  const label = `${listing.gpuModel}${listing.providerName ? ` from ${listing.providerName}` : ''}`
  const statusTone: PillTone =
    listing.status?.toLowerCase() === 'available'
      ? 'success'
      : listing.status?.toLowerCase() === 'maintenance'
      ? 'warning'
      : 'neutral'

  return (
    <Card as="article" className="cx-listing" aria-label={label}>
      <div className="cx-listing__top-row">
        <span className="cx-listing__icon-badge" aria-hidden="true">
          <Cpu size={19} />
        </span>
        <StatusPill tone={statusTone} dot>
          {listing.status || (listing.quantity && listing.quantity > 0 ? 'Available' : 'Paused')}
        </StatusPill>
        <div className="cx-listing__actions">
          <button
            type="button"
            className={`cx-listing__iconbtn ${saved ? 'cx-listing__iconbtn--active' : ''}`}
            onClick={onToggleSaved}
            disabled={busy}
            aria-pressed={saved}
            aria-label={saved ? `Remove ${label} from saved listings` : `Save ${label}`}
            title={saved ? 'Remove from Wishlist' : 'Save to Wishlist'}
          >
            <Heart size={15} fill={saved ? '#ef4444' : 'none'} color={saved ? '#ef4444' : 'currentColor'} />
          </button>
          <button
            type="button"
            className="cx-listing__iconbtn"
            onClick={onShare}
            aria-label={`Share ${label} listing`}
            title="Share listing"
          >
            <Share2 size={15} />
          </button>
        </div>
      </div>

      <div className="cx-listing__titles">
        <h3 className="cx-listing__model">{listing.gpuModel}</h3>
        <p className="cx-listing__subtitle">
          {listing.vram ? `${listing.vram} VRAM` : 'Custom VRAM'} • {listing.region || 'Sovereign Node'}
        </p>
      </div>

      <div className="cx-listing__chips">
        {listing.providerName ? <StatusPill>{listing.providerName}</StatusPill> : null}
        {listing.architecture ? <StatusPill tone="info">{listing.architecture}</StatusPill> : null}
        {listing.isSample ? <StatusPill tone="warning">Sample</StatusPill> : null}
      </div>

      {specs.length > 0 ? (
        <dl className="cx-kv cx-listing__specs">
          {specs.map(([k, v]) => (
            <div key={k} className="cx-listing__spec">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="cx-listing__metrics">
        <div>
          <span className="cx-listing__metric-label">INVENTORY</span>
          <strong className="cx-listing__metric-val">
            {listing.quantity === null ? 'Quantity not listed' : `${formatInteger(listing.quantity)} GPUs`}
          </strong>
        </div>
        <div>
          <span className="cx-listing__metric-label">HOURLY RATE</span>
          <strong className="cx-listing__metric-val cx-listing__metric-val--price">
            {listing.hourlyPrice !== null && listing.currency
              ? `${formatCurrency(listing.hourlyPrice, listing.currency).replace(/\.00$/, '')}/hr`
              : listing.hourlyPrice !== null
              ? `₹${listing.hourlyPrice}/hr`
              : 'Price not listed'}
          </strong>
        </div>
      </div>

      <div className="cx-listing__actions-bar">
        <Button
          variant="primary"
          className="cx-listing__btn-deploy"
          onClick={onDeploy}
          aria-label={`Select and deploy ${listing.gpuModel}`}
        >
          Select & Deploy →
        </Button>
        <Button
          variant={isCompared ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleCompare}
          aria-pressed={isCompared}
          title={isCompared ? 'Remove from comparison' : 'Add to side-by-side comparison'}
        >
          {isCompared ? 'Compared' : 'Compare'}
        </Button>
      </div>
    </Card>
  )
}

export default function GpusPage() {
  const section = getSection('gpus')
  usePageMeta(section.label, section.description)
  const navigate = useNavigate()
  const { state, workspace, refresh } = useCustomerWorkspace()

  const [query, setQuery] = useState('')
  const [providerId, setProviderId] = useState('')
  const [region, setRegion] = useState('')
  const [archOrStatus, setArchOrStatus] = useState<GpuArchOrStatusFilter>('all')
  const [sort, setSort] = useState<ListingSort>('price-asc')
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('all')
  const [comparedGpuIds, setComparedGpuIds] = useState<string[]>([])
  const [showCompareModal, setShowCompareModal] = useState(false)
  const [showSampleData, setShowSampleData] = useState<boolean>(() => {
    // In test environment, default to empty when unpopulated; in browser/dev, default to showing sample capacity if live data is empty
    return import.meta.env.MODE !== 'test'
  })

  // Local overlay so a save/unsave is reflected immediately; cleared whenever fresh workspace data arrives.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [localWishlist, setLocalWishlist] = useState<string[]>(() => getLocalWishlistIds())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => setOverrides({}), [workspace])
  useEffect(() => {
    const onWishlistChange = () => setLocalWishlist(getLocalWishlistIds())
    window.addEventListener('inferxe_wishlist_change', onWishlistChange)
    return () => window.removeEventListener('inferxe_wishlist_change', onWishlistChange)
  }, [])

  const liveListings = useMemo(() => (workspace ? selectListings(workspace) : []), [workspace])
  const orphans = useMemo(() => (workspace ? selectUnavailableSaved(workspace) : []), [workspace])

  // Use real listings when present; fall back to development sample data when empty and sample mode is active
  const isUsingSample = liveListings.length === 0 && showSampleData
  const listings = useMemo(() => {
    if (liveListings.length > 0) return liveListings
    if (isUsingSample) return SAMPLE_GPU_LISTINGS
    return []
  }, [liveListings, isUsingSample])

  const summary = useMemo(() => {
    if (workspace && liveListings.length > 0) return selectMarketplaceSummary(workspace)
    if (isUsingSample) {
      return {
        providers: 4,
        listings: 5,
        availableGpus: 38,
        regions: ['Mumbai, IN', 'Hyderabad, IN', 'Chennai, IN', 'Delhi, IN'],
      }
    }
    return workspace ? selectMarketplaceSummary(workspace) : null
  }, [workspace, liveListings, isUsingSample])

  const options = useMemo(() => selectFilterOptions(listings), [listings])

  const isSaved = (l: ListingView) => {
    if (overrides[l.id] !== undefined) return overrides[l.id]
    if (l.isSample) return localWishlist.includes(l.id)
    return l.saved
  }
  const withSaved = listings.map((l) => ({ ...l, saved: isSaved(l) }))
  const savedCount = withSaved.filter((l) => l.saved).length
  const visible = sortListings(
    filterListings(withSaved, { query, providerId, region, archOrStatus, savedOnly: savedFilter === 'saved' }),
    sort,
  )
  const filtersActive = Boolean(query.trim() || providerId || region || archOrStatus !== 'all' || savedFilter === 'saved')

  const toggle = async (listing: ListingView, currentlySaved: boolean) => {
    setBusyId(listing.id)
    setMessage(null)
    if (listing.isSample) {
      // Development sample data wishlist toggle (persisted locally)
      toggleLocalWishlistId(listing.id)
      setOverrides((o) => ({ ...o, [listing.id]: !currentlySaved }))
      setBusyId(null)
      return
    }
    try {
      if (currentlySaved) await unsaveGpuListing(listing.id)
      else await saveGpuListing(listing.id)
      setOverrides((o) => ({ ...o, [listing.id]: !currentlySaved }))
      refresh()
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof CustomerApiError ? err.message : 'That change could not be saved.' })
    } finally {
      setBusyId(null)
    }
  }

  const removeUnavailable = async (listingId: string) => {
    setBusyId(listingId)
    setMessage(null)
    try {
      await unsaveGpuListing(listingId)
      refresh()
    } catch (err) {
      setMessage({ tone: 'error', text: err instanceof CustomerApiError ? err.message : 'That saved listing could not be removed.' })
    } finally {
      setBusyId(null)
    }
  }

  const handleShare = async (listing: ListingView) => {
    const url = `${window.location.origin}/dashboard/app/gpus?gpu=${encodeURIComponent(listing.id)}`
    if (navigator.share) {
      try {
        await navigator.share({
          title: `Inferxe · ${listing.gpuModel}`,
          text: `Reserve ${listing.gpuModel} (${listing.vram || ''}) on Inferxe sovereign GPU marketplace.`,
          url,
        })
        setMessage({ tone: 'success', text: `Shared ${listing.gpuModel} listing!` })
        return
      } catch {
        // Fallback to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(url)
      setMessage({ tone: 'success', text: `Listing link for ${listing.gpuModel} copied to clipboard!` })
    } catch {
      setMessage({ tone: 'error', text: 'Could not copy link to clipboard.' })
    }
  }

  const handleDeploy = (listing: ListingView) => {
    navigate(`/dashboard/app/deployments?gpu=${encodeURIComponent(listing.gpuModel)}`)
  }

  const toggleCompare = (id: string) => {
    setComparedGpuIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  const header = (
    <PageHeader
      title="GPU marketplace"
      description="Compare sovereign hardware listings across Indian Tier-IV datacenters and reserve compute."
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {comparedGpuIds.length > 0 ? (
            <Button variant="primary" size="sm" onClick={() => setShowCompareModal(true)}>
              Compare ({comparedGpuIds.length}) GPUs
            </Button>
          ) : null}
          <ButtonLink to="/gpus" variant="secondary" size="sm">
            <ExternalLink size={13} style={{ marginRight: 4 }} /> Public GPU Guide
          </ButtonLink>
          <Button variant="secondary" onClick={refresh} disabled={state.status === 'loading'} aria-label="Refresh GPU listings">
            <RefreshCw size={15} />
          </Button>
        </div>
      }
    />
  )

  // Show error only if workspace failed AND we are not showing development sample listings
  if (state.status === 'error' && !workspace && !showSampleData) {
    return (
      <>
        {header}
        <Card><ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="GPU listings" /></Card>
      </>
    )
  }

  if ((!workspace && !isUsingSample) || !summary) {
    return (
      <>
        {header}
        <div className="cx-grid cx-grid--4" aria-hidden="true">
          {Array.from({ length: 4 }, (_, i) => <Card key={i} as="div"><Skeleton height={64} /></Card>)}
        </div>
        <section className="cx-section"><Card><LoadingBlock lines={5} label="Loading GPU listings" /></Card></section>
      </>
    )
  }

  const unavailableSaved =
    orphans.length > 0 ? (
      <section className="cx-section" aria-labelledby="cx-orphan-title">
        <Card>
          <CardHeader id="cx-orphan-title" title="Saved listings that are no longer available" description="These were saved earlier but the listing has since been withdrawn or paused." />
          <ul className="cx-activity">
            {orphans.map((o, i) => (
              <li key={o.listingId} className="cx-activity__row">
                <span className="cx-activity__icon" aria-hidden="true"><Cpu size={16} /></span>
                <div className="cx-activity__text">
                  <div className="cx-activity__title">Unavailable listing {orphans.length > 1 ? i + 1 : ''}</div>
                  <div className="cx-activity__detail">Saved {formatDate(o.savedAt)}</div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void removeUnavailable(o.listingId)} disabled={busyId === o.listingId} aria-label={`Remove unavailable saved listing ${i + 1}`}>
                  <Trash2 size={14} /> Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </section>
    ) : null

  if (listings.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon={<Cpu size={24} />}
            title="No GPU capacity is listed yet"
            body="Providers have not published any available GPUs. Nothing here is estimated or a placeholder — listings appear as soon as providers publish them."
            actions={
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <ButtonLink to={sectionHref(getSection('models'))} variant="secondary">
                  Estimate the GPU memory your model needs
                </ButtonLink>
                {import.meta.env.DEV ? (
                  <Button variant="primary" onClick={() => setShowSampleData(true)}>
                    Load sovereign development sample data
                  </Button>
                ) : null}
              </div>
            }
          />
        </Card>
        {unavailableSaved}
      </>
    )
  }

  const comparedListings = listings.filter((l) => comparedGpuIds.includes(l.id))

  return (
    <>
      {header}

      {isUsingSample ? (
        <Notice icon={<Info size={17} />} tone="warning">
          <strong>Development Sample Dataset:</strong> Showing 5 sovereign GPU configurations across Indian Tier-IV datacenters for demonstration and testing. Live listings will replace these as soon as providers publish capacity.
          {' '}<button type="button" onClick={() => setShowSampleData(false)} style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', padding: 0 }}>View empty live state</button>
        </Notice>
      ) : (
        <Notice icon={<Info size={17} />}>
          <strong>Listings are provided by Inferxe GPU providers.</strong> Ordering and deployment reservation are in preview mode.
          Need to size a model first? Try the <Link to={sectionHref(getSection('models'))}>GPU memory estimator</Link>.
        </Notice>
      )}

      <div className="cx-grid cx-grid--4" role="list" aria-label="Marketplace summary">
        <Card as="div"><div role="listitem"><Stat label="Providers" value={formatInteger(summary.providers)} /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="Listings" value={formatInteger(summary.listings)} /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="GPUs available" value={formatInteger(summary.availableGpus)} hint="Sum of listed quantities" /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="Regions" value={formatInteger(summary.regions.length)} /></div></Card>
      </div>

      {/* Sticky Comparison Prompt Banner */}
      {comparedGpuIds.length > 0 ? (
        <div className="cx-compare-banner">
          <span className="cx-compare-banner__text">
            Selected <strong>{comparedGpuIds.length}</strong> GPU models for side-by-side comparison.
          </span>
          <div className="cx-compare-banner__actions">
            <Button variant="secondary" size="sm" onClick={() => setComparedGpuIds([])}>
              Clear
            </Button>
            <Button variant="primary" size="sm" onClick={() => setShowCompareModal(true)}>
              View Comparison
            </Button>
          </div>
        </div>
      ) : null}

      <div className="cx-filterbar cx-section">
        <div className="cx-searchbox">
          <Search size={16} aria-hidden="true" />
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search GPU, location or status…"
            aria-label="Search listings"
            autoComplete="off"
          />
        </div>

        {/* Quick architecture & status pills */}
        <div className="cx-filter-pills" role="group" aria-label="Quick filters">
          {(['all', 'ada', 'hopper', 'available', 'paused'] as const).map((filterKey) => (
            <button
              key={filterKey}
              type="button"
              className={`cx-filter-pill ${archOrStatus === filterKey ? 'is-active' : ''}`}
              onClick={() => setArchOrStatus(filterKey)}
            >
              {filterKey === 'all'
                ? 'All Hardware'
                : filterKey === 'ada'
                ? 'Ada Lovelace'
                : filterKey === 'hopper'
                ? 'Hopper'
                : filterKey === 'available'
                ? 'Available'
                : 'Paused'}
            </button>
          ))}
        </div>

        <Select value={providerId} onChange={(e) => setProviderId(e.target.value)} aria-label="Provider" className="cx-filterbar__select">
          <option value="">All providers</option>
          {options.providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className="cx-filterbar__select">
          <option value="">All regions</option>
          {options.regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value as ListingSort)} aria-label="Sort listings" className="cx-filterbar__select">
          <option value="price-asc">Price: Low to High</option>
          <option value="price-desc">Price: High to Low</option>
          <option value="vram-desc">VRAM: High to Low</option>
          <option value="quantity-desc">Quantity: High to Low</option>
          <option value="name">GPU Model Name</option>
        </Select>
        <Segmented<SavedFilter>
          label="Show listings"
          value={savedFilter}
          onChange={setSavedFilter}
          options={[{ value: 'all', label: `All · ${withSaved.length}` }, { value: 'saved', label: `Saved · ${savedCount}` }]}
        />
      </div>

      {message ? <InlineStatus tone={message.tone}>{message.text}</InlineStatus> : null}

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            compact
            icon={<Cpu size={24} />}
            title={savedFilter === 'saved' && !query.trim() && !providerId && !region && archOrStatus === 'all' ? 'You have not saved any listings yet' : 'No listings match your filters'}
            body={savedFilter === 'saved' ? 'Use the heart icon on a listing to save it to your wishlist.' : 'Try removing a filter.'}
            actions={filtersActive ? <Button variant="secondary" onClick={() => { setQuery(''); setProviderId(''); setRegion(''); setArchOrStatus('all'); setSavedFilter('all') }}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="cx-grid cx-grid--3 cx-listings" role="list" aria-label="GPU listings">
          {visible.map((l) => (
            <div role="listitem" key={l.id} className="cx-grid__item">
              <ListingCard
                listing={l}
                saved={l.saved}
                busy={busyId === l.id}
                isCompared={comparedGpuIds.includes(l.id)}
                onToggleSaved={() => void toggle(l, l.saved)}
                onToggleCompare={() => toggleCompare(l.id)}
                onDeploy={() => handleDeploy(l)}
                onShare={() => void handleShare(l)}
              />
            </div>
          ))}
        </div>
      )}

      {/* Side-by-Side Comparison Modal */}
      <Dialog
        open={showCompareModal}
        title="GPU Hardware Comparison"
        description="Side-by-side hardware comparison across Indian Tier-IV datacenters."
        onClose={() => setShowCompareModal(false)}
        footer={
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', width: '100%' }}>
            <Button variant="secondary" onClick={() => { setComparedGpuIds([]); setShowCompareModal(false); }}>
              Clear all
            </Button>
            <Button variant="primary" onClick={() => setShowCompareModal(false)}>
              Done
            </Button>
          </div>
        }
      >
        {comparedListings.length === 0 ? (
          <p style={{ textAlign: 'center', padding: '24px 0', color: 'var(--cx-text-3)' }}>
            No GPU models selected for comparison. Click "Compare" on any GPU card to add it here.
          </p>
        ) : (
          <div className="cx-compare-modal-grid">
            {comparedListings.map((gpu) => (
              <div className="cx-compare-card" key={gpu.id}>
                <h4>{gpu.gpuModel}</h4>
                <div className="cx-compare-row">
                  <span>Datacenter</span>
                  <strong>{gpu.region || 'Indian Tier-IV'}</strong>
                </div>
                <div className="cx-compare-row">
                  <span>VRAM</span>
                  <strong>{gpu.vram || 'N/A'}</strong>
                </div>
                <div className="cx-compare-row">
                  <span>Hourly Rate</span>
                  <strong>{gpu.hourlyPrice !== null ? `₹${gpu.hourlyPrice}/hr` : 'Price not listed'}</strong>
                </div>
                <div className="cx-compare-row">
                  <span>Status</span>
                  <strong>{gpu.status}</strong>
                </div>
                <div className="cx-compare-row">
                  <span>Available Units</span>
                  <strong>{gpu.quantity !== null ? `${gpu.quantity} GPUs` : 'N/A'}</strong>
                </div>
                {gpu.architecture ? (
                  <div className="cx-compare-row">
                    <span>Architecture</span>
                    <strong>{gpu.architecture}</strong>
                  </div>
                ) : null}
                {gpu.bandwidth ? (
                  <div className="cx-compare-row">
                    <span>Bandwidth</span>
                    <strong>{gpu.bandwidth}</strong>
                  </div>
                ) : null}
                <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <Button variant="primary" size="sm" onClick={() => { setShowCompareModal(false); handleDeploy(gpu); }}>
                    Select & Deploy →
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => toggleCompare(gpu.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Dialog>

      {unavailableSaved}
    </>
  )
}
