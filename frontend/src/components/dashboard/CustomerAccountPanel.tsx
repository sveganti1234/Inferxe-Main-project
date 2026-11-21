/**
 * Administrator view of one customer's account inside the Customer Database details drawer:
 * wallet, transactions, deployments, spend, plan/trial and audit history — real records only —
 * plus admin-only wallet credit and plan/trial assignment. Every change requires a reason and is
 * recorded server-side in audit_logs. Missing data says "Not available"; nothing is estimated.
 */
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import {
  creditCustomerWallet,
  fetchCustomerAccount,
  updateCustomerPlan,
  type CustomerAccount,
} from '../../lib/customerService'

const NA = 'Not available'

function money(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount) || !currency) return NA
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount)
  } catch {
    return `${amount.toLocaleString('en-IN')} ${currency}`
  }
}

function when(iso: string | null | undefined): string {
  if (!iso) return NA
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? NA : d.toLocaleString()
}

/** datetime-local value ↔ ISO */
const toLocalInput = (iso: string | null | undefined) => {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null)

const HISTORY_LABELS: Record<string, string> = {
  'admin.wallet.credited': 'Wallet credited',
  'admin.plan.updated': 'Plan updated',
  'admin.customer.updated': 'Profile updated',
  'admin.customer.invited': 'Customer invited',
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 20 }}>
      <span className="engrave" style={{ fontSize: '0.72rem', letterSpacing: '0.08em', display: 'block', marginBottom: 8 }}>
        {title}
      </span>
      <div className="well" style={{ padding: '12px 14px', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.8rem' }}>
        {children}
      </div>
    </div>
  )
}

