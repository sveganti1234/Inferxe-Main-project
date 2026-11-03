import { CtaBand } from '../components/CtaBand'
import { PageHero } from '../components/PageHero'
import { LinkButton } from '../components/ui/Button'
import { Glass } from '../components/ui/Glass'
import { Stagger, StaggerItem } from '../components/ui/Reveal'
import { SectionHead } from '../components/ui/SectionHead'
import { PERSONAS, USE_CASES } from '../data/content'
import { usePageMeta } from '../lib/hooks'

export default function Solutions() {
  usePageMeta('Solutions', 'Inferxe for developers, enterprises, applications and researchers: GPU selection, managed deployment, LLM inference, cost estimation and lifecycle control.')
  return (
    <>
      <PageHero
        crumb="Solutions"
        eyebrow="Solutions"
        title={['For anyone who needs', 'GPUs to just work.']}
        lead="Developers, enterprises, applications and researchers all start from the same place: a workload and a constraint. Inferxe turns both into a running, costed endpoint."
        image="/images/team.webp"
        focus="center 35%"
        actions={
          <>
            <LinkButton to="/contact" size="lg" arrow>
              Request access
            </LinkButton>
            <LinkButton to="/how-it-works" variant="glass" size="lg">
              See the workflow
            </LinkButton>
          </>
        }
      />

      <section className="section">
        <div className="container">
          <SectionHead eyebrow="Who it is for" title="One platform, four ways in" lead="The same control plane serves people clicking and programs calling." />
          <Stagger className="grid grid-2 personas" stagger={0.08}>
            {PERSONAS.map((p) => (
              <StaggerItem key={p.title}>
                <Glass lift className="persona">
                  <div className="persona__img">
                    <img src={p.img} alt="" loading="lazy" />
                    <div className="persona__shade" aria-hidden />
                    <span className="icon-tile">
                      <p.icon />
                    </span>
                  </div>
                  <div className="persona__body">
                    <div>
                      <span className="engrave">{p.sub}</span>
                      <h3 className="h2 persona__title">{p.title}</h3>
                    </div>
                    <p>{p.body}</p>
                    <ul>
                      {p.points.map((pt) => (
                        <li key={pt}>{pt}</li>
                      ))}
                    </ul>
                  </div>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <section className="section section--tight">
        <div className="container">
          <SectionHead center eyebrow="Use cases" title="What you can do on day one" />
          <Stagger className="grid grid-3" stagger={0.06}>
            {USE_CASES.map((u) => (
              <StaggerItem key={u.title}>
                <Glass lift radius="m" className="pad usecase">
                  <span className="icon-tile icon-tile--sm">
                    <u.icon />
                  </span>
                  <h3 className="h3">{u.title}</h3>
                  <p>{u.body}</p>
                </Glass>
              </StaggerItem>
            ))}
          </Stagger>
        </div>
      </section>

      <CtaBand />
    </>
  )
}
