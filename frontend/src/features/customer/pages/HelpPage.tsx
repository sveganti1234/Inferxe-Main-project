/**
 * FAQ & Support Hub — Technical architecture, pricing guarantees, hardware specifications,
 * and API documentation (media_1795423533113_1846b33d.jpg & media_1795423562624_760cb130.jpg).
 */
import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  LifeBuoy,
  MessageCircle,
  Search,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { FAQ, filterFaq, type FaqEntry } from '../data/help'
import { CONSOLE_BASE, CONSOLE_SECTIONS, getSection, sectionHref, type SectionId } from '../navigation'
import { openAssistant } from '../shell/assistant'
import { Button, ButtonLink } from '../ui/primitives'
import { EmptyState } from '../ui/states'

const hrefFor = (to: string) =>
  to.startsWith('/')
    ? to
    : sectionHref(
        getSection(
          (CONSOLE_SECTIONS.find((s) => s.id === to)?.id ?? 'overview') as SectionId,
        ),
      )

const CATEGORY_TABS = ['All Categories', 'Hardware', 'Billing', 'Deployments', 'APIs'] as const

function FaqCardItem({
  entry,
  open,
  onToggle,
}: {
  entry: FaqEntry
  open: boolean
  onToggle: () => void
}) {
  const panelId = useId()
  return (
    <div className={`cx-faq-card${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="cx-faq-question-btn cx-faq__btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
      >
        <span className="cx-faq-question-text">{entry.question}</span>
        <span className="cx-faq-chevron">
          {open ? (
            <ChevronDown size={18} aria-hidden="true" className="cx-faq-chev--open" />
          ) : (
            <ChevronRight size={18} aria-hidden="true" className="cx-faq-chev--closed" />
          )}
        </span>
      </button>
      <div
        id={panelId}
        role="region"
        aria-label={entry.question}
        hidden={!open}
        className="cx-faq-answer cx-faq__a"
      >
        <p className="cx-faq-answer-text">{entry.answer}</p>
        {entry.links?.length ? (
          <div className="cx-faq-links cx-faq__links">
            {entry.links.map((l) => (
              <Link key={l.to + l.label} to={hrefFor(l.to)} className="cx-faq-link">
                {l.label} &rarr;
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function HelpPage() {
  const section = getSection('help')
  usePageMeta('FAQ & Support Hub · Inferxe', section.description)

  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('All Categories')
  // Default to first item expanded as seen in reference screenshot
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(['sovereign-gpu']))

  const categoryFilter = selectedCategory === 'All Categories' ? 'all' : selectedCategory
  const entries = filterFaq(FAQ, { query, category: categoryFilter })

  const toggle = (id: string) =>
    setOpenIds((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const searching = query.trim().length > 0

  return (
    <div className="cx-faq-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">FAQ &amp; Support Hub</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>FAQ &amp; Support Hub</h1>
          <p className="cx-page-header__desc">
            Frequently asked questions, architecture guidelines, and support.
          </p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to={CONSOLE_BASE} variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-faq-toolbar">
        <div>
          <h2>Frequently Asked Questions &amp; Support Hub</h2>
          <p>
            Technical architecture, pricing guarantees, hardware specifications, and API documentation.
          </p>
        </div>
        <div className="cx-faq-toolbar-actions">
          <a
            href="https://platform.openai.com/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="cx-btn cx-btn--primary cx-btn--sm cx-faq-doc-btn"
          >
            <FileText size={15} /> OpenAI SDK Docs
          </a>
        </div>
      </div>

      {/* ── Search & Category Filter Bar ── */}
      <div className="cx-faq-filter-bar">
        <div className="cx-faq-searchbox">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search FAQ keywords..."
            aria-label="Search the FAQ"
            className="cx-faq-search-input"
            autoComplete="off"
          />
        </div>

        <div className="cx-faq-categories" role="tablist" aria-label="FAQ Categories">
          {CATEGORY_TABS.map((cat) => {
            const isActive = selectedCategory === cat
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`cx-faq-cat-pill${isActive ? ' is-active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── Accordion FAQ Cards ── */}
      <div className="cx-faq-list" aria-label={`${entries.length} question${entries.length === 1 ? '' : 's'}`}>
        {entries.length === 0 ? (
          <div className="cx-faq-empty-card">
            <EmptyState
              icon={<LifeBuoy size={24} />}
              title="No answers match your search"
              body="Try different keywords, or ask the AI assistant."
              actions={
                <>
                  <Button variant="primary" onClick={openAssistant}>
                    <MessageCircle size={15} /> Ask the assistant
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQuery('')
                      setSelectedCategory('All Categories')
                    }}
                  >
                    Clear search
                  </Button>
                </>
              }
            />
          </div>
        ) : (
          entries.map((e) => (
            <FaqCardItem
              key={e.id}
              entry={e}
              open={searching || openIds.has(e.id)}
              onToggle={() => toggle(e.id)}
            />
          ))
        )}
      </div>

      {/* ── Interactive Chatbot Support Bar ── */}
      <div className="cx-faq-assistant-card">
        <div className="cx-faq-assistant-info">
          <div className="cx-faq-assistant-icon">
            <Bot size={22} />
          </div>
          <div>
            <h3>Need instant answers? Ask our AI Chatbot</h3>
            <p>
              Get immediate assistance with GPU sizing, CUDA container configurations, and endpoint integration.
            </p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={openAssistant} className="cx-faq-open-bot-btn">
          <MessageCircle size={15} /> Open the assistant
        </Button>
      </div>
    </div>
  )
}
