/**
 * Deployments — READ-ONLY records from GET /api/customer/workspace.
 * Provisioning does not exist yet: nothing here starts, stops, scales or creates anything,
 * and the page never implies that a GPU is running. A stored "running" status is shown as a
 * recorded value, not as a fact about infrastructure.
 */
import { AlertTriangle, ArrowRight, Rocket, RefreshCw } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { selectDeployments, type DeploymentView } from '../data/marketplace'
import { formatDate, formatInteger, humaniseCode } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection, sectionHref } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { Button, ButtonLink, Card, CardHeader, DataTable, Notice, PageHeader, StatusPill, type Column } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

export default function DeploymentsPage() {
  const section = getSection('deployments')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()
  const rows = workspace ? selectDeployments(workspace) : []

  const columns: Column<DeploymentView>[] = [
    { key: 'name', header: 'Name', render: (d) => <span className="cx-keycell__name">{d.name}</span> },
    { key: 'model', header: 'Model', render: (d) => d.model ?? <span className="cx-muted">—</span> },
    { key: 'gpu', header: 'GPU', render: (d) => d.gpu ?? <span className="cx-muted">—</span> },
    { key: 'region', header: 'Region', render: (d) => d.region ?? <span className="cx-muted">—</span> },
    {
      key: 'status',
      header: 'Recorded status',
      render: (d) => <StatusPill tone="simulated">{d.recordedStatus ? `${humaniseCode(d.recordedStatus)} (recorded)` : 'No status recorded'}</StatusPill>,
    },
    { key: 'created', header: 'Created', render: (d) => formatDate(d.createdAt) },
  ]

  return (
    <>
      <PageHeader
        title="Deployments"
        description="Dedicated model deployments on reserved GPU capacity."
        actions={
          <Button variant="secondary" onClick={refresh} disabled={state.status === 'loading'} aria-label="Refresh deployments">
            <RefreshCw size={15} />
          </Button>
        }
      />

      <Notice tone="warning" icon={<AlertTriangle size={17} />}>
        <strong>Deployment provisioning is not available yet.</strong> Inferxe does not start GPUs or serve models from
        deployments today, so there are no create, start or stop controls. Any records below are read-only entries on
        your account.
      </Notice>

      <Card flush aria-labelledby="cx-deploy-title">
        <div className="cx-card__pad">
          <CardHeader
            id="cx-deploy-title"
            title="Deployment records"
            description={workspace ? `${formatInteger(rows.length)} record${rows.length === 1 ? '' : 's'} on your account` : 'Loading your records'}
          />
        </div>
        {state.status === 'error' && !workspace ? (
          <ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your deployment records" compact />
        ) : !workspace ? (
          <div className="cx-card__pad"><LoadingBlock lines={3} label="Loading deployments" /></div>
        ) : (
          <DataTable
            caption="Deployment records"
            columns={columns}
            rows={rows}
            rowKey={(d) => d.id}
            stackOnMobile
            empty={
              <EmptyState
                compact
                icon={<Rocket size={24} />}
                title="No deployment records"
                body="You have no deployment records. Deployments cannot be created yet, so none will appear until provisioning launches."
                actions={
                  <>
                    <ButtonLink to={sectionHref(getSection('gpus'))} variant="secondary" size="sm">See listed GPU capacity <ArrowRight size={14} /></ButtonLink>
                    <ButtonLink to={sectionHref(getSection('playground'))} variant="ghost" size="sm">Try the inference playground</ButtonLink>
                  </>
                }
              />
            }
          />
        )}
        {rows.length > 0 ? (
          <p className="cx-card__pad cx-footnote cx-footnote--flush">
            A recorded status is a value stored on the record. It does not mean a GPU is allocated or a model is being served.
          </p>
        ) : null}
      </Card>
    </>
  )
}
