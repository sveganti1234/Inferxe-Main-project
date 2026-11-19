/**
 * Form and data-display controls for the Inferxe console.
 */
import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Check, Copy } from 'lucide-react'

/* ── Field ── */
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: ReactNode
  hint?: ReactNode
  error?: string | null
  children: (ids: { inputId: string; describedBy: string | undefined; invalid: boolean }) => ReactNode
}) {
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined
  return (
    <div className="cx-field">
      <label className="cx-field__label" htmlFor={inputId}>{label}</label>
      {children({ inputId, describedBy, invalid: Boolean(error) })}
      {hint && !error ? <p className="cx-field__hint" id={hintId}>{hint}</p> : null}
      {error ? <p className="cx-field__error" id={errorId} role="alert">{error}</p> : null}
    </div>
  )
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className, ...rest } = props
  return <input className={['cx-input', className].filter(Boolean).join(' ')} {...rest} />
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className, ...rest } = props
  return <textarea className={['cx-input', 'cx-textarea', className].filter(Boolean).join(' ')} {...rest} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className, children, ...rest } = props
  return (
    <select className={['cx-input', 'cx-select', className].filter(Boolean).join(' ')} {...rest}>
      {children}
    </select>
  )
}

/* ── Segmented control ── */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: ReactNode }>
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="cx-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          className={`cx-seg__opt${value === o.value ? ' is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ── Copy button / code panel ── */
export function CopyButton({ text, label = 'Copy', copiedLabel = 'Copied' }: { text: string; label?: string; copiedLabel?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    window.setTimeout(() => setState('idle'), 1800)
  }
  return (
    <button type="button" className="cx-btn cx-btn--secondary cx-btn--sm" onClick={() => void copy()}>
      {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
      <span aria-live="polite">{state === 'copied' ? copiedLabel : state === 'failed' ? 'Copy failed' : label}</span>
    </button>
  )
}

export function CodePanel({ code, language, title }: { code: string; language: string; title?: ReactNode }) {
  return (
    <div className="cx-code">
      <div className="cx-code__bar">
        <span className="cx-code__lang">{title ?? language}</span>
        <CopyButton text={code} />
      </div>
      <pre className="cx-code__pre" tabIndex={0} aria-label={`${language} example`}>
        <code>{code}</code>
      </pre>
    </div>
  )
}

/* ── Bar list (real values only) ── */
export function BarList({
  items,
  valueLabel,
}: {
  items: Array<{ key: string; label: ReactNode; value: number; meta?: ReactNode }>
  valueLabel: (value: number) => string
}) {
  const max = Math.max(1, ...items.map((i) => i.value))
  return (
    <ul className="cx-bars">
      {items.map((item) => (
        <li key={item.key} className="cx-bars__row">
          <div className="cx-bars__top">
            <span className="cx-bars__label">{item.label}</span>
            <span className="cx-bars__value">{valueLabel(item.value)}</span>
          </div>
          <div className="cx-bars__track" aria-hidden="true">
            <span className="cx-bars__fill" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
          </div>
          {item.meta ? <div className="cx-bars__meta">{item.meta}</div> : null}
        </li>
      ))}
    </ul>
  )
}

/* ── Inline status message (for form results) ── */
export function InlineStatus({ tone, children }: { tone: 'success' | 'error'; children: ReactNode }) {
  return (
    <p className={`cx-inline-status cx-inline-status--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </p>
  )
}
