/**
 * LLM catalog — a REFERENCE catalogue.
 * Specifications come from the static catalogue (`src/data/gpus.ts`) and the existing memory
 * calculator (`lib/calc.ts`). Nothing here reflects what Inferxe is serving or what anything
 * costs: no prices, no availability, no roadmap status. The page says so, next to the data.
 */
import { useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, BrainCircuit, Calculator, Check, GitCompareArrows, Info, Search, X } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { fmtGB } from '../../../lib/calc'
import {
  CONCURRENCY_PRESETS,
  CONTEXT_PRESETS,
  DEFAULT_SCENARIO,
  MAX_COMPARE,
  MODEL_FAMILIES,
  QUANTS,
  estimateFit,
  filterModels,
  formatContext,
  formatKib,
  formatParams,
  memoryFor,
  selectModelRows,
  type FitRow,
  type ModelFamily,
  type ModelRow,
  type Quant,
  type Scenario,
} from '../data/models'
import { formatInteger, formatPercent } from '../data/selectors'
import { getSection, sectionHref } from '../navigation'
import { Field, Segmented, Select, TextInput } from '../ui/controls'
import { Button, Card, CardHeader, DataTable, Notice, PageHeader, StatusPill, type Column } from '../ui/primitives'
import { EmptyState } from '../ui/states'
import { useTilt } from '../ui/useTilt'

const quantLabel = (q: Quant) => QUANTS.find((x) => x.id === q)?.label ?? q

function ModelCard({
  model,
  quant,
  selected,
  compared,
  compareFull,
  onEstimate,
  onToggleCompare,
}: {
  model: ModelRow
  quant: Quant
  selected: boolean
  compared: boolean
  compareFull: boolean
  onEstimate: () => void
  onToggleCompare: () => void
}) {
  const tilt = useTilt()

  return (
    <div className="cx-tilt" {...tilt}>
    {/* Same building blocks (cx-listing__*) as the GPU marketplace cards, so both share one look */}
    <Card as="article" className={`cx-listing cx-model${selected ? ' is-selected' : ''}`} aria-label={model.name}>
      <div className="cx-listing__top-row">
        <span className="cx-listing__icon-badge" aria-hidden="true">
          <BrainCircuit size={19} />
        </span>
        <StatusPill tone="info">{model.family}</StatusPill>
        <span className="cx-model__params" style={{ marginLeft: 'auto' }}>{formatParams(model.params)} parameters</span>
      </div>

      <div className="cx-listing__titles">
        <h3 className="cx-listing__model">{model.name}</h3>
        <p className="cx-listing__subtitle">{model.architecture}</p>
      </div>

      <dl className="cx-kv cx-listing__specs">
        <div className="cx-listing__spec">
          <dt>Parameters</dt>
          <dd>{formatParams(model.params)}</dd>
        </div>
        <div className="cx-listing__spec">
          <dt>Family</dt>
          <dd>{model.family}</dd>
        </div>
      </dl>

      <div className="cx-listing__metrics">
        <div>
          <span className="cx-listing__metric-label">WEIGHTS · {quantLabel(quant)}</span>
          <strong className="cx-listing__metric-val cx-listing__metric-val--price">{fmtGB(model.weightsGb[quant])}</strong>
        </div>
        <div>
          <span className="cx-listing__metric-label">KV CACHE / TOKEN</span>
          <strong className="cx-listing__metric-val">{formatKib(model.kvKibPerToken)}</strong>
        </div>
      </div>

      <div className="cx-listing__actions-bar">
        <Button variant="primary" className="cx-listing__btn-deploy" onClick={onEstimate} aria-label={`Estimate GPU fit for ${model.name}`}>
          <Calculator size={15} /> Estimate fit
        </Button>
        <Button
          variant={compared ? 'primary' : 'secondary'}
          size="sm"
          onClick={onToggleCompare}
          aria-pressed={compared}
          disabled={!compared && compareFull}
          aria-label={`${compared ? 'Remove' : 'Add'} ${model.name} ${compared ? 'from' : 'to'} comparison`}
        >
          {compared ? <Check size={14} /> : <GitCompareArrows size={14} />} {compared ? 'Comparing' : 'Compare'}
        </Button>
      </div>
    </Card>
    </div>
  )
}

