/**
 * Presentational primitives for the Inferxe console (scoped .cx-* styles).
 */
import type { ButtonHTMLAttributes, ElementType, ReactNode } from 'react'
import { Link } from 'react-router-dom'

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ')

/* ── Card ── */
export function Card({
  children,
  className,
  flush,
  interactive,
  as: Tag = 'section',
  ...rest
}: {
  children: ReactNode
  className?: string
  flush?: boolean
  interactive?: boolean
  as?: ElementType
  'aria-label'?: string
  'aria-labelledby'?: string
}) {
  return (
    <Tag className={cx('cx-card', flush && 'cx-card--flush', interactive && 'cx-card--interactive', className)} {...rest}>
      {children}
    </Tag>
  )
}

export function CardHeader({ title, description, action, id }: { title: ReactNode; description?: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="cx-card__head">
      <div>
        <h2 className="cx-card__title" id={id}>{title}</h2>
        {description ? <p className="cx-card__desc">{description}</p> : null}
      </div>
      {action}
    </div>
  )
}

/* ── Page header ── */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="cx-page-header">
      <div className="cx-page-header__text">
        <h1 className="cx-title">{title}</h1>
        {description ? <p className="cx-subtitle">{description}</p> : null}
      </div>
      {actions ? <div className="cx-page-header__actions">{actions}</div> : null}
    </header>
  )
}

/* ── Stat ── */
export function Stat({
  label,
  value,
  hint,
  icon,
  valueSize,
}: {
  label: ReactNode
  /** Pass null when the value is unknown — renders an em dash, never a placeholder number. */
  value: ReactNode | null
  hint?: ReactNode
  icon?: ReactNode
  /** Smaller type for textual values such as "Pricing not configured". */
  valueSize?: 'sm'
}) {
  const empty = value === null || value === undefined || value === '—'
  return (
    <div className="cx-stat">
      <div className="cx-stat__label">
        {icon}
        {label}
      </div>
      <div className={cx('cx-stat__value', empty && 'cx-stat__value--empty', valueSize === 'sm' && 'cx-stat__value--sm')}>{empty ? '—' : value}</div>
      {hint ? <div className="cx-stat__hint">{hint}</div> : null}
    </div>
  )
}

/* ── Status pill ── */
export type PillTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'simulated'
export function StatusPill({ tone = 'neutral', children, dot }: { tone?: PillTone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx('cx-pill', tone !== 'neutral' && `cx-pill--${tone}`)}>
      {dot ? <span className={cx('cx-dot', tone === 'success' && 'cx-dot--live', tone === 'warning' && 'cx-dot--warn', tone === 'danger' && 'cx-dot--danger')} aria-hidden="true" /> : null}
      {children}
    </span>
  )
}

/* ── Buttons ── */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export function Button({
  variant = 'secondary',
  size,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' }) {
  return (
    <button type={type} className={cx('cx-btn', `cx-btn--${variant}`, size === 'sm' && 'cx-btn--sm', className)} {...rest}>
      {children}
    </button>
  )
}

export function ButtonLink({
  to,
  variant = 'secondary',
  size,
  className,
  children,
}: {
  to: string
  variant?: ButtonVariant
  size?: 'sm'
  className?: string
  children: ReactNode
}) {
  return (
    <Link to={to} className={cx('cx-btn', `cx-btn--${variant}`, size === 'sm' && 'cx-btn--sm', className)}>
      {children}
    </Link>
  )
}

/* ── Notice banner ── */
export function Notice({ tone = 'info', icon, children }: { tone?: 'info' | 'warning' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <div className={cx('cx-notice', tone !== 'info' && `cx-notice--${tone}`)} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon}
      <div>{children}</div>
    </div>
  )
}

/* ── Data table ── */
export interface Column<Row> {
  key: string
  header: ReactNode
  render: (row: Row) => ReactNode
  numeric?: boolean
}
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty,
  stackOnMobile,
}: {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  caption: string
  /** Rendered instead of the table when there are no rows. */
  empty: ReactNode
  /** On small screens, show each row as a labelled card instead of scrolling sideways. */
  stackOnMobile?: boolean
}) {
  if (rows.length === 0) return <>{empty}</>
  return (
    <div className="cx-table-wrap">
      <table className={cx('cx-table', stackOnMobile && 'cx-table--stack')}>
        <caption className="cx-sr-only">{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col" className={c.numeric ? 'is-num' : undefined}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((c) => (
                <td key={c.key} className={c.numeric ? 'is-num' : undefined} data-label={typeof c.header === 'string' ? c.header : ''}>
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
