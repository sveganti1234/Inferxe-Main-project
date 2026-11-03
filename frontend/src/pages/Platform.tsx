import { CheckCircle2 } from 'lucide-react'
import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { CodeBlock } from '../components/ui/CodeBlock'
import { Glass } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { AdapterContract } from '../components/widgets/AdapterContract'
import { ConsolePreview } from '../components/widgets/ConsolePreview'
import { ADAPTER_DUTIES, CAPABILITIES, CRITERIA, PRICING_MODELS, VLLM_POINTS } from '../data/content'
import { usePageMeta } from '../lib/hooks'

const WIDE = new Set(['Requirement collector', 'Inference gateway', 'Monitoring'])
const TALL = new Set(['Deployment manager'])

const CHIPS: Record<string, string[]> = {
  'Requirement collector': ['Model', 'VRAM', 'Context', 'Concurrency', 'Latency', 'Budget', 'Region', 'Policy'],
  'Inference gateway': ['Authentication', 'Validation', 'Rate limits', 'Streaming'],
  Monitoring: ['Prometheus', 'Grafana', 'Health checks', 'Alerts'],
}

const WEIGHT_LEVEL = { Mandatory: 3, High: 2, Medium: 1 } as const

export default function Platform() {
  usePageMeta('Platform', 'The Inferxe control plane: requirement capture, deterministic compatibility, scored routing, provider adapters, managed vLLM serving, cost tracking and monitoring.')
  return (
    <>
      <PageHero
        crumb="Platform"
        eyebrow="Platform"
        title={['The control plane', 'for GPU compute.']}
        lead="A unified layer between your applications and GPU providers: capture the workload, filter by hard constraints, score what is left, provision through an adapter — and keep learning from every run."
        image="/images/circuit-glass.webp"
        focus="center 40%"
        actions={
          <>
            <LinkButton to="/contact" size="lg" arrow>
              Request access
            </LinkButton>
            <LinkButton to="/how-it-works" variant="glass" size="lg">
              How it works
            </LinkButton>
          </>
        }
        aside={<AdapterContract />}
      />

      {/* Capabilities */}
      <section className="section">
        <div className="container">
          <SectionHead
            eyebrow="Core components"
            title={
              <>
                Everything between a workload and a <span className="grad-text">running GPU</span>.
              </>
            }
            lead="Eight cooperating components turn a handful of requirements into a provisioned, monitored, costed inference endpoint."
          />
          <Stagger className="bento" stagger={0.07}>
            {CAPABILITIES.map((c) => (
              <StaggerItem key={c.title} className={`bento__cell ${WIDE.has(c.title) ? 'bento__cell--wide' : ''} ${TALL.has(c.title) ? 'bento__cell--tall' : ''}`}>
                <Glass lift className="pad bento__card">
                  <span className="icon-tile">
                    <c.icon />
                  </span>
                  <h3 className="h3">{c.title}</h3>
                  <p>{c.body}</p>
                  {CHIPS[c.title] && (
                    <div className="bento__chips">
                      {CHIPS[c.title].map((x) => (
                        <span className="chip chip--sm" key={x}>
                          {x}
                        </span>
                      ))}
                    </div>
                  )}
                  {TALL.has(c.title) && (
                    <ul className="bento__states" aria-label="Lifecycle states">
                      {['Requested', 'Provisioning', 'Deploying', 'Running', 'Stopping', 'Terminated'].map((s) => (
                        <li key={s}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  )}
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* Routing */}
      <section className="section routing-sec">
        <div className="container split split--wide-right split--top">
          <div className="sticky-card">
            <SectionHead
              eyebrow="Routing"
              title={
                <>
                  Compatibility is <span className="grad-text">deterministic</span>. Routing is <span className="grad-text">scored</span>.
                </>
              }
              lead="Hard constraints — memory fit, security and compliance — are never traded off. Everything else is weighed: performance, cost, latency, availability, reliability and integration quality."
            />
            <Reveal>
              <div className="legend">
                <span className="legend__item">
                  <i className="meter meter--3" /> Mandatory
                </span>
                <span className="legend__item">
                  <i className="meter meter--2" /> High
                </span>
                <span className="legend__item">
                  <i className="meter meter--1" /> Medium
                </span>
              </div>
            </Reveal>
          </div>
          <Stagger className="criteria" stagger={0.05}>
            {CRITERIA.map((c) => (
              <StaggerItem key={c.name}>
                <div className="criterion glass glass--m">
                  <div className="criterion__main">
                    <b>{c.name}</b>
                    <span>{c.body}</span>
                  </div>
                  <div className="criterion__meter" aria-label={c.weight}>
                    <span className="readout-label">{c.weight}</span>
                    <i className={`meter meter--${WEIGHT_LEVEL[c.weight]}`} />
                  </div>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      {/* vLLM */}
      <section className="section vllm">
        <div className="container">
          <div className="split split--wide-left">
            <div>
              <SectionHead
                eyebrow="Managed inference"
                title={
                  <>
                    Docker + vLLM, <span className="grad-text">provisioned for you</span>.
                  </>
                }
                lead="Once a GPU is placed, Inferxe prepares the serving environment, loads a supported open model and exposes an OpenAI-compatible endpoint — no manual installs, no Dockerfile archaeology."
              />
              <Stagger className="grid grid-2 vllm__pts">
                {VLLM_POINTS.map((p) => (
                  <StaggerItem key={p.title}>
                    <div className="vllm__pt">
                      <span className="icon-tile icon-tile--sm">
                        <p.icon />
                      </span>
                      <h3 className="h3">{p.title}</h3>
                      <p>{p.body}</p>
                    </div>
                  </StaggerItem>
                ))}
              </Stagger>
            </div>
            <Reveal x={30}>
              <div className="stack" style={{ ['--stack' as string]: '16px' }}>
                <div className="row row--wrap" style={{ gap: 10 }}>
                  <span className="chip chip--lime">Qwen</span>
                  <span className="chip chip--lime">Llama</span>
                  <span className="chip chip--lime">Mistral</span>
                  <span className="chip">subject to hardware compatibility</span>
                </div>
                <CodeBlock
                  title="what Inferxe automates"
                  tabs={[
                    {
                      label: 'docker',
                      lang: 'bash',
                      code: `# Provision the GPU, then start the serving container
docker run --runtime nvidia --gpus all \\
  -p 8000:8000 --ipc=host \\
  vllm/vllm-openai:latest \\
  --model Qwen/Qwen2.5-7B-Instruct \\
  --max-model-len 8192

# OpenAI-compatible endpoint is now live
# POST /v1/chat/completions`,
                    },
                  ]}
                />
                <p className="dim vllm__note">The backend is the only caller of the model endpoint — vLLM is never exposed as a public, unauthenticated service.</p>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* Provider abstraction */}
      <section className="section">
        <div className="container split">
          <div>
            <SectionHead
              eyebrow="Provider abstraction"
              title={
                <>
                  Adding a provider means adding an <span className="grad-text">adapter</span>.
                </>
              }
              lead="Provider-specific code stays behind one contract, so the public API, console and customer workflows never change when supply does."
            />
            <Stagger className="duties" stagger={0.06}>
              {ADAPTER_DUTIES.map((d) => (
                <StaggerItem key={d}>
                  <div className="duty">
                    <CheckCircle2 aria-hidden />
                    <span>{d}</span>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <Reveal x={30}>
            <Glass className="pad-l" variant="deep">
              <img className="adapter-img" src="/images/patch-panel.webp" alt="Network patch panel representing many provider connections" loading="lazy" />
              <div className="mt-3 row row--wrap" style={{ gap: 10 }}>
                <span className="chip chip--lime">
                  Live in MVP: JarvisLabs
                </span>
                <span className="chip">Mock adapter</span>
                <span className="chip">Contract tests</span>
                <span className="chip chip--amber">Phase 2: more providers</span>
              </div>
            </Glass>
          </Reveal>
        </div>
      </section>

      {/* Console */}
      <section className="section console-sec">
        <div className="container">
          <SectionHead
            center
            eyebrow="Console + API"
            title="One control plane, two front doors"
            lead="The web console and the OpenAPI-first developer API drive the same engine — cost views, monitoring, audit events and rate limits included."
          />
          <Reveal>
            <ConsolePreview />
          </Reveal>
        </div>
      </section>

      {/* Cost */}
      <section className="section paper cost-sec">
        <div className="container">
          <div className="sec-head sec-head--center">
            <Reveal>
              <span className="eyebrow">Cost visibility</span>
            </Reveal>
            <Reveal delay={0.06}>
              <h2 className="h2">Every price normalized into one comparable metric.</h2>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="lead">Providers bill in tokens, GPU-hours, requests or reserved blocks. Inferxe stores each with its scope and validity so routing can compare like with like.</p>
            </Reveal>
          </div>
          <Stagger className="grid grid-3 pm">
            {PRICING_MODELS.map((m) => (
              <StaggerItem key={m.title}>
                <div className="neo pad pm__card">
                  <b>{m.title}</b>
                  <p>{m.basis}</p>
                  <span className="chip chip--sm">{m.unit}</span>
                </div>
              </StaggerItem>
            ))}
          </Stagger>
          <Reveal>
            <div className="neo pad-l formula">
              <div>
                <span className="eyebrow eyebrow--plain">Estimated infrastructure cost</span>
                <p className="formula__eq">
                  Estimated GPU runtime <span>×</span> applicable GPU rate <span>+</span> storage / network / platform charges
                </p>
              </div>
              <div>
                <span className="eyebrow eyebrow--plain">Effective cost per 1M tokens</span>
                <p className="formula__eq">
                  Total execution cost <span>÷</span> tokens processed <span>×</span> 1,000,000
                </p>
              </div>
            </div>
          </Reveal>
          <Reveal>
            <div className="center mt-3">
              <LinkButton to="/pricing#estimator" arrow>
                Try the cost estimator
              </LinkButton>
            </div>
          </Reveal>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
