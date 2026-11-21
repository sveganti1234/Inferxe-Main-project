import { AnimatePresence, motion } from 'framer-motion'
import { Clock3, FlaskConical, Layers, ShieldCheck, Waypoints } from 'lucide-react'
import { useState } from 'react'
import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { Glass } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { BarChart } from '../components/widgets/BarChart'
import { GpuStudio } from '../components/widgets/GpuStudio'
import { BENCH_METRICS } from '../data/content'
import { GPUS, type GpuStatus } from '../data/gpus'
import { usePageMeta } from '../lib/hooks'

type Filter = 'All' | GpuStatus
const FILTERS: Filter[] = ['All', 'MVP', 'Benchmarking', 'Roadmap']

const PILLARS = [
  { icon: FlaskConical, title: 'Benchmark corpus', body: 'Measure TTFT, latency and tokens/sec across L4, L40S, H100 and H200 — on real workloads, not datasheets.' },
  { icon: Waypoints, title: 'Routing validation', body: 'Test compatibility and scoring on real workloads, including VRAM edge cases where a model barely fits.' },
  { icon: Layers, title: 'vLLM serving', body: 'Validate Docker and vLLM serving for Qwen, Llama and Mistral models across every supported GPU class.' },
]

export default function Gpus() {
  usePageMeta('GPU catalogue', 'NVIDIA GPUs from L4 to GB200, mapped to workloads: VRAM, bandwidth, planning rates, a model-to-GPU compatibility matrix and the benchmark programme behind routing.')
  const [filter, setFilter] = useState<Filter>('All')
  const list = GPUS.filter((g) => filter === 'All' || g.status === filter)

  return (
    <>
      <PageHero
        crumb="GPU catalogue"
        eyebrow="NVIDIA fit"
        title={['From L4 to GB200,', 'mapped to workloads.']}
        lead="Compatibility and routing key off NVIDIA hardware facts — VRAM and memory class first. Pick a model and see which GPU classes can actually hold it."
        image="/images/gpu-cards.webp"
        focus="center 55%"
        actions={
          <>
            <LinkButton href="#studio" size="lg" arrow>
              Open the placement console
            </LinkButton>
            <LinkButton to="/pricing" variant="glass" size="lg">
              GPU pricing
            </LinkButton>
          </>
        }
        aside={
          <Glass className="pad-l" variant="deep">
            <BarChart
              title="Memory per GPU"
              unit="GB"
              max={180}
              bars={[
                { label: 'L4', value: 24, display: '24' },
                { label: 'L40S', value: 48, display: '48' },
                { label: 'H100', value: 80, display: '80' },
                { label: 'H200', value: 141, display: '141' },
                { label: 'B200 class', value: 180, display: '180+', tone: 'cyan' },
              ]}
            />
          </Glass>
        }
      />

      {/* Catalogue */}
      <section className="section">
        <div className="container">
          <div className="row row--between row--wrap cat__head">
            <SectionHead eyebrow="Catalogue" title="Planning roles by GPU class" lead="What each class is best used for — and where it sits in the Inferxe roadmap." />
            <div className="seg" role="group" aria-label="Filter by status">
              {FILTERS.map((f) => (
                <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === 'MVP' ? 'In MVP' : f}
                </button>
              ))}
            </div>
          </div>
          <motion.div layout className="grid grid-3 cat">
            <AnimatePresence mode="popLayout">
              {list.map((g) => (
                <motion.div key={g.id} layout initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
                  <Glass lift className="pad cat__card">
                    <div className="row row--between">
                      <span className="cat__name">{g.name}</span>
                      <span className={`chip chip--sm ${g.status === 'MVP' ? 'chip--lime' : g.status === 'Benchmarking' ? 'chip--cyan' : ''}`}>{g.status === 'MVP' ? 'In MVP' : g.status}</span>
                    </div>
                    <span className="engrave">
                      {g.arch} · {g.tier}
                    </span>
                    <div className="cat__specs">
                      <div className="well">
                        <span className="readout-label">Memory</span>
                        <b className="readout">{g.vramLabel}</b>
                      </div>
                      <div className="well">
                        <span className="readout-label">Bandwidth</span>
                        <b className="readout cat__bw">{g.bandwidthLabel}</b>
                      </div>
                    </div>
                    <p className="cat__role">{g.role}</p>
                    <ul className="cat__uses">
                      {g.uses.map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                    <div className="cat__price">
                      {g.listRange ? (
                        <>
                          <span className="readout-label">Planning range</span>
                          <b className="readout">
                            ₹{g.providerRange![0]}–₹{g.providerRange![1]}
                            <small>/hr</small>
                          </b>
                        </>
                      ) : (
                        <>
                          <span className="readout-label">Pricing</span>
                          <b className="readout readout--amber">Availability-dependent</b>
                        </>
                      )}
                    </div>
                  </Glass>
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        </div>
      </section>

      {/* Charts */}
      <section className="section section--tight">
        <div className="container grid grid-2">
          <Reveal>
            <Glass className="pad-l" variant="deep">
              <BarChart
                title="Memory capacity"
                unit="GB"
                max={180}
                bars={[
                  { label: 'L4', value: 24, display: '24' },
                  { label: 'L40S', value: 48, display: '48' },
                  { label: 'H100', value: 80, display: '80' },
                  { label: 'H200', value: 141, display: '141' },
                  { label: 'B200+', value: 180, display: '180+', tone: 'cyan' },
                ]}
              />
            </Glass>
          </Reveal>
          <Reveal delay={0.1}>
            <Glass className="pad-l" variant="deep">
              <BarChart
                title="Peak memory bandwidth"
                unit="GB/s"
                max={4800}
                bars={[
                  { label: 'L4', value: 300, display: '300', tone: 'amber' },
                  { label: 'L40S', value: 864, display: '864', tone: 'amber' },
                  { label: 'H100', value: 3350, display: '3,350', tone: 'amber' },
                  { label: 'H200', value: 4800, display: '4,800', tone: 'amber' },
                ]}
              />
              <p className="dim bars__note">Decode speed is largely memory-bandwidth bound — which is why bandwidth, not just VRAM, enters the scoring step.</p>
            </Glass>
          </Reveal>
        </div>
      </section>


      {/* Studio */}
      <section className="section studio-sec" id="studio-sec">
        <div className="container">
          <SectionHead
            center
            eyebrow="Placement console"
            title="Dial in a workload, see the decision"
            lead="The same compatibility-then-score logic the control plane uses, with the reasoning shown."
          />
          <Reveal>
            <GpuStudio />
          </Reveal>
        </div>
      </section>

      {/* Benchmarks */}
      <section className="section bench">
        <div className="container">
          <SectionHead
            center
            eyebrow="Benchmark programme"
            title={
              <>
                Measured, <span className="grad-text">not assumed</span>.
              </>
            }
            lead="Routing is only as good as its data. Inferxe is building a benchmark corpus on NVIDIA hardware so placement is validated by measurement — and published as results are verified."
          />
          <Stagger className="grid grid-3 pillars">
            {PILLARS.map((p) => (
              <StaggerItem key={p.title}>
                <Glass lift className="pad pillar">
                  <span className="icon-tile">
                    <p.icon />
                  </span>
                  <h3 className="h3">{p.title}</h3>
                  <p>{p.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>

          <Reveal>
            <Glass className="pad-l bench__table" variant="deep">
              <div className="row row--between row--wrap">
                <span className="eyebrow eyebrow--plain">Benchmark results</span>
                <span className="chip chip--amber">
                  <Clock3 aria-hidden /> In progress — nothing is claimed until verified
                </span>
              </div>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>GPU</th>
                      <th>TTFT</th>
                      <th>E2E latency</th>
                      <th>Tokens / sec</th>
                      <th>Max concurrency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {GPUS.slice(0, 4).map((g) => (
                      <tr key={g.id}>
                        <td>{g.name}</td>
                        {[0, 1, 2, 3].map((k) => (
                          <td key={k}>
                            <span className="pending">
                              pending
                            </span>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Glass>
          </Reveal>

          <Reveal delay={0.05}>
            <div className="metrics">
              <span className="engrave">What we measure</span>
              <div className="row row--wrap" style={{ gap: 10 }}>
                {BENCH_METRICS.map((m) => (
                  <span className="chip" key={m}>
                    <ShieldCheck aria-hidden /> {m}
                  </span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
