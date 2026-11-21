/**
 * Billing & wallet.
 *  - Balance:   8002 GET /api/wallet/balance
 *  - History:   GET /api/customer/workspace → wallet_transactions
 *  - Add money: 8002 POST /api/wallet/transactions — a demo top-up of the customer's own wallet.
 *    No payment is taken (there is no payment gateway); the service allows it only while
 *    WALLET_SELF_RECHARGE_ENABLED is on, and labels each one "Demo top-up" in the history.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowDownLeft, ArrowRight, ArrowUpRight, Info, Plus, Receipt, RefreshCw, Wallet } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { MAX_DEMO_TOPUP, addMoneyToWallet, fetchWalletBalance } from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatRelativeTime,
  humaniseCode,
  selectLedger,
  selectLedgerTotals,
  type LedgerEntry,
} from '../data/selectors'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { Field, Segmented, TextInput } from '../ui/controls'
import { Dialog } from '../ui/Dialog'
import { Button, ButtonLink, Card, CardHeader, DataTable, Notice, PageHeader, Stat, StatusPill, type Column } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/states'

type Filter = 'all' | 'credit' | 'debit'
const PAGE_SIZE = 15

function statusTone(status: string | null): 'success' | 'warning' | 'danger' | 'neutral' {
  const s = (status ?? '').toLowerCase()
  if (s === 'completed') return 'success'
  if (s === 'failed' || s === 'cancelled' || s === 'rejected') return 'danger'
  if (s === 'pending' || s === 'processing') return 'warning'
  return 'neutral'
}

/** The amount typed into "Add money", or the reason it cannot be used. */
export function parseTopUpAmount(raw: string): { amount: number } | { error: string } {
  const text = raw.trim().replace(/,/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { error: 'Enter an amount in rupees, for example 500 or 1250.50.' }
  const amount = Number(text)
  if (amount <= 0) return { error: 'Enter an amount greater than zero.' }
  if (amount > MAX_DEMO_TOPUP) return { error: `You can add at most ${formatCurrency(MAX_DEMO_TOPUP, 'INR')} at a time.` }
  return { amount }
}

function AmountCell({ entry }: { entry: LedgerEntry }) {
  if (entry.amount === null || !entry.currency) return <span className="cx-muted">—</span>
  const sign = entry.direction === 'credit' ? '+' : entry.direction === 'debit' ? '−' : ''
  return (
    <span className={`cx-amount${entry.direction === 'credit' ? ' cx-amount--credit' : ''}`}>
      {sign}
      {formatCurrency(Math.abs(entry.amount), entry.currency)}
    </span>
  )
}

export default function BillingPage() {
  const section = getSection('billing')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()
  const wallet = useAsyncResource(fetchWalletBalance, { cacheKey: 'wallet' })
  const [filter, setFilter] = useState<Filter>('all')
  const [visible, setVisible] = useState(PAGE_SIZE)

  // "Add money" dialog; ?add=money (the overview's Add money link) opens it on arrival.
  const [params, setParams] = useSearchParams()
  const [addOpen, setAddOpen] = useState(() => params.get('add') === 'money')
  const [amountText, setAmountText] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [attemptKey, setAttemptKey] = useState(() => crypto.randomUUID())
  const [added, setAdded] = useState<number | null>(null)

  const openAdd = () => {
    setAmountText('')
    setAddError(null)
    setAttemptKey(crypto.randomUUID())
    setAddOpen(true)
  }
  const closeAdd = () => {
    setAddOpen(false)
    if (params.has('add')) setParams({}, { replace: true })
  }
  const submitAdd = async (e: FormEvent) => {
    e.preventDefault()
    const parsed = parseTopUpAmount(amountText)
    if ('error' in parsed) {
      setAddError(parsed.error)
      return
    }
    setAdding(true)
    setAddError(null)
    try {
      await addMoneyToWallet(parsed.amount, attemptKey)
      closeAdd()
      setAdded(parsed.amount)
      refresh()
      wallet.refresh()
    } catch (err) {
      setAddError(err instanceof CustomerApiError ? err.message : 'The money could not be added. Please try again.')
    } finally {
      setAdding(false)
    }
  }

  const entries = useMemo(() => (workspace ? selectLedger(workspace) : []), [workspace])
  const totals = useMemo(() => selectLedgerTotals(entries), [entries])
  const primary = totals[0] ?? null
  const otherCurrencies = totals.length > 1 ? totals.slice(1).map((t) => t.currency).join(', ') : null

  const credits = entries.filter((e) => e.direction === 'credit').length
  const debits = entries.filter((e) => e.direction === 'debit').length
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.direction === filter)
  const shown = filtered.slice(0, visible)

  const refreshAll = () => {
    refresh()
    wallet.refresh()
  }

  // Cached balance stays visible while refreshing; after a failed refresh it is not shown as current.
  const walletData = wallet.state.status !== 'error' ? wallet.state.data : null
  const balanceValue = walletData ? formatCurrency(walletData.balance, walletData.currency) : null
  const balanceHint =
    wallet.state.status === 'error'
      ? 'Wallet service unavailable'
      : walletData
        ? walletData.updatedAt
          ? `Updated ${formatRelativeTime(walletData.updatedAt)}`
          : 'No wallet activity yet'
        : 'Loading…'

  const columns: Column<LedgerEntry>[] = [
    { key: 'date', header: 'Date', render: (e) => <span className="cx-nowrap">{formatDateTime(e.at)}</span> },
    {
      key: 'type',
      header: 'Type',
      render: (e) => (
        <span className="cx-ledger-type">
          <span className={`cx-activity__icon cx-activity__icon--${e.direction === 'credit' ? 'success' : 'neutral'}`} aria-hidden="true">
            {e.direction === 'credit' ? <ArrowDownLeft size={15} /> : <ArrowUpRight size={15} />}
          </span>
          <span>
            {e.typeLabel}
            {e.status && e.status.toLowerCase() !== 'completed' ? (
              <>
                {' '}
                <StatusPill tone={statusTone(e.status)}>{humaniseCode(e.status)}</StatusPill>
              </>
            ) : null}
          </span>
        </span>
      ),
    },
    { key: 'desc', header: 'Description', render: (e) => e.description ?? <span className="cx-muted">—</span> },
    { key: 'amount', header: 'Amount', numeric: true, render: (e) => <AmountCell entry={e} /> },
  ]

  const historyBody = () => {
    if (state.status === 'error' && !workspace) {
      return <ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your transaction history" />
    }
    if (!workspace) {
      return <div className="cx-card__pad"><LoadingBlock lines={5} label="Loading transactions" /></div>
    }
    return (
      <>
        <DataTable
          caption="Wallet transactions"
          stackOnMobile
          columns={columns}
          rows={shown}
          rowKey={(e) => e.id}
          empty={
            entries.length === 0 ? (
              <EmptyState
                icon={<Receipt size={24} />}
                title="No transactions yet"
                body="When your wallet is credited or charged, each transaction will be listed here with its date, type and amount."
              />
            ) : (
              <EmptyState compact icon={<Receipt size={24} />} title={filter === 'credit' ? 'No credits in your history' : 'No charges in your history'} />
            )
          }
        />
        {filtered.length > shown.length ? (
          <div className="cx-inbox__more">
            <Button variant="secondary" onClick={() => setVisible((v) => v + PAGE_SIZE)}>
              Show more ({formatInteger(filtered.length - shown.length)} remaining)
            </Button>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Billing & wallet"
        description="Your wallet balance and every recorded transaction."
        actions={
          <>
            <Button variant="secondary" onClick={refreshAll} disabled={state.status === 'loading' || wallet.state.status === 'loading'}>
              <RefreshCw size={15} /> Refresh
            </Button>
            <Button variant="primary" onClick={openAdd}>
              <Plus size={15} /> Add money
            </Button>
          </>
        }
      />

      <Notice icon={<Info size={17} />}>
        {added !== null ? (
          <>
            <strong>{formatCurrency(added, 'INR')} added to your wallet.</strong>{' '}
          </>
        ) : null}
        <strong>Demo payments.</strong> Add money credits your wallet straight away. No real payment is taken, and each
        top-up appears in your history as a demo top-up.
      </Notice>

      <div className="cx-grid cx-grid--4" role="list" aria-label="Wallet summary">
        <Card as="div">
          <div role="listitem">
            <Stat icon={<Wallet size={15} />} label="Wallet balance" value={balanceValue} hint={balanceHint} />
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            {!workspace ? (
              <Skeleton height={64} />
            ) : (
              <Stat
                label="Total credited"
                value={primary ? formatCurrency(primary.credited, primary.currency) : null}
                hint={primary ? `${formatInteger(credits)} credit${credits === 1 ? '' : 's'} · completed only` : 'No transactions yet'}
              />
            )}
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            {!workspace ? (
              <Skeleton height={64} />
            ) : (
              <Stat
                label="Total charged"
                value={primary ? formatCurrency(primary.debited, primary.currency) : null}
                hint={primary ? `${formatInteger(debits)} charge${debits === 1 ? '' : 's'} · completed only` : 'No transactions yet'}
              />
            )}
          </div>
        </Card>
        <Card as="div">
          <div role="listitem">
            {!workspace ? (
              <Skeleton height={64} />
            ) : (
              <Stat
                label="Transactions"
                value={formatInteger(entries.length)}
                hint={otherCurrencies ? `Totals shown in ${primary?.currency}; also recorded in ${otherCurrencies}` : 'All time'}
              />
            )}
          </div>
        </Card>
      </div>

      <section className="cx-section" aria-labelledby="cx-ledger-title">
        <Card flush>
          <div className="cx-card__pad">
            <CardHeader
              id="cx-ledger-title"
              title="Transaction history"
              description="Dates, types and amounts exactly as recorded"
              action={
                <Segmented
                  label="Filter transactions"
                  value={filter}
                  onChange={(f) => {
                    setFilter(f)
                    setVisible(PAGE_SIZE)
                  }}
                  options={[
                    { value: 'all', label: `All · ${entries.length}` },
                    { value: 'credit', label: `Credits · ${credits}` },
                    { value: 'debit', label: `Charges · ${debits}` },
                  ]}
                />
              }
            />
          </div>
          {historyBody()}
        </Card>
        <p className="cx-footnote">
          Totals add up completed transactions in each recorded currency. They describe the history above and are not a reconciliation of your balance.
        </p>
      </section>

      <Dialog
        open={addOpen}
        title="Add money"
        description="Demo top-up: the amount is credited to your wallet straight away. No payment is taken."
        onClose={closeAdd}
        dismissible={!adding}
      >
        <form onSubmit={submitAdd} className="cx-form" noValidate>
          <Field label="Amount (₹)" error={addError ?? undefined} hint={`Up to ${formatCurrency(MAX_DEMO_TOPUP, 'INR')} at a time.`}>
            {({ inputId, describedBy, invalid }) => (
              <TextInput
                id={inputId}
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
                inputMode="decimal"
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                data-autofocus
                placeholder="500"
              />
            )}
          </Field>
          <div className="cx-dialog__foot cx-dialog__foot--inline">
            <Button variant="ghost" onClick={closeAdd} disabled={adding}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={adding}>{adding ? 'Adding…' : 'Add money'}</Button>
          </div>
        </form>
      </Dialog>

      <section className="cx-section" aria-labelledby="cx-pricing-title">
        <Card>
          <CardHeader id="cx-pricing-title" title="Pricing" description="How inference usage relates to your wallet" />
          <p className="cx-prose">
            <strong>Pricing is not configured.</strong> Per-model pricing has not been set up yet, so inference requests
            are recorded without a cost and are not charged to your wallet. Charges that do appear above are wallet
            transactions recorded by the platform.
          </p>
          <div className="cx-form__actions cx-form__actions--start">
            <ButtonLink to={sectionHref(getSection('usage'))} variant="secondary" size="sm">
              Usage &amp; analytics <ArrowRight size={14} />
            </ButtonLink>
          </div>
        </Card>
      </section>
    </>
  )
}
