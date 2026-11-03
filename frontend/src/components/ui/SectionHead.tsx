import type { ReactNode } from 'react'
import { Reveal } from './Reveal'

export function SectionHead({
  eyebrow,
  title,
  lead,
  center = false,
  children,
}: {
  eyebrow?: string
  title: ReactNode
  lead?: ReactNode
  center?: boolean
  children?: ReactNode
}) {
  return (
    <div className={`sec-head ${center ? 'sec-head--center' : ''}`}>
      {eyebrow && (
        <Reveal>
          <span className="eyebrow">{eyebrow}</span>
        </Reveal>
      )}
      <Reveal delay={0.06}>
        <h2 className="h2">{title}</h2>
      </Reveal>
      {lead && (
        <Reveal delay={0.12}>
          <p className="lead">{lead}</p>
        </Reveal>
      )}
      {children}
    </div>
  )
}
