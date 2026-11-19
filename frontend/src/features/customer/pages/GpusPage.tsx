/**
 * GPU marketplace — real provider and listing records from GET /api/customer/workspace.
 * Save / unsave use POST and DELETE /api/customer/saved-listings. Nothing is invented:
 * no placeholder providers, prices, availability, ratings or scores. With no listings the
 * page says so. Ordering and deployment do not exist yet, so there are no such controls.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bookmark, BookmarkCheck, Cpu, Info, MapPin, RefreshCw, Search, Trash2 } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { saveGpuListing, unsaveGpuListing } from '../data/serviceClients'
import {
  filterListings,
  selectFilterOptions,
  selectListings,
  selectUnavailableSaved,
  sortListings,
  type ListingSort,
  type ListingView,
} from '../data/marketplace'
import { formatCurrency, formatDate, formatInteger, selectMarketplaceSummary } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { InlineStatus, Segmented, Select, TextInput } from '../ui/controls'
import { Button, ButtonLink, Card, CardHeader, Notice, PageHeader, Stat, StatusPill } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/states'

type SavedFilter = 'all' | 'saved'

function ListingCard({ listing, saved, busy, onToggle }: { listing: ListingView; saved: boolean; busy: boolean; onToggle: () => void }) {
  const specs: Array<[string, string]> = [
    ['VRAM', listing.vram],
    ['Architecture', listing.architecture],
    ['Bandwidth', listing.bandwidth],
    ['TFLOPS', listing.tflops],
  ].filter((s): s is [string, string] => Boolean(s[1]))
  const label = `${listing.gpuModel}${listing.providerName ? ` from ${listing.providerName}` : ''}`
  return (
    <Card as="article" className="cx-listing" aria-label={label}>
      <div className="cx-listing__top">
        <div className="cx-listing__titles">
          <h3 className="cx-listing__model">{listing.gpuModel}</h3>
          {listing.name !== listing.gpuModel ? <p className="cx-listing__name">{listing.name}</p> : null}
        </div>
        <Button
          variant={saved ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggle}
          disabled={busy}
          aria-pressed={saved}
          aria-label={saved ? `Remove ${label} from saved listings` : `Save ${label}`}
        >
          {saved ? <BookmarkCheck size={14} /> : <Bookmark size={14} />} {busy ? 'Working…' : saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      <div className="cx-listing__chips">
        {listing.providerName ? <StatusPill>{listing.providerName}</StatusPill> : null}
        {listing.region ? (
          <StatusPill tone="info">
            <MapPin size={11} aria-hidden="true" /> {listing.region}
          </StatusPill>
        ) : null}
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
      <div className="cx-listing__foot">
        <div className="cx-listing__price">
          {listing.hourlyPrice !== null && listing.currency ? (
            <>
              <strong>{formatCurrency(listing.hourlyPrice, listing.currency)}</strong>
              <span className="cx-muted"> / hour</span>
            </>
          ) : (
            <span className="cx-muted">Price not listed</span>
          )}
        </div>
        <span className="cx-muted cx-small">{listing.quantity === null ? 'Quantity not listed' : `${formatInteger(listing.quantity)} available`}</span>
      </div>
    </Card>
  )
}

export default function GpusPage() {
  const section = getSection('gpus')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()

  const [query, setQuery] = useState('')
  const [providerId, setProviderId] = useState('')
  const [region, setRegion] = useState('')
  const [sort, setSort] = useState<ListingSort>('price-asc')
  const [savedFilter, setSavedFilter] = useState<SavedFilter>('all')
  // Local overlay so a save/unsave is reflected immediately; cleared whenever fresh workspace data arrives.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => setOverrides({}), [workspace])

  const listings = useMemo(() => (workspace ? selectListings(workspace) : []), [workspace])
  const orphans = useMemo(() => (workspace ? selectUnavailableSaved(workspace) : []), [workspace])
  const summary = useMemo(() => (workspace ? selectMarketplaceSummary(workspace) : null), [workspace])
  const options = useMemo(() => selectFilterOptions(listings), [listings])

  const isSaved = (l: ListingView) => overrides[l.id] ?? l.saved
  const withSaved = listings.map((l) => ({ ...l, saved: isSaved(l) }))
  const savedCount = withSaved.filter((l) => l.saved).length
  const visible = sortListings(filterListings(withSaved, { query, providerId, region, savedOnly: savedFilter === 'saved' }), sort)
  const filtersActive = Boolean(query.trim() || providerId || region || savedFilter === 'saved')

  const toggle = async (listing: ListingView, currentlySaved: boolean) => {
    setBusyId(listing.id)
    setMessage(null)
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

  const header = (
    <PageHeader
      title="GPU marketplace"
      description="GPU capacity listed by Inferxe providers."
      actions={
        <Button variant="secondary" onClick={refresh} disabled={state.status === 'loading'} aria-label="Refresh GPU listings">
          <RefreshCw size={15} />
        </Button>
      }
    />
  )

  if (state.status === 'error' && !workspace) {
    return (
      <>
        {header}
        <Card><ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="GPU listings" /></Card>
      </>
    )
  }
  if (!workspace || !summary) {
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
              <ButtonLink to={sectionHref(getSection('models'))} variant="secondary">
                Estimate the GPU memory your model needs
              </ButtonLink>
            }
          />
        </Card>
        {unavailableSaved}
      </>
    )
  }

  return (
    <>
      {header}
      <Notice icon={<Info size={17} />}>
        <strong>Listings are provided by Inferxe GPU providers.</strong> Ordering and deployment are not available yet, so
        you can browse and save listings only. Need to size a model first? Try the{' '}
        <Link to={sectionHref(getSection('models'))}>GPU memory estimator</Link>.
      </Notice>

      <div className="cx-grid cx-grid--4" role="list" aria-label="Marketplace summary">
        <Card as="div"><div role="listitem"><Stat label="Providers" value={formatInteger(summary.providers)} /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="Listings" value={formatInteger(summary.listings)} /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="GPUs available" value={formatInteger(summary.availableGpus)} hint="Sum of listed quantities" /></div></Card>
        <Card as="div"><div role="listitem"><Stat label="Regions" value={formatInteger(summary.regions.length)} /></div></Card>
      </div>

      <div className="cx-filterbar cx-section">
        <div className="cx-searchbox">
          <Search size={16} aria-hidden="true" />
          <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search GPU, provider or region" aria-label="Search listings" autoComplete="off" />
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
          <option value="price-asc">Price: low to high</option>
          <option value="price-desc">Price: high to low</option>
          <option value="quantity-desc">Most available</option>
          <option value="name">GPU name</option>
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
            title={savedFilter === 'saved' && !query.trim() && !providerId && !region ? 'You have not saved any listings yet' : 'No listings match your filters'}
            body={savedFilter === 'saved' ? 'Use Save on a listing to keep it here.' : 'Try removing a filter.'}
            actions={filtersActive ? <Button variant="secondary" onClick={() => { setQuery(''); setProviderId(''); setRegion(''); setSavedFilter('all') }}>Clear filters</Button> : undefined}
          />
        </Card>
      ) : (
        <div className="cx-grid cx-grid--3 cx-listings" role="list" aria-label="GPU listings">
          {visible.map((l) => (
            <div role="listitem" key={l.id} className="cx-grid__item">
              <ListingCard listing={l} saved={l.saved} busy={busyId === l.id} onToggle={() => void toggle(l, l.saved)} />
            </div>
          ))}
        </div>
      )}
      {unavailableSaved}
    </>
  )
}
