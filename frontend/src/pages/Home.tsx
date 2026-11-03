import { motion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, BellRing, ChevronDown, Gauge, ShieldCheck, Wallet, Activity, CheckCircle2 } from 'lucide-react'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { CtaBand } from '../components/CtaBand'
import { Counter } from '../components/ui/Counter'
import { LinkButton } from '../components/ui/Button'
import { Glass, Plate } from '../components/ui/Glass'
import { Reveal, SplitHeading, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { Tilt } from '../components/ui/Tilt'
import { ConsolePreview } from '../components/widgets/ConsolePreview'
import { GpuStudio } from '../components/widgets/GpuStudio'
import { PipelineSteps } from '../components/widgets/PipelineSteps'
import { RackStack } from '../components/widgets/RackStack'
import { GpuCardArt } from '../components/visuals/GpuCardArt'
import { ProviderMarquee } from '../components/visuals/ProviderMarquee'
import { INDIA_PROVIDERS, PROBLEMS } from '../data/content'
import { GPUS } from '../data/gpus'
import { defaultWorkload, fmtGB, inr, recommend } from '../lib/calc'
import { usePageMeta } from '../lib/hooks'

function Hero() {
  const ref = useRef<HTMLElement>(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], ['0%', '18%'])
  const op = useTransform(scrollYProgress, [0, 0.9], [1, 0.15])
  const { memory, pick } = recommend(defaultWorkload)
  const gpu = pick ? GPUS.find((g) => g.id === pick.gpuId) : undefined

  return (
    <section className="hero" ref={ref}>
      <motion.div className="hero__bg" style={{ y, opacity: op }}>
        <img src="/images/datacenter.webp" alt="" fetchPriority="high" />
      </motion.div>
      <div className="hero__wash" aria-hidden />
      <div className="hero__grid" aria-hidden />

      <div className="container hero__inner">
        <div className="hero__copy">
          <SplitHeading lines={['One API.', 'Many GPU', 'providers.']} className="display hero__title" delay={0.1} accentLast />

          <motion.p className="lead hero__lead" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.7 }}>
            Request compute by what your workload needs. Inferxe is a unified control plane between your applications and GPU providers —
            placing every workload by <b>compatibility</b>, <b>cost</b> and <b>measured performance</b>.
          </motion.p>

          <motion.div className="row row--wrap" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.85 }}>
            <LinkButton to="/signup" size="lg" arrow>
              Log in to try free for 1 hour
            </LinkButton>
            <LinkButton to="/how-it-works" variant="glass" size="lg">
              See how it works
            </LinkButton>
          </motion.div>
        </div>

        <motion.div className="hero__stage" initial={{ opacity: 0, scale: 0.94, y: 30 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={{ duration: 1.2, delay: 0.35, ease: [0.22, 1, 0.36, 1] }}>
          <Tilt max={9} className="hero__tilt">
            <div className="hero__halo" aria-hidden />
            <div className="hero__float">
              <GpuCardArt label={gpu ? `${gpu.name} · ${gpu.vramLabel}` : 'GPU'} />
            </div>

            <Glass className="hchip hchip--a" radius="m" style={{ transform: 'translateZ(70px)' }}>
              <span className="engrave">Workload</span>
              <b>Llama 3.1 8B · FP16</b>
              <small>8K context × 8 concurrent</small>
            </Glass>
            <Glass className="hchip hchip--b" radius="m" style={{ transform: 'translateZ(100px)' }}>
              <span className="engrave">Compatibility</span>
              <b className="readout">
                {fmtGB(memory.need)} <span className="dim">≤</span> {pick ? fmtGB(pick.usable) : '—'}
              </b>
              <small>
                <CheckCircle2 aria-hidden /> VRAM fit verified
              </small>
            </Glass>
            <Glass className="hchip hchip--c" radius="m" variant="lime" style={{ transform: 'translateZ(130px)' }}>
              <span className="engrave">Placed on</span>
              <b>
                {gpu?.name} · {gpu?.vramLabel}
              </b>
              <small>{pick?.rate ? `${inr(pick.rate)}/hr · list rate` : ''}</small>
            </Glass>
          </Tilt>
        </motion.div>
      </div>

      <a href="#problem" className="hero__scroll" aria-label="Scroll to content">
        <span>Scroll</span>
        <ChevronDown aria-hidden />
      </a>
    </section>
  )
}


