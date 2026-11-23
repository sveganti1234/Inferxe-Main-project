/**
 * Usage & analytics — computed entirely from the customer's recorded `inference_requests`
 * (GET /api/customer/workspace). No sample data: with no records the page shows an honest
 * empty state, and cost is only shown when the backend recorded one.
 */
import { useMemo, useState } from 'react'
import { Activity, AlertTriangle, BookOpen, Clock, Cpu, FlaskConical, KeyRound, RefreshCw, Zap } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { formatCompact, formatDateTime, formatInteger, formatPercent, selectApiKeySummary } from '../data/selectors'
import {
  selectUsageReport,
  USAGE_WINDOWS,
  type ModelBreakdown,
  type RequestRow,
  type UsageDay,
  type UsageWindow,
} from '../data/usage'
import { getSection, sectionHref } from '../navigation'
import { useSharedConsoleSignals } from '../shell/useConsoleSignals'
import { signOutToLogin } from '../shell/CustomerShell'
import { StackedColumnChart, type ChartDatum } from '../ui/charts'
import { Segmented } from '../ui/controls'
import { Button, ButtonLink, Card, CardHeader, DataTable, Notice, PageHeader, Stat, StatusPill, type Column } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock, Skeleton } from '../ui/states'

const LOG_PAGE = 15

const axisFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' })
const fullFormat = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

function toChartData(days: UsageDay[], pick: (d: UsageDay) => Record<string, number>): ChartDatum[] {
  return days.map((d) => {
    const at = new Date(`${d.date}T00:00:00Z`)
    return { key: d.date, label: `${fullFormat.format(at)} (UTC)`, axisLabel: axisFormat.format(at), values: pick(d) }
  })
}

const ms = (value: number | null) => (value === null ? null : `${formatInteger(value)} ms`)

function KpiSkeleton() {
  return (
    <div className="cx-grid cx-grid--5" aria-hidden="true">
      {Array.from({ length: 5 }, (_, i) => (
        <Card key={i} as="div"><Skeleton height={64} /></Card>
      ))}
    </div>
  )
}

