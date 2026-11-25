/**
 * Saved Hardware Wishlist — Bookmarked GPU instances saved for instant comparison and deployment.
 * Restored in accordance with customer portal reference design (image12.png).
 */
import { useMemo, useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Cpu,
  Heart,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { unsaveGpuListing } from '../data/serviceClients'
import {
  SAMPLE_GPU_LISTINGS,
  selectListings,
  getLocalWishlistIds,
  toggleLocalWishlistId,
  type ListingView,
} from '../data/marketplace'
import { formatCurrency } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { Button, ButtonLink, Card, StatusPill } from '../ui/primitives'
import { LoadingBlock } from '../ui/states'

export default function WishlistPage() {
  const section = getSection('wishlist')
  usePageMeta('Saved Hardware Wishlist · Inferxe', section.description)
  const navigate = useNavigate()
  const { state, workspace, refresh } = useCustomerWorkspace()

  const [localWishlist, setLocalWishlist] = useState<string[]>(() => getLocalWishlistIds())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => {
    const onWishlistChange = () => setLocalWishlist(getLocalWishlistIds())
    window.addEventListener('inferxe_wishlist_change', onWishlistChange)
    return () => window.removeEventListener('inferxe_wishlist_change', onWishlistChange)
  }, [])

  const liveListings = useMemo(() => (workspace ? selectListings(workspace) : []), [workspace])
  const allListings = useMemo(() => {
    if (liveListings.length > 0) return liveListings
    return SAMPLE_GPU_LISTINGS
  }, [liveListings])

  // A listing is in the wishlist if saved in database or present in local sample wishlist
  const wishlistListings = useMemo(() => {
    return allListings.filter((l) => {
      if (l.isSample) {
        return localWishlist.includes(l.id)
      }
      return l.saved || localWishlist.includes(l.id)
    })
  }, [allListings, localWishlist])

  const handleRemove = async (listing: ListingView) => {
    setBusyId(listing.id)
    setMessage(null)
    try {
      if (listing.isSample) {
        toggleLocalWishlistId(listing.id)
        setLocalWishlist(getLocalWishlistIds())
      } else {
        await unsaveGpuListing(listing.id)
        toggleLocalWishlistId(listing.id)
        refresh()
      }
      setMessage({ tone: 'success', text: `Removed ${listing.name} from your wishlist.` })
    } catch (err) {
      setMessage({
        tone: 'error',
        text: err instanceof CustomerApiError ? err.message : 'Could not remove from wishlist.',
      })
    } finally {
      setBusyId(null)
    }
  }

  const handleDeploy = (listing: ListingView) => {
    navigate(`/dashboard/app/deployments?gpu=${encodeURIComponent(listing.gpuModel)}`)
  }

  return (
    <div className="cx-wishlist-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">Saved Hardware Wishlist</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>Saved Hardware Wishlist</h1>
          <p className="cx-page-header__desc">Review your bookmarked GPU listings for quick deployment.</p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to="/dashboard/app" variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-wishlist-toolbar">
        <div>
          <h2>Saved Hardware Wishlist</h2>
          <p>Bookmarked GPU instances saved for instant comparison and deployment.</p>
        </div>
        <ButtonLink to="/dashboard/app/gpus" variant="primary" size="sm" className="cx-browse-mkt-btn">
          Browse Marketplace
        </ButtonLink>
      </div>

      {message && (
        <div className={`cx-alert cx-alert--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
        </div>
      )}

      {/* ── Wishlist Content ── */}
      {state.status === 'loading' && !workspace ? (
        <LoadingBlock lines={3} label="Loading wishlist..." />
      ) : wishlistListings.length === 0 ? (
        <Card className="cx-wishlist-empty-card">
          <div className="cx-wishlist-empty">
            <div className="cx-wishlist-empty-icon" aria-hidden="true">
              <Heart size={28} />
            </div>
            <h3>Your Wishlist is Empty</h3>
            <p>Browse the GPU Marketplace and click the heart icon on any instance card to bookmark it.</p>
            <ButtonLink to="/dashboard/app/gpus" variant="primary" size="sm">
              Explore GPU Marketplace
            </ButtonLink>
          </div>
        </Card>
      ) : (
        <div className="cx-wishlist-grid" role="list" aria-label="Bookmarked GPU instances">
          {wishlistListings.map((item) => (
            <Card key={item.id} as="article" className="cx-wishlist-card">
              {/* Card Top Row */}
              <div className="cx-wishlist-card__top">
                <span className="cx-wishlist-icon-box" aria-hidden="true">
                  <Cpu size={20} />
                </span>
                <div className="cx-wishlist-card__top-actions">
                  <StatusPill tone="success">{item.status}</StatusPill>
                  <button
                    type="button"
                    className="cx-wishlist-heart-btn"
                    onClick={() => handleRemove(item)}
                    disabled={busyId === item.id}
                    title="Remove from Wishlist"
                    aria-label={`Remove ${item.name} from Wishlist`}
                  >
                    <Heart size={14} fill="#ef4444" color="#ef4444" />
                  </button>
                </div>
              </div>

              {/* Title & Hardware Info */}
              <div className="cx-wishlist-card__body">
                <h3 className="cx-wishlist-card__title">{item.name}</h3>
                <p className="cx-wishlist-card__sub">
                  {item.vram} VRAM · {item.region}
                </p>

                {/* Specs Grid */}
                <div className="cx-wishlist-specs">
                  <div className="cx-wishlist-spec-col">
                    <span className="cx-wishlist-spec-label">Inventory</span>
                    <strong className="cx-wishlist-spec-val">
                      {item.quantity !== null ? `${item.quantity} GPUs` : 'Allocated on demand'}
                    </strong>
                  </div>
                  <div className="cx-wishlist-spec-col">
                    <span className="cx-wishlist-spec-label">Hourly Rate</span>
                    <strong className="cx-wishlist-spec-val cx-wishlist-spec-val--price">
                      {item.hourlyPrice !== null && item.currency
                        ? `${formatCurrency(item.hourlyPrice, item.currency).replace(/\.00$/, '')}/hr`
                        : item.hourlyPrice !== null
                        ? `₹${item.hourlyPrice}/hr`
                        : '—'}
                    </strong>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="cx-wishlist-card__actions">
                <Button
                  variant="primary"
                  className="cx-wishlist-btn-deploy"
                  onClick={() => handleDeploy(item)}
                  aria-label={`Select and deploy ${item.name}`}
                >
                  Select & Deploy →
                </Button>
                <Button
                  variant="secondary"
                  className="cx-wishlist-btn-remove"
                  onClick={() => handleRemove(item)}
                  disabled={busyId === item.id}
                >
                  Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