function Problem() {
  return (
    <section className="section" id="problem">
      <div className="container">
        <div className="split split--wide-right">
          <div>
            <SectionHead
              eyebrow="The problem"
              title={
                <>
                  GPU access is <span className="grad-text">fragmented</span>.
                </>
              }
              lead="Teams turn application needs into provider-specific infrastructure decisions — before a single token is generated."
            />
            <Reveal delay={0.1}>
              <div className="problem__img glass glass--m">
                <img src="/images/patch-panel.webp" alt="Dense network patch panel with tangled cabling" loading="lazy" />
                <div className="problem__cap">
                  <span className="engrave">Every provider, its own wiring</span>
                </div>
              </div>
            </Reveal>
          </div>
          <Stagger className="grid grid-2 problem__cards">
            {PROBLEMS.map((p) => (
              <StaggerItem key={p.title}>
                <Glass lift className="pad problem__card">
                  <span className="icon-tile">
                    <p.icon />
                  </span>
                  <h3 className="h3">{p.title}</h3>
                  <p>{p.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </div>
    </section>
  )
}

function HowItWorks() {
  return (
    <section className="section how" id="how">
      <div className="container">
        <SectionHead
          center
          eyebrow="How it works"
          title="From workload to running GPU"
          lead="Compatibility is deterministic, routing is scored, and providers sit behind adapters."
        />
        <Reveal>
          <Glass className="pad-l how__panel">
            <PipelineSteps />
          </Glass>
        </Reveal>
        <Reveal delay={0.1}>
          <div className="center mt-4">
            <Link to="/how-it-works" className="link-arrow">
              Explore the full workflow <ArrowRight aria-hidden />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function Studio() {
  return (
    <section className="section studio-sec">
      <div className="container">
        <SectionHead
          center
          eyebrow="Try the placement engine"
          title={
            <>
              See a <span className="grad-text">placement decision</span>, not a price list.
            </>
          }
          lead="Pick a model, precision, context and budget. The same compatibility-then-score logic that powers routing shows which NVIDIA GPU fits — and why."
        />
        <Reveal>
          <GpuStudio />
        </Reveal>
      </div>
    </section>
  )
}

function Architecture() {
  return (
    <section className="section arch">
      <div className="container">
        <SectionHead
          center
          eyebrow="Architecture"
          title="Provider-agnostic by design"
          lead="Adding a provider means adding an adapter. The public API stays the same."
        />
        <RackStack />
      </div>
    </section>
  )
}

function NvidiaFit() {
  return (
    <section className="section nv">
      <img className="nv__bg" src="/images/gpu-cards.webp" alt="" loading="lazy" />
      <div className="nv__shade" aria-hidden />
      <div className="container">
        <SectionHead
          eyebrow="NVIDIA fit"
          title="Built on NVIDIA GPUs"
          lead="Compatibility and routing key off NVIDIA hardware facts such as VRAM and memory class — then get validated against measured benchmarks."
        />
        <Stagger className="grid grid-3 nv__grid">
          {GPUS.map((g) => (
            <StaggerItem key={g.id}>
              <Glass lift className="pad gcard">
                <div className="row row--between">
                  <span className="gcard__name">{g.name}</span>
                  <span className={`chip chip--sm ${g.status === 'MVP' ? 'chip--lime' : g.status === 'Benchmarking' ? 'chip--cyan' : ''}`}>{g.status === 'MVP' ? 'In MVP' : g.status}</span>
                </div>
                <div className="gcard__vram">
                  <span className="readout">{g.vramLabel}</span>
                  <span className="readout-label">{g.arch}</span>
                </div>
                <div className="gcard__bar" aria-hidden>
                  <motion.i
                    initial={{ width: 0 }}
                    whileInView={{ width: g.vram ? `${Math.min(100, (g.vram / 180) * 100)}%` : '100%' }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                    className={g.vram ? '' : 'is-multi'}
                  />
                </div>
                <p>{g.role}</p>
              </Glass>
            </StaggerItem>
          ))}
        </Stagger>
        <Reveal>
          <div className="mt-4">
            <Link to="/gpus" className="link-arrow">
              Explore the GPU catalogue <ArrowRight aria-hidden />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

function ConsoleSection() {
  const feats = [
    { icon: Wallet, t: 'Cost views', d: 'Estimated and recorded spend per deployment, before and after you run.' },
    { icon: Activity, t: 'Monitoring', d: 'TTFT, latency, tokens/sec and health from Prometheus and Grafana.' },
    { icon: BellRing, t: 'Audit events', d: 'Every provisioning and lifecycle action recorded for traceability.' },
    { icon: Gauge, t: 'Rate limits & quotas', d: 'Protect GPU spend and the platform from abuse or accidental spikes.' },
  ]
  return (
    <section className="section console-sec">
      <div className="container">
        <div className="split split--wide-right">
          <div>
            <SectionHead
              eyebrow="Console + ops"
              title={
                <>
                  Operate GPU compute from <span className="grad-text">one console</span>.
                </>
              }
              lead="A web console and an OpenAPI-first developer API share the same control plane — so everything you can click, you can automate."
            />
            <Stagger className="console-feats">
              {feats.map((f) => (
                <StaggerItem key={f.t}>
                  <div className="console-feat">
                    <span className="icon-tile icon-tile--sm">
                      <f.icon />
                    </span>
                    <div>
                      <h3 className="h3">{f.t}</h3>
                      <p>{f.d}</p>
                    </div>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
            <Reveal delay={0.2}>
              <div className="mt-3">
                <Link to="/platform" className="link-arrow">
                  See the platform <ArrowRight aria-hidden />
                </Link>
              </div>
            </Reveal>
          </div>
          <Reveal x={40} y={10}>
            <Tilt max={4}>
              <ConsolePreview />
            </Tilt>
          </Reveal>
        </div>
      </div>
    </section>
  )
}

function Stats() {
  const items = [
    { to: 4, suf: '', label: 'NVIDIA GPU classes benchmarked first', sub: 'L4 · L40S · H100 · H200' },
    { to: 3, suf: '', label: 'Open-model families supported', sub: 'Qwen · Llama · Mistral' },
    { to: 12, suf: ' wks', label: 'To a working vertical slice', sub: 'Control plane → benchmarks' },
    { to: 1, suf: '', label: 'Adapter contract for every provider', sub: 'Catalogue · capacity · lifecycle · errors' },
  ]
  return (
    <section className="section section--tight stats">
      <div className="container">
        <Stagger className="grid grid-4">
          {items.map((s) => (
            <StaggerItem key={s.label}>
              <Plate className="stat">
                <div className="well stat__lcd">
                  <span className="readout stat__num">
                    <Counter to={s.to} suffix={s.suf} />
                  </span>
                </div>
                <b>{s.label}</b>
                <small>{s.sub}</small>
              </Plate>
            </StaggerItem>
          ))}
        </Stagger>
      </div>
    </section>
  )
}

function India() {
  return (
    <section className="section india">
      <div className="container">
        <Glass className="india__card" variant="deep">
          <img className="india__img" src="/images/earth-network.webp" alt="" loading="lazy" />
          <div className="india__shade" aria-hidden />
          <div className="india__body">
            <span className="eyebrow">Policy-aware placement</span>
            <h2 className="h2">
              “Run this model in <span className="grad-text">India</span> with a specified latency target.”
            </h2>
            <p className="lead">
              Region, residency and latency become routing constraints. The architecture is India-first: the provider landscape has strong
              GPU-cloud operators, and the adapter layer is built to bring them in — subject to commercial and API availability.
            </p>
            <div className="india__chips">
              {INDIA_PROVIDERS.slice(0, 6).map((p) => (
                <span className="chip" key={p.name}>
                  <ShieldCheck aria-hidden /> {p.name}
                </span>
              ))}
              <span className="chip chip--lime">+ more under evaluation</span>
            </div>
            <Link to="/platform" className="link-arrow">
              Explore the provider architecture <ArrowRight aria-hidden />
            </Link>
          </div>
        </Glass>
      </div>
    </section>
  )
}

function PricingTeaser() {
  const rates = GPUS.filter((g) => g.listRange)
  return (
    <section className="section paper pricing-tease">
      <div className="container">
        <div className="sec-head sec-head--center">
          <Reveal>
            <span className="eyebrow">Business model</span>
          </Reveal>
          <Reveal delay={0.06}>
            <h2 className="h2">Platform fee on GPU consumption</h2>
          </Reveal>
          <Reveal delay={0.12}>
            <p className="lead">Transparent by construction: you see what the GPU costs and what Inferxe adds.</p>
          </Reveal>
        </div>

        <Reveal>
          <div className="neo eq">
            <span className="eq__term">
              <small>Customer price</small>
            </span>
            <span className="eq__op">=</span>
            <span className="eq__term eq__term--a">
              <small>Provider cost</small>
              <b>normalized</b>
            </span>
            <span className="eq__op">+</span>
            <span className="eq__term eq__term--b">
              <small>Service fee</small>
              <b>over usage</b>
            </span>
          </div>
        </Reveal>

        <Stagger className="grid grid-3 rates">
          {rates.map((g) => (
            <StaggerItem key={g.id}>
              <div className="neo rate">
                <div className="row row--between">
                  <b className="rate__name">NVIDIA {g.name}</b>
                  <span className="chip chip--sm">{g.vramLabel}</span>
                </div>
                <div className="rate__val">
                  ₹{g.listRange![0]}–{g.listRange![1]}
                  <small>/GPU-hour</small>
                </div>
                <div className="neo-inset rate__track" aria-hidden>
                  <motion.i
                    initial={{ width: 0 }}
                    whileInView={{ width: `${(g.listRange![1] / 320) * 100}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: [0.22, 1, 0.36, 1] }}
                  />
                </div>
                <p>Suggested list rate · {g.role.toLowerCase()}</p>
              </div>
            </StaggerItem>
          ))}
        </Stagger>
        <p className="center rates__note">Planning figures from the project cost model — verified against live provider rate cards, taxes and region before commercial launch.</p>
        <Reveal>
          <div className="center mt-3">
            <LinkButton to="/pricing" arrow>
              Pricing & estimator
            </LinkButton>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export default function Home() {
  usePageMeta('Home', 'Inferxe is a unified control plane between your applications and GPU providers. Describe your workload; we place it by compatibility, cost and measured performance.')
  return (
    <>
      <Hero />
      <ProviderMarquee />
      <Problem />
      <HowItWorks />
      <Studio />
      <Architecture />
      <NvidiaFit />
      <ConsoleSection />
      <Stats />
      <India />
      <PricingTeaser />
      <CtaBand />
    </>
  )
}

