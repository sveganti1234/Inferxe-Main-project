import { Info } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Glass } from '../components/ui/Glass'
import { Reveal } from '../components/ui/Reveal'
import { SITE } from '../data/site'
import { usePageMeta } from '../lib/hooks'

type Kind = 'privacy' | 'terms'

const DOCS: Record<Kind, { title: string; lead: string; sections: { h: string; p: string[] }[] }> = {
  privacy: {
    title: 'Privacy',
    lead: 'How Inferxe approaches personal data on this website and in the platform it describes.',
    sections: [
      {
        h: 'This website',
        p: [
          'If you submit the contact form we receive the details you enter — name, email, company, role, your area of interest and any message. We use them only to respond to your enquiry and to decide who should follow up.',
          'This site is a static front end. It does not set advertising cookies or embed third-party trackers.',
        ],
      },
      {
        h: 'The platform',
        p: [
          'Inferxe is designed to store the minimum necessary user-query information. Retention and logging rules for prompts and responses are defined up front, and unnecessary prompt or response storage is avoided.',
          'Data is encrypted and access-controlled. Deletion rules are defined so that data is not retained longer than its purpose requires.',
          'Provider credentials and deployment secrets are held in managed secret storage — never in source code — and every provisioning and lifecycle action is recorded in an audit trail.',
        ],
      },
      {
        h: 'Residency & providers',
        p: [
          'Workloads run on GPU capacity supplied by third-party providers (JarvisLabs in the MVP). Region-aware controls and a compliance assessment are part of the roadmap; provider terms and locations apply to the compute they supply.',
        ],
      },
      {
        h: 'Your choices',
        p: ['You can ask us what we hold about you, to correct it, or to delete it by contacting us through the contact page.'],
      },
    ],
  },
  terms: {
    title: 'Terms',
    lead: 'The ground rules for using this website and the early-access programme.',
    sections: [
      {
        h: 'Early access',
        p: [
          'Inferxe is an MVP in active development. Features, availability, supported models and providers may change, and early access is provided without service-level commitments unless agreed in writing.',
        ],
      },
      {
        h: 'Estimates and pricing',
        p: [
          'Rates, ranges and cost estimates shown on this site are planning figures, not a contractual rate card or an offer. Actual pricing depends on live provider rates, taxes, region, discounts and availability, and is confirmed before any commercial commitment.',
          'Performance indicators such as “decode ceiling” are theoretical upper bounds, not benchmarks or guarantees.',
        ],
      },
      {
        h: 'Third-party providers',
        p: ['GPU capacity is supplied by third-party providers. Their terms, availability and acceptable-use policies apply to the resources they provide.'],
      },
      {
        h: 'Acceptable use',
        p: ['You agree not to abuse the platform, attempt to bypass rate limits or authentication, or use deployments for unlawful purposes. We may suspend access to protect the platform, other customers or GPU spend.'],
      },
      {
        h: 'Third-party names',
        p: ['Product and company names are used for identification only and remain the property of their owners. Their appearance on this site does not imply affiliation or endorsement.'],
      },
    ],
  },
}

export default function Legal({ kind }: { kind: Kind }) {
  const d = DOCS[kind]
  usePageMeta(d.title, d.lead)
  return (
    <section className="section legal">
      <div className="container legal__wrap">
        <Reveal>
          <span className="eyebrow">Legal</span>
          <h1 className="h1 legal__title">{d.title}</h1>
          <p className="lead">{d.lead}</p>
          <p className="chip chip--amber legal__draft">
            <Info aria-hidden /> Draft for review · last updated {SITE.updated}. This page is not legal advice and will be finalised with counsel before launch.
          </p>
        </Reveal>
        <div className="legal__body">
          {d.sections.map((s, i) => (
            <Reveal key={s.h} delay={i * 0.04}>
              <Glass radius="m" className="pad-l legal__sec">
                <h2 className="h3">{s.h}</h2>
                {s.p.map((t) => (
                  <p key={t}>{t}</p>
                ))}
              </Glass>
            </Reveal>
          ))}
        </div>
        <p className="dim legal__foot">
          Questions? <Link to="/contact">Contact us</Link> · See also <Link to={kind === 'privacy' ? '/terms' : '/privacy'}>{kind === 'privacy' ? 'Terms' : 'Privacy'}</Link> and our{' '}
          <Link to="/security">security & trust</Link> overview.
        </p>
      </div>
    </section>
  )
}
