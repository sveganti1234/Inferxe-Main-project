/**
 * Rewards & Discounts — Referral discounts, coupon codes and creator trial codes.
 * Restored in accordance with customer portal reference design (image19.png).
 */
import { useId, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Copy,
  Gift,
  Share2,
  Tag,
  Youtube,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { Button, ButtonLink, Card, StatusPill } from '../ui/primitives'

const CREATOR_CODES: Record<string, string> = {
  YOUTUBE1HR: 'YouTube Creator Trial',
  CREATOR1HR: 'Creator Partner Trial',
  REACH1HR: 'Promotion Partner Trial',
}

const COUPON_TABLE = [
  { code: 'INFERXE10', benefit: '10% off', type: 'Standard' },
  { code: 'LAUNCH50', benefit: '₹500 off', type: 'Launch' },
  { code: 'FRIEND15', benefit: '15% off', type: 'Referral (friend of a user)' },
]

export default function RewardsPage() {
  const section = getSection('rewards')
  usePageMeta(section.label, section.description)
  const { workspace } = useCustomerWorkspace()

  // Generate unique referral code based on user profile
  const userName = workspace?.profile?.username || workspace?.profile?.full_name || 'VEGAN'
  const refCode = useMemo(() => {
    const clean = userName.replace(/[^a-zA-Z]/g, '').slice(0, 5).toUpperCase()
    return `REF-${clean.padEnd(5, 'X')}15`
  }, [userName])

  const refLink = `${typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173'}/signup?ref=${refCode}`

  // Local state for demo interactive features
  const [invitedCount, setInvitedCount] = useState<number>(0)
  const [creatorInput, setCreatorInput] = useState<string>('')
  const [redeemedCode, setRedeemedCode] = useState<string | null>(null)
  const [creatorMessage, setCreatorMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const discountEarned = Math.min(invitedCount * 5, 30)

  const copyToClipboard = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    } catch {
      // Fallback
      setCopiedKey(key)
      setTimeout(() => setCopiedKey(null), 2000)
    }
  }

  const handleSimulateInvite = () => {
    setInvitedCount((prev) => prev + 1)
  }

  const handleRedeemCreatorCode = () => {
    const code = creatorInput.trim().toUpperCase()
    if (!code) {
      setCreatorMessage({ tone: 'error', text: 'Please enter a creator code.' })
      return
    }
    if (redeemedCode) {
      setCreatorMessage({ tone: 'error', text: 'A creator code was already redeemed on this account.' })
      return
    }
    if (!CREATOR_CODES[code]) {
      setCreatorMessage({ tone: 'error', text: 'Invalid creator code. Try YOUTUBE1HR.' })
      return
    }
    setRedeemedCode(code)
    setCreatorInput('')
    setCreatorMessage({ tone: 'success', text: `${CREATOR_CODES[code]} code accepted — 1-hour trial started!` })
  }

  const creatorInputId = useId()

  return (
    <div className="cx-page-stack">
      {/* ── Breadcrumb & Top Level Page Header ── */}
      <header className="cx-page-header">
        <div>
          <div className="cx-page-header__kicker">
            <span className="cx-breadcrumb-trail">Customer Portal / Rewards & Discounts</span>
            <Link to="/dashboard/app" className="cx-backlink cx-backlink-right">
              <ArrowLeft size={14} /> Back to overview
            </Link>
          </div>
          <h1 className="cx-page-title">Rewards & Discounts</h1>
          <p className="cx-page-desc">Referral discounts, coupon codes and creator trial codes.</p>
        </div>
      </header>

      {/* ── Section Title & Subtitle ── */}
      <div className="cx-orders-subbar">
        <div>
          <h2 className="cx-orders-subtitle">Rewards & Discounts</h2>
          <p className="cx-orders-subdesc">
            Refer friends, earn checkout discounts, and redeem creator codes for a 1-hour trial.
          </p>
        </div>
      </div>

      {/* ── Top Metric Cards: 2 Columns ── */}
      <div className="cx-grid cx-grid--2 cx-rewards-stats-grid">
        <Card className="cx-stat-card">
          <div className="cx-stat-card__head">
            <span className="cx-stat-card__label">Friends joined</span>
            <div className="cx-stat-icon-wrap" aria-hidden="true">
              <Share2 size={16} />
            </div>
          </div>
          <strong className="cx-stat-card__val">{invitedCount}</strong>
          <span className="cx-stat-card__hint">Demo counter</span>
        </Card>

        <Card className="cx-stat-card">
          <div className="cx-stat-card__head">
            <span className="cx-stat-card__label">Referral discount earned</span>
            <div className="cx-stat-icon-wrap cx-stat-icon-wrap--gift" aria-hidden="true">
              <Gift size={16} />
            </div>
          </div>
          <strong className="cx-stat-card__val cx-stat-card__val--green">{discountEarned}%</strong>
          <span className="cx-stat-card__hint">5% per friend, max 30%</span>
        </Card>
      </div>

      {/* ── Middle 2-Column Section: Your referral & Creator trial ── */}
      <div className="cx-checkout-grid cx-rewards-mid-grid">
        {/* Left Card: Your referral */}
        <Card className="cx-rewards-card">
          <div className="cx-rewards-card-header">
            <h3>Your referral</h3>
          </div>

          <div className="cx-rewards-card-body">
            {/* Referral Link Box */}
            <div className="cx-ref-link-box">
              <code className="cx-ref-link-code">{refLink}</code>
              <button
                type="button"
                className="cx-iconbtn-sm"
                onClick={() => copyToClipboard(refLink, 'link')}
                title="Copy referral link"
                aria-label="Copy referral link"
              >
                {copiedKey === 'link' ? <Check size={14} /> : <Copy size={14} />}
              </button>
            </div>

            <p className="cx-rewards-subtext">
              Friends get <strong>FRIEND15</strong> (15% off) at checkout. You earn 5% for every friend that joins.
            </p>

            <div className="cx-rewards-actions-row">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => copyToClipboard(refCode, 'code')}
                aria-label={`Copy code ${refCode}`}
              >
                {copiedKey === 'code' ? <Check size={14} /> : <Copy size={14} />} Copy code {refCode}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleSimulateInvite}
              >
                Simulate friend joining
              </Button>
            </div>
          </div>
        </Card>

        {/* Right Card: Creator & YouTuber trial */}
        <Card className="cx-rewards-card">
          <div className="cx-rewards-card-header">
            <h3>Creator & YouTuber trial</h3>
            <Youtube size={18} className="cx-youtube-icon" aria-hidden="true" />
          </div>

          <div className="cx-rewards-card-body">
            <p className="cx-rewards-subtext">
              Content creators can promote Inferxe with a 1-hour free trial. Enter a creator code to start it.
            </p>

            <div className="cx-creator-input-wrap">
              <input
                id={creatorInputId}
                type="text"
                className="cx-input cx-creator-input"
                placeholder="e.g. YOUTUBE1HR"
                value={creatorInput}
                onChange={(e) => setCreatorInput(e.target.value)}
                disabled={Boolean(redeemedCode)}
              />
            </div>

            {creatorMessage ? (
              <p className={`cx-creator-msg ${creatorMessage.tone === 'success' ? 'is-success' : 'is-error'}`}>
                {creatorMessage.text}
              </p>
            ) : null}

            <div>
              <Button
                variant="primary"
                onClick={handleRedeemCreatorCode}
                disabled={Boolean(redeemedCode)}
              >
                {redeemedCode ? `Redeemed: ${redeemedCode}` : 'Redeem code'}
              </Button>
            </div>
          </div>
        </Card>
      </div>

      {/* ── Bottom Section: Available coupon codes Table ── */}
      <Card className="cx-rewards-card cx-coupons-table-card">
        <div className="cx-rewards-card-header">
          <h3>Available coupon codes</h3>
          <ButtonLink
            to="/dashboard/app/checkout"
            variant="ghost"
            size="sm"
            className="cx-apply-checkout-link"
          >
            Apply at Checkout →
          </ButtonLink>
        </div>

        <div className="cx-table-wrap">
          <table className="cx-table cx-coupons-table" aria-label="Available coupon codes">
            <thead>
              <tr>
                <th scope="col">CODE</th>
                <th scope="col">BENEFIT</th>
                <th scope="col">TYPE</th>
              </tr>
            </thead>
            <tbody>
              {COUPON_TABLE.map((c) => (
                <tr key={c.code}>
                  <td data-label="CODE">
                    <span className="cx-order-number-mono cx-coupon-code-mono">
                      <Tag size={13} style={{ marginRight: 6, verticalAlign: 'middle', opacity: 0.7 }} />
                      {c.code}
                    </span>
                  </td>
                  <td data-label="BENEFIT">
                    <span className="cx-coupon-benefit">{c.benefit}</span>
                  </td>
                  <td data-label="TYPE">
                    <StatusPill
                      tone={c.code === 'LAUNCH50' ? 'warning' : c.code === 'FRIEND15' ? 'success' : 'neutral'}
                    >
                      {c.type}
                    </StatusPill>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