function Row({ label, value, muted }: { label: string; value: React.ReactNode; muted?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
      <span style={{ color: 'var(--ink-4)' }}>{label}</span>
      <span style={{ color: muted ? 'var(--ink-4)' : 'var(--ink)', fontWeight: 500, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

export function CustomerAccountPanel({ customerId }: { customerId: string }) {
  const [account, setAccount] = useState<CustomerAccount | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setAccount(await fetchCustomerAccount(customerId))
    } catch (err) {
      setAccount(null)
      setLoadError(err instanceof Error ? err.message : 'Customer account could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [customerId])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !account) {
    return (
      <Section title="Account, Wallet & Plan">
        <span style={{ color: 'var(--ink-4)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Loader2 size={14} className="spin" /> Loading customer account…
        </span>
      </Section>
    )
  }
  if (!account) {
    return (
      <Section title="Account, Wallet & Plan">
        <span role="alert" style={{ color: 'var(--red)' }}>{loadError ?? 'Customer account could not be loaded.'}</span>
        <button type="button" className="dash-btn-secondary" onClick={() => void load()}>Retry</button>
      </Section>
    )
  }

  const { wallet, spend, plan } = account
  const limitUsed = spend.admin_spend_limit ? Math.min(100, Math.round((spend.this_month / spend.admin_spend_limit) * 100)) : null

  return (
    <div data-testid="customer-account-panel">
      <Section title="Wallet">
        <Row label="Balance" value={wallet ? money(wallet.balance, wallet.currency) : 'No wallet yet'} muted={!wallet} />
        <Row label="Low-balance level" value={wallet?.low_balance_alert_level ?? NA} muted={!wallet?.low_balance_alert_level} />
        <Row label="Last updated" value={when(wallet?.updated_at)} muted={!wallet?.updated_at} />
      </Section>

      <Section title="Spending">
        <Row label="Spent this month" value={money(spend.this_month, spend.currency)} />
        <Row label="Admin spending limit" value={spend.admin_spend_limit === null ? 'No limit set' : money(spend.admin_spend_limit, spend.currency)} muted={spend.admin_spend_limit === null} />
        {limitUsed !== null ? <Row label="Limit used" value={`${limitUsed}%`} /> : null}
        <Row label="Customer's own budget" value={spend.customer_budget === null ? 'Not set' : money(spend.customer_budget, spend.currency)} muted={spend.customer_budget === null} />
      </Section>

      <Section title="Plan & Trial">
        <Row label="Tier" value={plan?.tier ?? 'No tier assigned'} muted={!plan?.tier} />
        <Row
          label="Trial"
          value={!plan || plan.trial_status === 'none' ? 'No trial' : plan.trial_status === 'active' ? `Active until ${when(plan.trial_ends_at)}` : `Expired ${when(plan.trial_ends_at)}`}
          muted={!plan || plan.trial_status === 'none'}
        />
        <PlanForm customerId={customerId} plan={plan} onSaved={load} />
      </Section>

      <Section title="Credit Wallet (Administrator)">
        <CreditForm customerId={customerId} currency={wallet?.currency ?? 'INR'} onCredited={load} />
      </Section>

      <Section title={`GPU Deployments (${account.deployments.length})`}>
        {account.deployments.length === 0 ? (
          <span style={{ color: 'var(--ink-4)' }}>No deployments recorded for this customer.</span>
        ) : (
          account.deployments.map((d) => (
            <div key={d.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div>
                <div style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.name}</div>
                <div style={{ color: 'var(--ink-4)', fontSize: '0.74rem' }}>{[d.model, d.gpu, d.region].filter(Boolean).join(' · ') || NA}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <span className="tag tag--clay" style={{ textTransform: 'capitalize' }}>{d.status ?? 'No status'}</span>
                <div style={{ fontSize: '0.74rem', color: 'var(--ink-3)', marginTop: 4 }}>
                  {d.hourly_rate !== null && d.currency ? `${money(d.hourly_rate, d.currency)}/hr` : 'Rate not recorded'}
                </div>
              </div>
            </div>
          ))
        )}
      </Section>

      <Section title={`Wallet Transactions (latest ${account.transactions.length})`}>
        {account.transactions.length === 0 ? (
          <span style={{ color: 'var(--ink-4)' }}>No wallet transactions recorded.</span>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
            {account.transactions.map((t) => (
              <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: '0.76rem' }}>
                <div>
                  <div style={{ color: 'var(--ink)' }}>{t.description ?? t.type ?? 'Transaction'}</div>
                  <div style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{when(t.created_at)}{t.status ? ` · ${t.status}` : ''}</div>
                </div>
                <span style={{ fontFamily: 'var(--font-mono)', color: t.direction === 'credit' ? '#a3e635' : 'var(--ink-2)', whiteSpace: 'nowrap' }}>
                  {t.direction === 'credit' ? '+' : t.direction === 'debit' ? '−' : ''}
                  {money(t.amount === null ? null : Math.abs(t.amount), t.currency)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="Administrator Audit History">
        {account.history.length === 0 ? (
          <span style={{ color: 'var(--ink-4)' }}>No administrator changes recorded.</span>
        ) : (
          account.history.map((h) => (
            <div key={h.id} style={{ fontSize: '0.76rem', paddingBottom: 6, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ color: 'var(--ink)' }}>{HISTORY_LABELS[h.action] ?? h.action}</strong>
                <span style={{ color: 'var(--ink-4)', fontFamily: 'var(--font-mono)' }}>{when(h.created_at)}</span>
              </div>
              <div style={{ color: 'var(--ink-3)' }}>
                {h.administrator_email ?? 'Administrator not recorded'}
                {typeof h.details.amount === 'number' ? ` · ${money(h.details.amount, typeof h.details.currency === 'string' ? h.details.currency : 'INR')}` : ''}
                {typeof h.details.reason === 'string' && h.details.reason ? ` · “${h.details.reason}”` : ''}
              </div>
            </div>
          ))
        )}
      </Section>
    </div>
  )
}

function PlanForm({ customerId, plan, onSaved }: { customerId: string; plan: CustomerAccount['plan']; onSaved: () => void }) {
  const ids = { tier: useId(), start: useId(), end: useId(), reason: useId() }
  const [tier, setTier] = useState(plan?.tier ?? '')
  const [start, setStart] = useState(toLocalInput(plan?.trial_started_at))
  const [end, setEnd] = useState(toLocalInput(plan?.trial_ends_at))
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    if (reason.trim().length < 3) return setMessage({ ok: false, text: 'Please give a reason (at least 3 characters).' })
    if (start && !end) return setMessage({ ok: false, text: 'A trial needs an end date.' })
    if (start && end && new Date(end) <= new Date(start)) return setMessage({ ok: false, text: 'Trial end must be after the trial start.' })
    setBusy(true)
    try {
      await updateCustomerPlan(customerId, {
        tier: tier.trim() || null,
        trial_started_at: fromLocalInput(start),
        trial_ends_at: fromLocalInput(end),
        reason: reason.trim(),
      })
      setReason('')
      setMessage({ ok: true, text: 'Plan saved and recorded in the audit history.' })
      onSaved()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'The plan could not be saved.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }} aria-label="Assign plan and trial">
      <div className="dash-field">
        <label htmlFor={ids.tier} className="dash-label"><span>Tier</span></label>
        <input id={ids.tier} className="dash-input" value={tier} maxLength={64} onChange={(e) => setTier(e.target.value)} placeholder="e.g. Starter, Enterprise (leave empty for none)" />
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="dash-field" style={{ flex: 1 }}>
          <label htmlFor={ids.start} className="dash-label"><span>Trial start</span></label>
          <input id={ids.start} type="datetime-local" className="dash-input" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="dash-field" style={{ flex: 1 }}>
          <label htmlFor={ids.end} className="dash-label"><span>Trial end</span></label>
          <input id={ids.end} type="datetime-local" className="dash-input" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div className="dash-field">
        <label htmlFor={ids.reason} className="dash-label"><span>Reason (audit history)</span></label>
        <input id={ids.reason} className="dash-input" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Why is the plan changing?" />
      </div>
      {message ? <span role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? '#a3e635' : 'var(--red)' }}>{message.text}</span> : null}
      <button type="submit" className="dash-btn-secondary" disabled={busy}>{busy ? 'Saving…' : 'Save plan & trial'}</button>
    </form>
  )
}

function CreditForm({ customerId, currency, onCredited }: { customerId: string; currency: string; onCredited: () => void }) {
  const ids = { amount: useId(), reason: useId() }
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  // One key per intended credit: a double-click or retry of the same credit is applied once.
  const [idempotencyKey, setIdempotencyKey] = useState(() => `admin_credit_${crypto.randomUUID()}`)

  const value = Number(amount)
  const valid = Number.isFinite(value) && value > 0 && value <= 1_000_000 && reason.trim().length >= 3

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy) return
    setMessage(null)
    if (!valid) return setMessage({ ok: false, text: 'Enter an amount between 0 and 10,00,000 and a reason (at least 3 characters).' })
    if (!confirming) return setConfirming(true)
    setBusy(true)
    try {
      const result = await creditCustomerWallet(customerId, Math.round(value * 100) / 100, reason.trim(), idempotencyKey)
      setMessage(
        result.status === 'skipped'
          ? { ok: true, text: 'This credit was already applied; it was not added twice.' }
          : { ok: true, text: `Credited ${money(value, currency)}. Recorded in the audit history.` },
      )
      setAmount('')
      setReason('')
      setIdempotencyKey(`admin_credit_${crypto.randomUUID()}`)
      onCredited()
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : 'The wallet could not be credited.' })
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }} aria-label="Credit customer wallet">
      <div style={{ display: 'flex', gap: 8 }}>
        <div className="dash-field" style={{ flex: 1 }}>
          <label htmlFor={ids.amount} className="dash-label"><span>Amount ({currency})</span></label>
          <input id={ids.amount} className="dash-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setConfirming(false) }} placeholder="e.g. 500" />
        </div>
        <div className="dash-field" style={{ flex: 2 }}>
          <label htmlFor={ids.reason} className="dash-label"><span>Reason (audit history)</span></label>
          <input id={ids.reason} className="dash-input" value={reason} maxLength={500} onChange={(e) => { setReason(e.target.value); setConfirming(false) }} placeholder="e.g. Bank transfer #1234 received" />
        </div>
      </div>
      {message ? <span role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? '#a3e635' : 'var(--red)' }}>{message.text}</span> : null}
      <button type="submit" className={confirming ? 'dash-btn-primary' : 'dash-btn-secondary'} disabled={busy}>
        {busy ? 'Crediting…' : confirming ? `Confirm credit of ${money(value, currency)}` : 'Credit wallet'}
      </button>
    </form>
  )
}
