/**
 * Help — an FAQ grounded in what exists today, plus a way to open the existing assistant.
 * The FAQ lives in `data/help.ts`; the assistant is the site's existing one (opened by event).
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, ChevronDown, LifeBuoy, Mail, MessageCircle, Search } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { FAQ, FAQ_CATEGORIES, filterFaq, type FaqCategory, type FaqEntry } from '../data/help'
import { CONSOLE_SECTIONS, getSection, sectionHref, type SectionId } from '../navigation'
import { openAssistant } from '../shell/assistant'
import { Segmented, TextInput } from '../ui/controls'
import { Button, Card, CardHeader, PageHeader } from '../ui/primitives'
import { EmptyState } from '../ui/states'

const hrefFor = (to: string) => (to.startsWith('/') ? to : sectionHref(getSection((CONSOLE_SECTIONS.find((s) => s.id === to)?.id ?? 'overview') as SectionId)))

function FaqItem({ entry, open, onToggle }: { entry: FaqEntry; open: boolean; onToggle: () => void }) {
  const panelId = useId()
  return (
    <li className={`cx-faq__item${open ? ' is-open' : ''}`}>
      <h3 className="cx-faq__q">
        <button type="button" className="cx-faq__btn" aria-expanded={open} aria-controls={panelId} onClick={onToggle}>
          <span>{entry.question}</span>
          <ChevronDown size={18} aria-hidden="true" className="cx-faq__chev" />
        </button>
      </h3>
      <div id={panelId} role="region" aria-label={entry.question} hidden={!open} className="cx-faq__a">
        <p>{entry.answer}</p>
        {entry.links?.length ? (
          <p className="cx-faq__links">
            {entry.links.map((l) => (
              <Link key={l.to + l.label} to={hrefFor(l.to)}>{l.label}</Link>
            ))}
          </p>
        ) : null}
      </div>
    </li>
  )
}

export default function HelpPage() {
  const section = getSection('help')
  usePageMeta(section.label, section.description)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<FaqCategory | 'all'>('all')
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set([FAQ[0].id]))

  const entries = filterFaq(FAQ, { query, category })
  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const searching = query.trim().length > 0

  return (
    <>
      <PageHeader
        title="Help"
        description="Answers about what the console does today — including what is not available yet."
      />

      <div className="cx-help">
        <div className="cx-stack">
          <div className="cx-filterbar cx-filterbar--tight">
            <div className="cx-searchbox">
              <Search size={16} aria-hidden="true" />
              <TextInput type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the FAQ" aria-label="Search the FAQ" autoComplete="off" />
            </div>
          </div>
          <div className="cx-chipscroll">
            <Segmented<FaqCategory | 'all'>
              label="Filter by topic"
              value={category}
              onChange={setCategory}
              options={[{ value: 'all', label: 'All' }, ...FAQ_CATEGORIES.map((c) => ({ value: c, label: c }))]}
            />
          </div>

          <Card flush aria-label="Frequently asked questions">
            {entries.length === 0 ? (
              <EmptyState
                icon={<LifeBuoy size={24} />}
                title="No answers match your search"
                body="Try different words, or ask the assistant."
                actions={
                  <>
                    <Button variant="primary" onClick={openAssistant}><MessageCircle size={15} /> Ask the assistant</Button>
                    <Button variant="secondary" onClick={() => { setQuery(''); setCategory('all') }}>Clear search</Button>
                  </>
                }
              />
            ) : (
              <ul className="cx-faq" aria-label={`${entries.length} question${entries.length === 1 ? '' : 's'}`}>
                {entries.map((e) => (
                  <FaqItem key={e.id} entry={e} open={searching || openIds.has(e.id)} onToggle={() => toggle(e.id)} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="cx-stack" aria-label="More help">
          <Card>
            <CardHeader title="Ask the assistant" description="The Inferxe assistant used across the site." />
            <p className="cx-prose">
              Ask a question in your own words. Its answers are generated and can be incomplete, so check anything
              important against the answers here or the documentation.
            </p>
            <div className="cx-form__actions cx-form__actions--start">
              <Button variant="primary" onClick={openAssistant}><MessageCircle size={15} /> Open the assistant</Button>
            </div>
          </Card>
          <Card>
            <CardHeader title="More resources" />
            <ul className="cx-resources">
              <li>
                <Link to="/developers"><BookOpen size={16} aria-hidden="true" /> Developer documentation</Link>
                <span className="cx-muted cx-small">API reference and guides</span>
              </li>
              <li>
                <Link to="/contact"><Mail size={16} aria-hidden="true" /> Contact Inferxe</Link>
                <span className="cx-muted cx-small">Reach the team directly</span>
              </li>
            </ul>
          </Card>
        </aside>
      </div>
    </>
  )
}
