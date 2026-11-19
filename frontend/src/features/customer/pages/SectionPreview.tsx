/**
 * Honest placeholder for console sections that are scheduled for later stages.
 * Shows what the section will provide and its availability — never sample data.
 */
import { ArrowLeft, CheckCircle2, Construction } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { CONSOLE_BASE, getSection, type SectionId } from '../navigation'
import { ButtonLink, Card, CardHeader, PageHeader } from '../ui/primitives'
import { EmptyState } from '../ui/states'

export default function SectionPreview({ id }: { id: SectionId }) {
  const section = getSection(id)
  usePageMeta(section.label, section.description)

  return (
    <>
      <PageHeader
        title={section.label}
        description={section.description}
      />
      <div className="cx-grid cx-grid--2">
        <Card>
          <EmptyState
            icon={<Construction size={24} />}
            title="This section is being rebuilt"
            body={`${section.availabilityNote} It will open here in a later stage of the console rollout.`}
            actions={
              <ButtonLink to={CONSOLE_BASE} variant="secondary">
                <ArrowLeft size={15} /> Back to console
              </ButtonLink>
            }
          />
        </Card>
        <Card aria-labelledby={`cx-cap-${section.id}`}>
          <CardHeader id={`cx-cap-${section.id}`} title="What this section will provide" />
          <ul className="cx-list">
            {section.capabilities.map((capability) => (
              <li key={capability}>
                <CheckCircle2 size={16} aria-hidden="true" />
                {capability}
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
