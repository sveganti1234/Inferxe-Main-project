import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import { DOCS, GROUPS, toCurl, toPython, toTs } from '../../data/api'
import { ENDPOINTS } from '../../data/content'
import { CodeBlock } from '../ui/CodeBlock'

/** Endpoint browser with generated cURL / Python / TypeScript samples. */
export function ApiExplorer() {
  const [id, setId] = useState('recommend')
  const e = ENDPOINTS.find((x) => x.id === id)!
  const d = DOCS[id]
  const resText = typeof d.res === 'string' ? d.res : JSON.stringify(d.res, null, 2)
  const resLang = typeof d.res === 'string' ? 'bash' : 'json'

  return (
    <div className="api glass glass--deep">
      <nav className="api__nav" aria-label="API endpoints">
        {GROUPS.map((g) => (
          <div key={g.group} className="api__group">
            <span className="engrave">{g.group}</span>
            {g.items.map((it) => (
              <button key={it.id} className={`api__item ${it.id === id ? 'is-on' : ''}`} onClick={() => setId(it.id)} aria-current={it.id === id}>
                <span className={`method method--${it.method.toLowerCase()}`}>{it.method}</span>
                <code>{it.path.replace('/api', '')}</code>
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="api__main">
        <AnimatePresence mode="wait">
          <motion.div key={id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="api__panel">
            <div className="api__head">
              <span className={`method method--${e.method.toLowerCase()}`}>{e.method}</span>
              <code className="api__path">{e.path}</code>
            </div>
            <p className="api__sum">{e.summary}</p>

            <CodeBlock
              title="Request"
              tabs={[
                { label: 'cURL', lang: 'bash', code: toCurl(e, d) },
                { label: 'Python', lang: 'python', code: toPython(e, d) },
                { label: 'TypeScript', lang: 'ts', code: toTs(e, d) },
              ]}
            />
            <div className="api__res">
              <div className="row" style={{ gap: 10 }}>
                <span className="engrave">Response</span>
                <span className="chip chip--lime chip--sm">
                  {d.status}
                </span>
              </div>
              <CodeBlock title="application/json" tabs={[{ label: 'JSON', lang: resLang, code: resText }]} />
            </div>
          </motion.div>
        </AnimatePresence>
        <p className="api__foot">Illustrative contract derived from the platform design; the OpenAPI specification is the source of truth. Placeholders in angle brackets are filled at runtime.</p>
      </div>
    </div>
  )
}