function ComparePanel({ models, scenario, onRemove, onClear }: { models: ModelRow[]; scenario: Omit<Scenario, 'modelId'>; onRemove: (id: string) => void; onClear: () => void }) {
  const detail = models.map((m) => ({
    model: m,
    need: memoryFor(m.id, scenario).need,
    fit: estimateFit({ ...scenario, modelId: m.id }).smallestFit,
  }))
  const rows: Array<{ label: string; cell: (d: (typeof detail)[number]) => string }> = [
    { label: 'Family', cell: (d) => d.model.family },
    { label: 'Parameters', cell: (d) => formatParams(d.model.params) },
    { label: 'Architecture', cell: (d) => d.model.architecture },
    { label: 'KV cache per token', cell: (d) => formatKib(d.model.kvKibPerToken) },
    ...QUANTS.map((q) => ({ label: `Weights · ${q.label}`, cell: (d: (typeof detail)[number]) => fmtGB(d.model.weightsGb[q.id]) })),
    { label: `Total memory · ${quantLabel(scenario.quant)}, ${formatContext(scenario.context)} context, ${scenario.concurrency} concurrent`, cell: (d) => fmtGB(d.need) },
    { label: 'Smallest configuration that fits', cell: (d) => (d.fit ? `${d.fit.label} (${fmtGB(d.fit.totalGb)})` : 'None of the reference configurations') },
  ]
  return (
    <Card aria-labelledby="cx-compare-title">
      <CardHeader
        id="cx-compare-title"
        title={<span className="cx-title-icon"><GitCompareArrows size={17} aria-hidden="true" /> Compare models</span>}
        description="Reference specifications side by side. Memory figures use the scenario in the estimator below."
        action={<Button variant="ghost" size="sm" onClick={onClear}>Clear comparison</Button>}
      />
      {models.length < 2 ? (
        <p className="cx-muted cx-small">Select at least one more model to compare. You can compare up to {MAX_COMPARE}.</p>
      ) : (
        <div className="cx-table-wrap">
          <table className="cx-table cx-compare">
            <caption className="cx-sr-only">Model comparison</caption>
            <thead>
              <tr>
                <th scope="col"><span className="cx-sr-only">Specification</span></th>
                {models.map((m) => (
                  <th key={m.id} scope="col">
                    <span className="cx-compare__head">
                      {m.name}
                      <button type="button" className="cx-compare__remove" onClick={() => onRemove(m.id)} aria-label={`Remove ${m.name} from comparison`}>
                        <X size={13} />
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {detail.map((d) => (
                    <td key={d.model.id}>{r.cell(d)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

export default function ModelsPage() {
  const section = getSection('models')
  usePageMeta(section.label, section.description)
  const rows = useMemo(selectModelRows, [])
  const [query, setQuery] = useState('')
  const [family, setFamily] = useState<ModelFamily | 'all'>('all')
  const [scenario, setScenario] = useState<Scenario>(DEFAULT_SCENARIO)
  const [compare, setCompare] = useState<string[]>([])
  const calcRef = useRef<HTMLElement>(null)

  const filtered = filterModels(rows, { query, family })
  const fit = useMemo(() => estimateFit(scenario), [scenario])
  const model = rows.find((m) => m.id === scenario.modelId) ?? rows[0]
  const comparedModels = compare.map((id) => rows.find((m) => m.id === id)).filter((m): m is ModelRow => Boolean(m))
  const set = (patch: Partial<Scenario>) => setScenario((s) => ({ ...s, ...patch }))

  const estimate = (id: string) => {
    set({ modelId: id })
    const el = calcRef.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const toggleCompare = (id: string) =>
    setCompare((cur) => (cur.includes(id) ? cur.filter((c) => c !== id) : cur.length >= MAX_COMPARE ? cur : [...cur, id]))

  const mem = fit.memory
  const parts = [
    { id: 'weights', label: 'Model weights', gb: mem.weights, tone: 'accent' },
    { id: 'kv', label: 'KV cache', gb: mem.kv, tone: 'info' },
    { id: 'overhead', label: 'Runtime overhead', gb: mem.overhead, tone: 'violet' },
  ] as const

  const fitColumns: Column<FitRow>[] = [
    { key: 'cfg', header: 'Configuration', render: (r) => <strong className="cx-keycell__name">{r.label}</strong> },
    { key: 'total', header: 'Total VRAM', numeric: true, render: (r) => fmtGB(r.totalGb) },
    { key: 'usable', header: 'Usable (90%)', numeric: true, render: (r) => fmtGB(r.usableGb) },
    { key: 'fit', header: 'Fit', render: (r) => (r.fits ? <StatusPill tone="success" dot>Fits</StatusPill> : <StatusPill tone="danger">Too small</StatusPill>) },
    {
      key: 'room',
      header: 'Headroom',
      numeric: true,
      render: (r) => (r.fits ? formatPercent(r.headroom) : <span className="cx-muted">needs {fmtGB(r.shortfallGb)} more</span>),
    },
    { key: 'tps', header: 'Decode ceiling', numeric: true, render: (r) => (r.fits ? `≤ ${formatInteger(Math.round(r.ceilingTps))} tok/s` : <span className="cx-muted">—</span>) },
  ]

  return (
    <>
      <PageHeader
        title="LLM catalog"
        description="Browse open-weight models and estimate the GPU memory they need."
      />

      <Notice icon={<Info size={17} />}>
        <strong>Reference specifications, not live availability or pricing.</strong> Model sizes and GPU-fit estimates
        are static planning figures. They do not show what Inferxe is serving or what anything costs. The inference
        API currently serves one model, chosen by the server — see the{' '}
        <Link to={sectionHref(getSection('playground'))}>Inference playground</Link>.
      </Notice>

      <div className="cx-filterbar">
        <div className="cx-searchbox">
          <Search size={16} aria-hidden="true" />
          <TextInput
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models, families or architectures"
            aria-label="Search models"
            autoComplete="off"
          />
        </div>
        <Segmented<ModelFamily | 'all'>
          label="Filter by family"
          value={family}
          onChange={setFamily}
          options={[{ value: 'all', label: 'All' }, ...MODEL_FAMILIES.map((f) => ({ value: f, label: f }))]}
        />
        <span className="cx-muted cx-small" aria-live="polite">{filtered.length} of {rows.length} models</span>
      </div>

      {filtered.length === 0 ? (
        <Card>
          <EmptyState
            icon={<BrainCircuit size={24} />}
            title="No models match your search"
            body="Try a different name or family."
            actions={<Button variant="secondary" onClick={() => { setQuery(''); setFamily('all') }}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <div className="cx-grid cx-grid--3 cx-listings" role="list" aria-label="Models">
          {filtered.map((m) => (
            <div role="listitem" key={m.id} className="cx-grid__item">
              <ModelCard
                model={m}
                quant={scenario.quant}
                selected={scenario.modelId === m.id}
                compared={compare.includes(m.id)}
                compareFull={compare.length >= MAX_COMPARE}
                onEstimate={() => estimate(m.id)}
                onToggleCompare={() => toggleCompare(m.id)}
              />
            </div>
          ))}
        </div>
      )}

      {comparedModels.length > 0 ? (
        <section className="cx-section">
          <ComparePanel
            models={comparedModels}
            scenario={{ quant: scenario.quant, context: scenario.context, concurrency: scenario.concurrency }}
            onRemove={toggleCompare}
            onClear={() => setCompare([])}
          />
        </section>
      ) : null}

      <section className="cx-section" ref={calcRef} aria-labelledby="cx-calc-title" tabIndex={-1}>
        <Card>
          <CardHeader
            id="cx-calc-title"
            title={<span className="cx-title-icon"><Calculator size={17} aria-hidden="true" /> GPU memory estimator</span>}
            description="Estimate the memory a model needs and which reference GPU configurations could hold it. This does not check what is available."
          />
          <div className="cx-calc-controls">
            <Field label="Model">
              {({ inputId }) => (
                <Select id={inputId} value={scenario.modelId} onChange={(e) => set({ modelId: e.target.value })}>
                  {rows.map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </Select>
              )}
            </Field>
            <div className="cx-field">
              <span className="cx-field__label" id="cx-precision-label">Precision</span>
              <Segmented<Quant>
                label="Precision"
                value={scenario.quant}
                onChange={(quant) => set({ quant })}
                options={QUANTS.map((q) => ({ value: q.id, label: q.label }))}
              />
              <p className="cx-field__hint">{QUANTS.find((q) => q.id === scenario.quant)?.hint}</p>
            </div>
            <Field label="Context length" hint="Tokens held in the KV cache per request.">
              {({ inputId, describedBy }) => (
                <Select id={inputId} value={scenario.context} onChange={(e) => set({ context: Number(e.target.value) })} aria-describedby={describedBy}>
                  {CONTEXT_PRESETS.map((c) => (
                    <option key={c} value={c}>{formatContext(c)} tokens</option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Concurrent requests" hint="Requests served at the same time.">
              {({ inputId, describedBy }) => (
                <Select id={inputId} value={scenario.concurrency} onChange={(e) => set({ concurrency: Number(e.target.value) })} aria-describedby={describedBy}>
                  {CONCURRENCY_PRESETS.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <div className="cx-membar-wrap" role="group" aria-label={`Estimated memory for ${model.name}`}>
            <div className="cx-membar-head">
              <span className="cx-muted cx-small">Estimated memory needed</span>
              <strong className="cx-membar-total">{fmtGB(mem.need)}</strong>
            </div>
            <div className="cx-membar" aria-hidden="true">
              {parts.map((p) => (
                <span key={p.id} className={`cx-chart__seg cx-chart__seg--${p.tone}`} style={{ flexGrow: Math.max(p.gb, 0.001) }} />
              ))}
            </div>
            <ul className="cx-membar-legend">
              {parts.map((p) => (
                <li key={p.id}>
                  <span className={`cx-chart__swatch cx-chart__seg--${p.tone}`} aria-hidden="true" />
                  {p.label}
                  <strong>{fmtGB(p.gb)}</strong>
                </li>
              ))}
            </ul>
          </div>

          <p className="cx-fit-summary" role="status">
            {fit.smallestFit ? (
              <>Smallest reference configuration that fits: <strong>{fit.smallestFit.label}</strong> ({fmtGB(fit.smallestFit.totalGb)} VRAM).</>
            ) : (
              fit.note
            )}
          </p>
        </Card>
      </section>

      <section className="cx-section" aria-labelledby="cx-fit-title">
        <Card flush>
          <div className="cx-card__pad">
            <CardHeader id="cx-fit-title" title="Reference GPU configurations" description={`${model.name} · ${quantLabel(scenario.quant)} · ${formatContext(scenario.context)} context · ${scenario.concurrency} concurrent`} />
          </div>
          <DataTable caption="GPU fit estimate" columns={fitColumns} rows={fit.rows} rowKey={(r) => r.key} empty={null} stackOnMobile />
        </Card>
        <p className="cx-footnote">
          Usable memory is 90% of the device total, a typical serving default. The decode ceiling is a theoretical upper bound from memory bandwidth — not a benchmark.
          These are reference configurations, not a list of what is available.{' '}
          <Link to={sectionHref(getSection('gpus'))}>See GPU capacity that is actually listed <ArrowRight size={12} aria-hidden="true" /></Link>
        </p>
      </section>
    </>
  )
}
