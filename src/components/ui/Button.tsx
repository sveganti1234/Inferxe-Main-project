import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react'

interface CommonProps {
  variant?: 'primary' | 'glass' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  arrow?: boolean
  icon?: ReactNode
  block?: boolean
  className?: string
  children?: ReactNode
}

const cls = ({ variant = 'primary', size = 'md', block, className = '' }: CommonProps) =>
  ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ')

export function Button({ variant, size, arrow, icon, block, className, children, ...rest }: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={cls({ variant, size, block, className })} {...rest}>
      {icon}
      <span>{children}</span>
      {arrow && <ArrowRight className="arrow" aria-hidden />}
    </button>
  )
}

export function LinkButton({
  to,
  href,
  variant,
  size,
  arrow,
  icon,
  block,
  className,
  children,
  ...rest
}: CommonProps & { to?: string; href?: string } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>) {
  const inner = (
    <>
      {icon}
      <span>{children}</span>
      {arrow && <ArrowRight className="arrow" aria-hidden />}
    </>
  )
  const c = cls({ variant, size, block, className })
  if (to) {
    return (
      <Link to={to} className={c} {...rest}>
        {inner}
      </Link>
    )
  }
  return (
    <a href={href} className={c} {...rest}>
      {inner}
    </a>
  )
}
