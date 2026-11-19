import { BookOpen, CircleSlash, FlaskConical, Radio } from 'lucide-react'
import type { Availability } from '../navigation'

const META: Record<Availability, { label: string; title: string; Icon: typeof Radio }> = {
  live: { label: 'Live', title: 'Real data from your Inferxe account and services.', Icon: Radio },
  reference: { label: 'Reference', title: 'Static reference information — not live availability or pricing.', Icon: BookOpen },
  simulated: { label: 'Simulated', title: 'Backed by real records, but the runtime is simulated. No infrastructure is provisioned.', Icon: FlaskConical },
  unavailable: { label: 'Unavailable', title: 'This capability is not available yet.', Icon: CircleSlash },
}

export function availabilityLabel(availability: Availability): string {
  return META[availability].label
}

export function AvailabilityBadge({ availability, note }: { availability: Availability; note?: string }) {
  const { label, title, Icon } = META[availability]
  return (
    <span className={`cx-badge cx-badge--${availability}`} title={note ?? title} data-availability={availability}>
      <Icon size={12} strokeWidth={2.4} aria-hidden="true" />
      {label}
      <span className="cx-sr-only">{`: ${note ?? title}`}</span>
    </span>
  )
}
