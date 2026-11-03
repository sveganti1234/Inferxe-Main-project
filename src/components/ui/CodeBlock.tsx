import { useState, type ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { useCopy } from '../../lib/hooks'

export type Lang = 'bash' | 'python' | 'ts' | 'json'

const KW = {
  bash: /\b(curl|export|echo)\b/,
  python: /\b(import|from|as|def|return|print|True|False|None|with|for|in)\b/,
  ts: /\b(import|from|const|let|await|async|return|function|new|true|false|null|export|type)\b/,
  json: /\b(true|false|null)\b/,
}

/** Tiny, dependency-free highlighter — good enough for short API snippets. */
export function highlight(code: string, lang: Lang): ReactNode[] {
  const comment = lang === 'bash' || lang === 'python' ? '#.*$' : lang === 'ts' ? '\\/\\/.*$' : '(?!)'
  const re = new RegExp(
    `(${comment})|("(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*')|(\\b\\d+(?:\\.\\d+)?\\b)|(${KW[lang].source})|(\\s--?[A-Za-z][\\w-]*)`,
    'gm',
  )
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = re.exec(code))) {
    if (m.index > last) out.push(code.slice(last, m.index))
    const [txt] = m
    if (m[1]) out.push(<span key={k++} className="tok-c">{txt}</span>)
    else if (m[2]) {
      const isKey = /^\s*:/.test(code.slice(re.lastIndex))
      out.push(<span key={k++} className={isKey ? 'tok-n' : 'tok-s'}>{txt}</span>)
    } else if (m[3]) out.push(<span key={k++} className="tok-p">{txt}</span>)
    else if (m[4]) out.push(<span key={k++} className="tok-k">{txt}</span>)
    else if (m[5]) out.push(<span key={k++} className="tok-f">{txt}</span>)
    else out.push(txt)
    last = m.index + txt.length
    if (txt.length === 0) re.lastIndex++
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

export interface CodeTab {
  label: string
  lang: Lang
  code: string
}

export function CodeBlock({ title, tabs, className = '' }: { title?: string; tabs: CodeTab[]; className?: string }) {
  const [i, setI] = useState(0)
  const { copied, copy } = useCopy()
  const tab = tabs[Math.min(i, tabs.length - 1)]
  return (
    <div className={`code ${className}`}>
      <div className="code__bar">
        <span className="code__dots" aria-hidden>
          <i />
          <i />
          <i />
        </span>
        {title && <span className="code__title">{title}</span>}
        {tabs.length > 1 && (
          <div className="code__tabs" role="tablist">
            {tabs.map((t, idx) => (
              <button key={t.label} role="tab" aria-selected={idx === i} className={idx === i ? 'is-on' : ''} onClick={() => setI(idx)}>
                {t.label}
              </button>
            ))}
          </div>
        )}
        <button className="code__copy" style={tabs.length > 1 ? undefined : { marginLeft: 'auto' }} onClick={() => copy(tab.code)} aria-label="Copy code">
          {copied ? <Check /> : <Copy />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre>
        <code>{highlight(tab.code, tab.lang)}</code>
      </pre>
    </div>
  )
}
