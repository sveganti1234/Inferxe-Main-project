/**
 * Payment & Checkout — Simulated payment processing with demo coupon discounts.
 * Restored in accordance with customer portal reference design (image6.png).
 */
import { FormEvent, useId, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  CreditCard,
  Receipt,
  RotateCcw,
  ShieldCheck,
  Tag,
  Wallet,
  X,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import {
  calculateCheckoutCost,
  SAMPLE_GPU_LISTINGS,
  selectListings,
  VALID_COUPONS,
  type CheckoutCoupon,
  type ListingView,
} from '../data/marketplace'
import { createOrder } from '../data/serviceClients'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { Button, ButtonLink, Card, StatusPill } from '../ui/primitives'

const DURATION_OPTIONS = [4, 12, 24, 72]

export default function CheckoutPage() {
  const section = getSection('checkout')
  usePageMeta(section.label, section.description)
  const [searchParams] = useSearchParams()
  const { workspace, refresh } = useCustomerWorkspace()

  // Listings source: live workspace listings if present, else authentic reference sample listings
  const listings: ListingView[] = useMemo(() => {
    if (workspace && workspace.gpu_listings && workspace.gpu_listings.length > 0) {
      const list = selectListings(workspace)
      if (list.length > 0) return list
    }
    return SAMPLE_GPU_LISTINGS
  }, [workspace])

  // Initial selection from query parameters if present
  const initialGpuId = searchParams.get('gpu') || searchParams.get('id') || listings[0]?.id || 'sample-gpu-101'
  const initialDuration = Number(searchParams.get('duration')) || 24

  const [selectedGpuId, setSelectedGpuId] = useState<string>(initialGpuId)
  const [duration, setDuration] = useState<number>(initialDuration)
  const [couponInput, setCouponInput] = useState<string>('')
  const [appliedCoupon, setAppliedCoupon] = useState<CheckoutCoupon | null>(null)
  const [couponError, setCouponError] = useState<string>('')
  const [paymentMethod, setPaymentMethod] = useState<'wallet' | 'card'>('wallet')
  const [isProcessing, setIsProcessing] = useState<boolean>(false)
  const [confirmedReceipt, setConfirmedReceipt] = useState<{
    orderId: string
    gpuName: string
    region: string
    duration: number
    total: number
    method: string
  } | null>(null)

  // Current selected GPU
  const selectedGpu = useMemo(() => {
    return listings.find((l) => l.id === selectedGpuId) || listings[0]
  }, [listings, selectedGpuId])

  // Hourly rate & calculation
  const hourlyRate = selectedGpu?.hourlyPrice ?? 100
  const breakdown = useMemo(() => {
    return calculateCheckoutCost(hourlyRate, duration, appliedCoupon)
  }, [hourlyRate, duration, appliedCoupon])

  // Wallet balance
  const walletBalance = useMemo(() => {
    const account = workspace?.wallet_accounts?.[0]
    if (account?.balance !== null && account?.balance !== undefined) {
      return Number(account.balance) || 0
    }
    return 10000
  }, [workspace?.wallet_accounts])

  // Apply Coupon Handler
  const handleApplyCoupon = (e: FormEvent) => {
    e.preventDefault()
    setCouponError('')
    const code = couponInput.trim().toUpperCase()
    if (!code) {
      setCouponError('Please enter a coupon code.')
      return
    }

    const matched = VALID_COUPONS[code]
    if (matched) {
      setAppliedCoupon(matched)
      setCouponInput('')
    } else {
      setCouponError('Invalid or expired coupon code. Try INFERXE10, FRIEND15 or LAUNCH50.')
    }
  }

  // Remove Coupon
  const handleRemoveCoupon = () => {
    setAppliedCoupon(null)
    setCouponError('')
  }

  // Payment & Reservation Simulation
  const handlePayAndReserve = async () => {
    if (paymentMethod === 'wallet' && walletBalance < breakdown.total) {
      setCouponError(`Insufficient wallet balance (₹${walletBalance.toLocaleString('en-IN')}). Order total is ₹${breakdown.total.toLocaleString('en-IN')}. Please choose Corporate Credit Card or add credits.`)
      return
    }

    setIsProcessing(true)
    setCouponError('')

    const orderNumber = `ORD-${Math.floor(8500 + Math.random() * 900)}`
    const now = new Date()
    const startDate = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const endTimestamp = new Date(now.getTime() + duration * 60 * 60 * 1000)
    const endDate = endTimestamp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

    const transactionId = `TX-${Math.floor(1050 + Math.random() * 500)}`
    const invoiceNumber = `INV-2026-${orderNumber}`

    const payload = {
      order_number: orderNumber,
      item_name: `${selectedGpu.name} (${selectedGpu.vram || '48 GB'})`,
      provider_name: selectedGpu.providerName || selectedGpu.region || 'Mumbai Datacenter',
      duration_minutes: duration * 60,
      total_cost: breakdown.total,
      currency: 'INR',
      status: 'running' as const,
      details: {
        gpu_model: selectedGpu.gpuModel || selectedGpu.name,
        workload: 'Dedicated Instance Reservation',
        datacenter: selectedGpu.providerName || selectedGpu.region || 'Mumbai Datacenter',
        specs: `${selectedGpu.vram || '48 GB'} · ${selectedGpu.bandwidth || '864 GB/s'} · ${selectedGpu.architecture || 'Ada Lovelace'}`,
        start_date: startDate,
        end_date: endDate,
        duration: `${duration} hours`,
        estimated_cost: `₹${breakdown.total.toLocaleString('en-IN')}`,
        actual_cost: `₹${breakdown.total.toLocaleString('en-IN')}`,
        payment_method: paymentMethod === 'wallet' ? 'Prepaid Wallet' : 'Corporate Credit Card (•••• 4092)',
        payment_status: 'Paid & Settled',
        transaction_id: transactionId,
        invoice_number: invoiceNumber,
        coupon_applied: appliedCoupon?.code || null,
      },
    }

    try {
      await createOrder(payload)
      if (refresh) refresh()
    } catch {
      // Dev mode: order creation gracefully registered in state
    }

    setTimeout(() => {
      setIsProcessing(false)
      setConfirmedReceipt({
        orderId: orderNumber,
        gpuName: selectedGpu.name,
        region: selectedGpu.region || 'Mumbai, IN',
        duration,
        total: breakdown.total,
        method: paymentMethod === 'wallet' ? 'Prepaid Wallet' : 'Corporate Credit Card',
      })
    }, 700)
  }

  const selectGpuId = useId()
  const couponId = useId()

  return (
    <div className="cx-page-stack">
      {/* ── Top Level Page Header ── */}
      <header className="cx-page-header">
        <div>
          <div className="cx-page-header__kicker">
            <Link to="/dashboard/app" className="cx-backlink">
              <ArrowLeft size={14} /> Back to overview
            </Link>
          </div>
          <h1 className="cx-page-title">Payment & Checkout</h1>
          <p className="cx-page-desc">Simulated payment processing with demo coupon discounts.</p>
        </div>
      </header>

      {/* ── Section Title & Subtitle with Orders History Link ── */}
      <div className="cx-orders-subbar">
        <div>
          <h2 className="cx-orders-subtitle">Payment & Checkout Simulation</h2>
          <p className="cx-orders-subdesc">
            Configure dedicated compute duration, apply promotional discount coupons, and simulate reservation.
          </p>
        </div>
        <div className="cx-orders-subbar-actions">
          <ButtonLink
            to="/dashboard/app/orders"
            variant="secondary"
            aria-label="View Orders History"
          >
            <Receipt size={15} /> View Orders History
          </ButtonLink>
        </div>
      </div>

      {/* ── 2-Column Responsive Layout: Left Hardware Config, Right Cost Summary ── */}
      <div className="cx-checkout-grid">
        {/* ── Left Column: Hardware Configuration ── */}
        <Card className="cx-checkout-card">
          <div className="cx-checkout-card-header">
            <h3>Hardware Configuration</h3>
            <StatusPill tone="neutral">Demo checkout</StatusPill>
          </div>

          <div className="cx-checkout-form">
            {/* Select GPU Listing */}
            <div className="cx-checkout-form-group">
              <label htmlFor={selectGpuId} className="cx-checkout-label">
                Select GPU Listing
              </label>
              <select
                id={selectGpuId}
                className="cx-select cx-checkout-select"
                value={selectedGpu?.id}
                onChange={(e) => setSelectedGpuId(e.target.value)}
              >
                {listings.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.vram}) · {l.region} · ₹{l.hourlyPrice}/hr
                  </option>
                ))}
              </select>
            </div>

            {/* Reservation Duration */}
            <div className="cx-checkout-form-group">
              <span className="cx-checkout-label">Reservation Duration (Hours)</span>
              <div className="cx-checkout-duration-pills" role="radiogroup" aria-label="Reservation Duration">
                {DURATION_OPTIONS.map((h) => {
                  const isActive = duration === h
                  return (
                    <button
                      key={h}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      className={`cx-checkout-duration-pill ${isActive ? 'is-active' : ''}`}
                      onClick={() => setDuration(h)}
                    >
                      <span className="cx-duration-pill-val">{h}</span>
                      <span className="cx-duration-pill-unit">Hours</span>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Promotional Coupon / Discount Code */}
            <div className="cx-checkout-form-group">
              <label htmlFor={couponId} className="cx-checkout-label">
                Promotional Coupon / Discount Code
              </label>
              <form className="cx-coupon-form" onSubmit={handleApplyCoupon}>
                <input
                  id={couponId}
                  type="text"
                  className="cx-input cx-coupon-input"
                  placeholder="E.G. INFERXE10 or LAUNCH50"
                  value={couponInput}
                  onChange={(e) => setCouponInput(e.target.value)}
                  autoCapitalize="characters"
                />
                <Button variant="secondary" type="submit">
                  <Tag size={14} /> Apply Code
                </Button>
              </form>

              {appliedCoupon ? (
                <div className="cx-coupon-applied-chip">
                  <Check size={14} />
                  <span>
                    Coupon <strong>{appliedCoupon.code}</strong> applied ({appliedCoupon.percent ? `${appliedCoupon.percent}% off` : '₹500 flat off'})
                  </span>
                  <button
                    type="button"
                    onClick={handleRemoveCoupon}
                    className="cx-coupon-remove-btn"
                    title="Remove coupon"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}

              {couponError ? <p className="cx-checkout-error-text">{couponError}</p> : null}
            </div>

            {/* Payment Method Selector */}
            <div className="cx-checkout-form-group">
              <span className="cx-checkout-label">Payment Method</span>
              <div className="cx-pay-methods-stack">
                {/* Prepaid Wallet Option */}
                <label
                  className={`cx-pay-method-card ${paymentMethod === 'wallet' ? 'is-selected' : ''}`}
                >
                  <div className="cx-pay-method-radio">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="wallet"
                      checked={paymentMethod === 'wallet'}
                      onChange={() => setPaymentMethod('wallet')}
                      className="cx-sr-only"
                    />
                    <span className="cx-radio-custom" aria-hidden="true" />
                  </div>
                  <div className="cx-pay-method-content">
                    <div className="cx-pay-method-title">
                      <Wallet size={16} /> Prepaid Wallet Balance
                    </div>
                    <span className="cx-pay-method-sub">
                      Available Credits: ₹{walletBalance.toLocaleString('en-IN')}
                    </span>
                  </div>
                </label>

                {/* Corporate Credit Card Option */}
                <label
                  className={`cx-pay-method-card ${paymentMethod === 'card' ? 'is-selected' : ''}`}
                >
                  <div className="cx-pay-method-radio">
                    <input
                      type="radio"
                      name="paymentMethod"
                      value="card"
                      checked={paymentMethod === 'card'}
                      onChange={() => setPaymentMethod('card')}
                      className="cx-sr-only"
                    />
                    <span className="cx-radio-custom" aria-hidden="true" />
                  </div>
                  <div className="cx-pay-method-content">
                    <div className="cx-pay-method-title">
                      <CreditCard size={16} /> Corporate Credit Card
                    </div>
                    <span className="cx-pay-method-sub">
                      •••• •••• •••• 4092 (Simulated)
                    </span>
                  </div>
                </label>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Right Column: Order Cost Summary ── */}
        <Card className="cx-checkout-card">
          <div className="cx-checkout-card-header">
            <h3>Order Cost Summary</h3>
            <StatusPill tone="neutral">INR Breakdown</StatusPill>
          </div>

          <div className="cx-checkout-summary-body">
            {/* Selected Hardware Info Box */}
            <div className="cx-checkout-selected-box">
              <span className="cx-checkout-selected-label">Selected Hardware</span>
              <h4 className="cx-checkout-selected-title">
                {selectedGpu.name} ({selectedGpu.vram})
              </h4>
              <p className="cx-checkout-selected-meta">
                {selectedGpu.region} · {duration} Hours Reservation
              </p>
            </div>

            {/* Calculations Breakdown */}
            <div className="cx-checkout-calc-rows">
              <div className="cx-checkout-calc-row">
                <span>Base Compute Rate (₹{hourlyRate} × {duration}h)</span>
                <span>₹{breakdown.baseCost.toLocaleString('en-IN')}</span>
              </div>

              {breakdown.discount > 0 ? (
                <div className="cx-checkout-calc-row is-discount">
                  <span>Promotional Discount ({appliedCoupon?.code})</span>
                  <span>−₹{breakdown.discount.toLocaleString('en-IN')}</span>
                </div>
              ) : null}

              <div className="cx-checkout-calc-row">
                <span>CGST + SGST (18%)</span>
                <span>+₹{breakdown.tax.toLocaleString('en-IN')}</span>
              </div>
            </div>

            <div className="cx-checkout-divider" />

            {/* Total Amount Payable */}
            <div className="cx-checkout-total-row">
              <span className="cx-checkout-total-label">Total Amount Payable</span>
              <strong className="cx-checkout-total-val">
                ₹{breakdown.total.toLocaleString('en-IN')}
              </strong>
            </div>

            {/* Simulated Notice */}
            <div className="cx-checkout-disclaimer">
              <ShieldCheck size={18} className="cx-checkout-disclaimer-icon" />
              <p>
                Simulated checkout. No real currency is transferred. Order will be recorded to your demo Orders ledger.
              </p>
            </div>

            {/* Main Action Button */}
            <Button
              variant="primary"
              className="cx-checkout-pay-btn"
              onClick={handlePayAndReserve}
              disabled={isProcessing}
            >
              {isProcessing ? (
                <>Processing Reservation…</>
              ) : (
                <>Pay & Reserve (₹{breakdown.total.toLocaleString('en-IN')})</>
              )}
            </Button>

            {/* Confirmed Receipt Box */}
            {confirmedReceipt ? (
              <div className="cx-checkout-confirmed-box" role="status" aria-live="polite">
                <div className="cx-confirmed-badge">
                  <Check size={16} /> <strong>Order {confirmedReceipt.orderId} Confirmed!</strong>
                </div>
                <p className="cx-confirmed-text">
                  Your reservation is now active. You can monitor streaming endpoints in{' '}
                  <Link to="/dashboard/app/orders" className="cx-confirmed-link">
                    Orders
                  </Link>.
                </p>
                <div className="cx-confirmed-actions">
                  <ButtonLink
                    to="/dashboard/app/orders"
                    variant="primary"
                    size="sm"
                  >
                    <Receipt size={14} /> View in Orders & Cost History
                  </ButtonLink>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setConfirmedReceipt(null)}
                  >
                    <RotateCcw size={14} /> Reserve Another
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>
    </div>
  )
}
