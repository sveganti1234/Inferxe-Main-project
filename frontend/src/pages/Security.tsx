import { CheckCircle2, Info } from 'lucide-react'
import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { Glass } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { RiskMatrix } from '../components/widgets/RiskMatrix'
import { PRIVACY_POINTS, SECURITY_CONTROLS } from '../data/content'
import { usePageMeta } from '../lib/hooks'

export default function Security() {
  usePageMeta('Security & trust', 'Security, privacy and reliability by design: managed secrets, Cognito with TOTP, private inference endpoints, audit trails and a scored risk framework.')
  return (
    <>
      <PageHero
        crumb="Security & trust"
        eyebrow="Security & trust"
        title={['Trust is designed in,', 'not bolted on.']}
        lead="Customer prompts, responses, credentials and usage data pass through the control plane. Every layer is built around least privilege, controlled exposure and traceability."
        image="/images/security.webp"
        focus="center 45%"
        actions={
          <>
            <LinkButton href="#risk" size="lg" arrow>
              Explore the risk framework
            </LinkButton>
            <LinkButton to="/contact" variant="glass" size="lg">
              Security questions
            </LinkButton>
          </>
        }
      />

      <section className="section">
        <div className="container">
          <SectionHead
            eyebrow="Controls"
            title={
              <>
                Six layers of <span className="grad-text">protection</span>.
              </>
            }
            lead="From secrets to audit trails, each control exists to keep credentials, prompts and GPU spend safe."
          />
          <Stagger className="grid grid-3 sec-grid" stagger={0.06}>
            {SECURITY_CONTROLS.map((c) => (
              <StaggerItem key={c.title}>
                <Glass lift radius="m" className="pad sec-card">
                  <span className="icon-tile">
                    <c.icon />
                  </span>
                  <h3 className="h3">{c.title}</h3>
                  <p>{c.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="section privacy">
        <img className="privacy__bg" src="/images/matrix.webp" alt="" loading="lazy" />
        <div className="privacy__shade" aria-hidden />
        <div className="container split">
          <div>
            <SectionHead
              eyebrow="Privacy & data"
              title={
                <>
                  Store the <span className="grad-text">minimum</span>. Protect all of it.
                </>
              }
              lead="Prompts and responses are sensitive by default. Retention is a decision, not an accident."
            />
            <Stagger className="duties" stagger={0.07}>
              {PRIVACY_POINTS.map((p) => (
                <StaggerItem key={p}>
                  <div className="duty">
                    <CheckCircle2 aria-hidden />
                    <span>{p}</span>
                  </div>
                </StaggerItem>
              ))}
            </Stagger>
          </div>
          <Reveal x={30}>
            <Glass className="pad-l" variant="lime">
              <span className="eyebrow">Where we are</span>
              <p className="privacy__claim">
                <Info aria-hidden /> Inferxe is in MVP build. Region-aware controls and a compliance assessment are on the roadmap; no third-party certification is claimed at this stage.
              </p>
              <p className="muted">We would rather tell you what is designed and what is verified than imply assurance we have not yet earned.</p>
            </Glass>
          </Reveal>
        </div>
      </section>

      <section className="section" id="risk">
        <div className="container">
          <SectionHead
            center
            eyebrow="Risk framework"
            title={
              <>
                Fifteen risks, <span className="grad-text">scored and owned</span>.
              </>
            }
            lead="Every identified risk has a likelihood, an impact, a mitigation and an owner. Select a cell to see what sits there."
          />
          <Reveal>
            <RiskMatrix />
          </Reveal>
        </div>
      </section>

      <CtaBand title="Questions about security or data handling?" lead="Ask us anything about architecture, data flows or controls — we will answer plainly, including what is not built yet." image="/images/security.webp" />
    </>
  )
}