export default function UsagePage() {
  const section = getSection('usage')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()
  const signals = useSharedConsoleSignals()
  const [windowDays, setWindowDays] = useState<UsageWindow>(30)
  const [logVisible, setLogVisible] = useState(LOG_PAGE)

  const report = useMemo(() => (workspace ? selectUsageReport(workspace, { windowDays }) : null), [workspace, windowDays])

  const header = (
    <PageHeader
      title="Usage & analytics"
      description="Requests, tokens, latency and reliability of your inference traffic, from your recorded API requests."
      actions={
        <>
          <Segmented
            label="Time range"
            value={String(windowDays) as `${UsageWindow}`}
            onChange={(v) => {
              setWindowDays(Number(v) as UsageWindow)
              setLogVisible(LOG_PAGE)
            }}
            options={USAGE_WINDOWS.map((d) => ({ value: String(d) as `${UsageWindow}`, label: `${d} days` }))}
          />
          <Button variant="secondary" onClick={refresh} disabled={state.status === 'loading'} aria-label="Refresh usage">
            <RefreshCw size={15} />
          </Button>
        </>
      }
    />
  )

  if (state.status === 'error' && !workspace) {
    return (
      <>
        {header}
        <Card><ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your usage data" /></Card>
      </>
    )
  }

  if (!report) {
    return (
      <>
        {header}
        <KpiSkeleton />
        <section className="cx-section"><Card><LoadingBlock lines={6} label="Loading usage" /></Card></section>
      </>
    )
  }

  const unavailableNotice =
    signals.inferenceAvailable === false ? (
      <Notice tone="warning" icon={<AlertTriangle size={17} />}>
        <strong>The inference API is not serving requests right now.</strong> The model provider is not configured on the
        server, so new requests will fail until it is. Existing records below are unaffected.
      </Notice>
    ) : null

  // Nothing has ever been recorded.
  if (report.allTimeRequests === 0) {
    return (
      <>
        {header}
        {unavailableNotice}
        <Card>
          <EmptyState
            icon={<Activity size={24} />}
            title="No inference requests yet"
            body="Requests you send to the Inferxe inference API with one of your API keys are recorded here: volume, tokens, latency and reliability. Nothing is estimated or sampled."
            actions={
              <>
                {selectApiKeySummary(workspace!).active > 0 ? (
                  <ButtonLink to={sectionHref(getSection('playground'))} variant="primary"><FlaskConical size={15} /> Send a request in the playground</ButtonLink>
                ) : (
                  <ButtonLink to={sectionHref(getSection('api-keys'))} variant="primary"><KeyRound size={15} /> Create an API key</ButtonLink>
                )}
                <ButtonLink to="/developers" variant="secondary"><BookOpen size={15} /> Developer docs</ButtonLink>
              </>
            }
          />
        </Card>
      </>
    )
  }

  const earlier = report.allTimeRequests - report.requests
  const days = report.days
  const requestChart = toChartData(days, (d) => ({ successful: d.successful, failed: d.failed }))
  const tokenChart = toChartData(days, (d) => ({ input: d.inputTokens, output: d.outputTokens }))

  const modelColumns: Column<ModelBreakdown>[] = [
    { key: 'model', header: 'Model', render: (m) => <span className="cx-mono">{m.model}</span> },
    { key: 'requests', header: 'Requests', numeric: true, render: (m) => formatInteger(m.requests) },
    { key: 'success', header: 'Success rate', numeric: true, render: (m) => formatPercent(m.successRate) },
    { key: 'in', header: 'Input tokens', numeric: true, render: (m) => formatInteger(m.inputTokens) },
    { key: 'out', header: 'Output tokens', numeric: true, render: (m) => formatInteger(m.outputTokens) },
    { key: 'latency', header: 'Avg latency', numeric: true, render: (m) => ms(m.averageLatencyMs) ?? <span className="cx-muted">—</span> },
  ]

  const logColumns: Column<RequestRow>[] = [
    { key: 'time', header: 'Time', render: (r) => <span className="cx-nowrap">{formatDateTime(r.at)}</span> },
    { key: 'model', header: 'Model', render: (r) => <span className="cx-mono">{r.model}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (r) => (r.successful ? <StatusPill tone="success" dot>Success</StatusPill> : <StatusPill tone="danger">{r.status === 'timeout' ? 'Timeout' : 'Failed'}</StatusPill>),
    },
    { key: 'tokens', header: 'Tokens in / out', numeric: true, render: (r) => `${formatInteger(r.inputTokens)} / ${formatInteger(r.outputTokens)}` },
    { key: 'latency', header: 'Latency', numeric: true, render: (r) => ms(r.latencyMs) ?? <span className="cx-muted">—</span> },
  ]

  const latency = report.latency
  const latencyHint =
    latency.samples === 0
      ? 'No latency recorded'
      : latency.p95Ms === null
        ? `p50 ${formatInteger(latency.p50Ms)} ms · p95 needs 20+ requests`
        : `p50 ${formatInteger(latency.p50Ms)} · p95 ${formatInteger(latency.p95Ms)} ms`

  return (
    <>
      {header}
      {unavailableNotice}

      <div className="cx-grid cx-grid--5" role="list" aria-label={`Usage summary, last ${windowDays} days`}>
        <Card as="div"><div role="listitem">
          <Stat icon={<Activity size={15} />} label="Requests" value={formatInteger(report.requests)} hint={`${formatInteger(report.successful)} successful · ${formatInteger(report.failed)} failed`} />
        </div></Card>
        <Card as="div"><div role="listitem">
          <Stat icon={<Zap size={15} />} label="Tokens" value={formatCompact(report.inputTokens + report.outputTokens)} hint={`${formatCompact(report.inputTokens)} in · ${formatCompact(report.outputTokens)} out`} />
        </div></Card>
        <Card as="div"><div role="listitem">
          <Stat label="Success rate" value={formatPercent(report.successRate)} hint={report.requests ? `${formatInteger(report.failed)} unsuccessful` : 'No requests in this period'} />
        </div></Card>
        <Card as="div"><div role="listitem">
          <Stat icon={<Clock size={15} />} label="Avg latency" value={ms(latency.averageMs)} hint={latencyHint} />
        </div></Card>
        <Card as="div"><div role="listitem">
          {report.pricingConfigured && report.recordedCost !== null ? (
            <Stat
              icon={<Cpu size={15} />}
              label="Recorded cost"
              value={new Intl.NumberFormat('en-IN', { maximumFractionDigits: 4 }).format(report.recordedCost)}
              hint="Currency is not recorded on requests"
            />
          ) : (
            <Stat icon={<Cpu size={15} />} label="Spend" value="Pricing not configured" valueSize="sm" hint="Requests are recorded without a cost" />
          )}
        </div></Card>
      </div>

      {report.requests === 0 ? (
        <section className="cx-section">
          <Card>
            <EmptyState
              icon={<Activity size={24} />}
              title={`No requests in the last ${windowDays} days`}
              body={`${formatInteger(earlier)} earlier request${earlier === 1 ? ' is' : 's are'} recorded outside this period.`}
              actions={
                windowDays !== 90 ? (
                  <Button variant="secondary" onClick={() => setWindowDays(90)}>Show the last 90 days</Button>
                ) : undefined
              }
            />
          </Card>
        </section>
      ) : (
        <>
          <div className="cx-grid cx-grid--2 cx-section">
            <Card aria-labelledby="cx-req-chart">
              <CardHeader id="cx-req-chart" title="Requests per day" description={`Last ${windowDays} days · days with no requests are shown as zero`} />
              <StackedColumnChart
                data={requestChart}
                series={[
                  { id: 'successful', label: 'Successful', tone: 'accent' },
                  { id: 'failed', label: 'Failed', tone: 'danger' },
                ]}
                valueLabel={formatInteger}
                tickLabel={formatCompact}
                ariaLabel={`Requests per day, last ${windowDays} days`}
              />
            </Card>
            <Card aria-labelledby="cx-tok-chart">
              <CardHeader id="cx-tok-chart" title="Tokens per day" description="Input and output tokens as recorded by the API" />
              <StackedColumnChart
                data={tokenChart}
                series={[
                  { id: 'input', label: 'Input', tone: 'info' },
                  { id: 'output', label: 'Output', tone: 'accent' },
                ]}
                valueLabel={formatInteger}
                tickLabel={formatCompact}
                ariaLabel={`Tokens per day, last ${windowDays} days`}
              />
            </Card>
          </div>

          <section className="cx-section" aria-labelledby="cx-models-title">
            <Card flush>
              <div className="cx-card__pad">
                <CardHeader id="cx-models-title" title="By model" description="Volume, reliability and latency per model" />
              </div>
              <DataTable caption="Usage by model" stackOnMobile columns={modelColumns} rows={report.models} rowKey={(m) => m.model} empty={null} />
            </Card>
          </section>

          {report.failures.length > 0 ? (
            <section className="cx-section" aria-labelledby="cx-fail-title">
              <Card>
                <CardHeader id="cx-fail-title" title="Recent failures" description="The latest unsuccessful requests, with the error recorded by the API" />
                <ul className="cx-activity">
                  {report.failures.map((f) => (
                    <li key={f.id} className="cx-activity__row">
                      <span className="cx-activity__icon cx-activity__icon--warning" aria-hidden="true"><AlertTriangle size={16} /></span>
                      <div className="cx-activity__text">
                        <div className="cx-activity__title"><span className="cx-mono">{f.model}</span> <StatusPill tone="danger">{f.status === 'timeout' ? 'Timeout' : 'Failed'}</StatusPill></div>
                        <div className="cx-activity__detail">{f.error ? f.error.slice(0, 200) : 'No error message was recorded.'}</div>
                      </div>
                      <time className="cx-activity__time" dateTime={f.at}>{formatDateTime(f.at)}</time>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}

          <section className="cx-section" aria-labelledby="cx-log-title">
            <Card flush>
              <div className="cx-card__pad">
                <CardHeader id="cx-log-title" title="Request log" description={`${formatInteger(report.requests)} request${report.requests === 1 ? '' : 's'} in the last ${windowDays} days, newest first`} />
              </div>
              <DataTable caption="Inference request log" stackOnMobile columns={logColumns} rows={report.log.slice(0, logVisible)} rowKey={(r) => r.id} empty={null} />
              {report.log.length > logVisible ? (
                <div className="cx-inbox__more">
                  <Button variant="secondary" onClick={() => setLogVisible((v) => v + LOG_PAGE)}>
                    Show more ({formatInteger(report.log.length - logVisible)} remaining)
                  </Button>
                </div>
              ) : null}
            </Card>
          </section>
          <p className="cx-footnote">Days are UTC calendar days. All figures are computed from your recorded requests; nothing is estimated.</p>
        </>
      )}
    </>
  )
}
