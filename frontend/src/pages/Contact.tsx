import { Globe2, Mail, Plug, Sparkles } from 'lucide-react'
import { PageHero } from '../components/PageHero'
import { Glass } from '../components/ui/Glass'
import { Reveal, Stagger, StaggerItem } from '../components/ui/Reveal'
import { ContactForm } from '../components/widgets/ContactForm'
import { SITE } from '../data/site'
import { usePageMeta } from '../lib/hooks'

const NEXT = [
  { t: 'We read it', d: 'A real person reviews every request — no auto-responder maze.' },
  { t: 'We size a workload', d: 'We map your model, context and budget to GPU classes and a cost range.' },
  { t: 'You get access', d: 'Early-access cohorts get an API key, console access and a direct line to the team.' },
]

export default function Contact() {
  usePageMeta('Contact & access', 'Request access to Inferxe, ask about API access, enterprise deployments, benchmarking or becoming a GPU provider partner.')
  return (
    <>
      <PageHero
        crumb="Contact"
        eyebrow="Request access"
        title={['Tell us what', 'you need to run.']}
        lead="Share a workload, a constraint or a question. Access requests are reviewed by the team and answered with a sized recommendation — not a sales script."
        image="/images/laptop-dark.webp"
        focus="center 50%"
      />

      <section className="section">
        <div className="container contact">
          <Reveal>
            <ContactForm />
          </Reveal>

          <Stagger className="contact__side" stagger={0.1}>
            <StaggerItem>
              <Glass className="pad-l" radius="m">
                <span className="eyebrow">What happens next</span>
                <ol className="next">
                  {NEXT.map((n, i) => (
                    <li key={n.t}>
                      <span className="next__n">{i + 1}</span>
                      <div>
                        <b>{n.t}</b>
                        <p>{n.d}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Glass>
            </StaggerItem>

            <StaggerItem>
              <Glass className="pad-l" radius="m" variant="lime">
                <div className="row" style={{ gap: 12 }}>
                  <span className="icon-tile icon-tile--sm">
                    <Plug />
                  </span>
                  <h3 className="h3">Run GPU capacity?</h3>
                </div>
                <p className="muted mt-2">
                  Adding a provider means adding an adapter — one contract for catalogue, capacity, lifecycle and errors. If you operate GPU infrastructure and want to be routable, choose “Provider
                  partnership”.
                </p>
              </Glass>
            </StaggerItem>

            <StaggerItem>
              <Glass className="pad-l contact__facts" radius="m">
                <ul>
                  <li>
                    <Globe2 aria-hidden />
                    <a href={SITE.url}>{SITE.domain}</a>
                  </li>
                  {SITE.contactEmail && (
                    <li>
                      <Mail aria-hidden />
                      <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
                    </li>
                  )}
                  <li>
                    <Sparkles aria-hidden />
                    <span>
                      {SITE.name}, a product of {SITE.parent} · {SITE.stage}
                    </span>
                  </li>
                </ul>
              </Glass>
            </StaggerItem>
          </Stagger>
        </div>
      </section>
    </>
  )
}
