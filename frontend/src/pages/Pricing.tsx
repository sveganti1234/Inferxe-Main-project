import { Plus } from 'lucide-react'
import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { Accordion } from '../components/ui/Accordion'
import { Glass, Plate } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { CostEstimator, RateRanges, TokenCostCalc } from '../components/widgets/PricingTools'
import { PRICING_FAQ, PRICING_MODELS } from '../data/content'
import { usePageMeta } from '../lib/hooks'

export default function Pricing() {
  usePageMeta('Pricing', 'Customer price = provider cost + service fee. Indicative NVIDIA GPU rates, a monthly cost estimator, token-equivalent pricing and the phased commercial model.')
  return (
    <>
      <PageHero
        crumb="Pricing"
        eyebrow="Pricing"
        title={['Provider cost,', 'plus a clear fee.']}
        lead="Inferxe charges a platform fee on GPU consumption. You always see what the GPU costs and what we add — and you see the estimate before you deploy."
        image="/images/enterprise.webp"
        focus="center 40%"
        actions={
          <>
            <LinkButton href="#estimator" size="lg" arrow>
              Estimate my cost
            </LinkButton>
            <LinkButton to="/contact" variant="glass" size="lg">
              Talk to us
            </LinkButton>
          </>
        }
        aside={
          <Plate className="price-eq">
            <span className="engrave">Pricing model</span>
            <div className="well price-eq__row">
              <small className="readout-label">Customer price</small>
              <b className="readout">=</b>
            </div>
            <div className="well price-eq__row">
              <small className="readout-label">Provider cost</small>
              <b className="readout">normalized</b>
            </div>
            <div className="well price-eq__row">
              <small className="readout-label">
                <Plus aria-hidden /> Service fee
              </small>
              <b className="readout">over usage</b>
            </div>
          </Plate>
        }
      />

      <section className="section">
        <div className="container">
          <SectionHead
            eyebrow="Indicative GPU rates"
            title={
              <>
                What the GPUs <span className="grad-text">cost per hour</span>.
              </>
            }
            lead="Planning figures from the project cost model: the on-demand range seen at the provider, and the suggested marketplace list rate that Inferxe would quote."
          />
          <Reveal>
            <Glass className="pad-l" variant="deep">
              <RateRanges />
              <p className="price-caveat">
                These are planning figures, not a contractual rate card. Actual provider pricing, taxes, region, discounts and availability are verified before any commercial
                commitment. H200, B200-class and GB200/GB300 capacity is availability-dependent and quoted on request.
              </p>
            </Glass>
          </Reveal>
        </div>
      </section>

      <section className="section section--flush-top" id="estimator">
        <div className="container">
          <SectionHead
            eyebrow="Cost estimator"
            title="Estimate a month of GPU time"
            lead="Choose a GPU, a count and a schedule. The estimate uses the planning list rates above."
          />
          <Reveal>
            <CostEstimator />
          </Reveal>
        </div>
      </section>

      <section className="section" id="normalized">
        <div className="container">
          <SectionHead
            eyebrow="Normalization"
            title={
              <>
                One metric to <span className="grad-text">compare everything</span>.
              </>
            }
            lead="Providers bill per token, per GPU-hour, per request or per reserved block. Inferxe converts each into an effective cost per 1M tokens — based on measured throughput, never a universal conversion."
          />
          <Stagger className="grid grid-3 pm-dark">
            {PRICING_MODELS.map((m) => (
              <StaggerItem key={m.title}>
                <Glass radius="m" className="pad pm-dark__card">
                  <b>{m.title}</b>
                  <p>{m.basis}</p>
                  <span className="chip chip--sm">{m.unit}</span>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal>
            <div className="mt-4">
              <TokenCostCalc />
            </div>
          </Reveal>
        </div>
      </section>


      <section className="section">
        <div className="container split split--wide-right">
          <SectionHead eyebrow="FAQ" title="Questions about pricing" lead="Short, honest answers — including what is still planning-stage." />
          <Reveal>
            <Accordion items={PRICING_FAQ} />
          </Reveal>
        </div>
      </section>

      <CtaBand title="See your estimate on real workloads." lead="Request access and we will size a workload with you — GPU class, cost range and the reasoning behind it." image="/images/enterprise.webp" />
    </>
  )
}
