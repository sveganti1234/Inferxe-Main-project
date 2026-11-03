import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { RoutingDiagram } from '../components/visuals/RoutingDiagram'
import { LinkButton } from '../components/ui/Button'
import { Glass } from '../components/ui/Glass'
import { Reveal } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { PipelineSteps } from '../components/widgets/PipelineSteps'
import { Simulator } from '../components/widgets/Simulator'
import { LIFECYCLE } from '../data/content'
import { usePageMeta } from '../lib/hooks'

export default function HowItWorks() {
  usePageMeta('How it works', 'From workload to running GPU: describe, filter by compatibility, score and select, provision through an adapter, then run, observe and learn.')
  return (
    <>
      <PageHero
        crumb="How it works"
        eyebrow="How it works"
        title={['From workload', 'to running GPU.']}
        lead="Compatibility is deterministic, routing is scored, and providers sit behind adapters. Five stages turn a few requirements into a provisioned, observable inference endpoint."
        image="/images/nodes.webp"
        focus="center 40%"
        actions={
          <>
            <LinkButton href="#simulator" size="lg" arrow>
              Run the simulator
            </LinkButton>
            <LinkButton to="/platform" variant="glass" size="lg">
              Platform overview
            </LinkButton>
          </>
        }
        aside={
          <Glass className="pad" variant="deep">
            <RoutingDiagram />
          </Glass>
        }
      />

      <section className="section">
        <div className="container">
          <SectionHead
            center
            eyebrow="Five stages"
            title="Describe. Filter. Score. Provision. Learn."
            lead="Each stage has one job — and a defined contract with the next."
          />
          <Reveal>
            <Glass className="pad-l">
              <PipelineSteps />
            </Glass>
          </Reveal>
        </div>
      </section>

      <section className="section" id="simulator">
        <div className="container">
          <SectionHead
            center
            eyebrow="Interactive"
            title={
              <>
                Watch a placement <span className="grad-text">decision trace</span>.
              </>
            }
            lead="Pick a workload and run it through the pipeline. Try “Too large” to see how a request that cannot fit is rejected cleanly — with no orphaned resources."
          />
          <Reveal>
            <Simulator />
          </Reveal>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <SectionHead
            center
            eyebrow="Deployment lifecycle"
            title="Explicit states. No orphaned GPUs."
            lead="Every deployment is always in a known state, so retries never duplicate provisioning and failures never leave a resource running unseen."
          />
          <Reveal>
            <Glass className="pad-l">
              <ol className="life">
                {LIFECYCLE.map((s, i) => (
                  <li key={s} style={{ ['--i' as string]: i }}>
                    <span className={`life__state ${s === 'Running' ? 'is-run' : ''}`}>
                      {s}
                    </span>
                    {i < LIFECYCLE.length - 1 && <span className="life__link" aria-hidden />}
                  </li>
                ))}
              </ol>
              <div className="life__fail">
                <span className="chip chip--amber">
                  Failed → cleanup → Terminated
                </span>
                <span className="dim">Provider errors, timeouts and partial deployments transition to a failed state, release resources and return a controlled error.</span>
              </div>
              <p className="dim life__cap">Simplified state machine, for illustration.</p>
            </Glass>
          </Reveal>
        </div>
      </section>

      <CtaBand />
    </>
  )
}

