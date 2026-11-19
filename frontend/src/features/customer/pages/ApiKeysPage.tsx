/**
 * API keys — list, create and revoke keys for the inference API via the existing
 * `lib/apiKeyService` (8001 /api/v1/api-keys).
 *
 * Secret handling: the raw key returned on creation lives only in this component's state
 * while the "copy your key" dialog is open. It is never logged, never written to any
 * browser storage, and is discarded when the dialog closes.
 */
import { useMemo, useState, type FormEvent } from 'react'
import { AlertTriangle, KeyRound, Plus, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { API_KEY_NAME_MAX, createApiKey, listApiKeys, revokeApiKey, type ApiKeyEnvironment, type ApiKeyView } from '../data/apiKeys'
import { CustomerApiError } from '../data/http'
import { useAsyncResource } from '../data/useAsyncResource'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { formatDate, formatRelativeTime } from '../data/selectors'
import { getSection } from '../navigation'
import { useSharedConsoleSignals } from '../shell/useConsoleSignals'
import { signOutToLogin } from '../shell/CustomerShell'
import { CodePanel, CopyButton, Field, Segmented, TextInput } from '../ui/controls'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import { Button, Card, CardHeader, DataTable, Notice, PageHeader, StatusPill, type Column } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

function inferenceEndpoint(): string {
  return `${window.location.origin}/api/v1/inference`
}

function usageExamples(endpoint: string) {
  const curl = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer $INFERXE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Explain tensor parallelism in two sentences.",
    "max_tokens": 300,
    "temperature": 0.2
  }'`
  const python = `import os
import requests

response = requests.post(
    "${endpoint}",
    headers={"Authorization": f"Bearer {os.environ['INFERXE_API_KEY']}"},
    json={
        "prompt": "Explain tensor parallelism in two sentences.",
        "max_tokens": 300,
        "temperature": 0.2,
    },
    timeout=60,
)
response.raise_for_status()
data = response.json()
print(data["response"])
print(data["usage"])  # prompt_tokens, completion_tokens, total_tokens`
  return { curl, python }
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof CustomerApiError ? err.message : fallback
}

export default function ApiKeysPage() {
  const section = getSection('api-keys')
  usePageMeta(section.label, section.description)
  const keysResource = useAsyncResource(listApiKeys, { cacheKey: 'api-keys' })
  const { refresh: refreshWorkspace } = useCustomerWorkspace()
  const signals = useSharedConsoleSignals()

  // Create flow
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState<ApiKeyEnvironment>('live')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  // Secret is held only while the reveal dialog is open.
  const [revealed, setRevealed] = useState<{ key: ApiKeyView; secret: string } | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)

  // Revoke flow
  const [revokeTarget, setRevokeTarget] = useState<ApiKeyView | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [revokeError, setRevokeError] = useState<string | null>(null)

  const [example, setExample] = useState<'curl' | 'python'>('curl')
  const examples = useMemo(() => usageExamples(inferenceEndpoint()), [])

  const keys = keysResource.state.data ?? []
  const activeCount = keys.filter((k) => k.active).length
  const listError = keysResource.state.status === 'error' ? keysResource.state.error : null
  const nameError = name.trim().length > API_KEY_NAME_MAX ? `Use ${API_KEY_NAME_MAX} characters or fewer.` : null

  const openCreate = () => {
    setName('')
    setEnvironment('live')
    setCreateError(null)
    setCreateOpen(true)
  }

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim() || nameError) {
      setCreateError(nameError ?? 'Give the key a name so you can recognise it later.')
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const result = await createApiKey(name, environment)
      setCreateOpen(false)
      setAcknowledged(false)
      setRevealed(result)
      keysResource.refresh()
      refreshWorkspace()
    } catch (err) {
      if (err instanceof CustomerApiError && err.kind === 'unauthenticated') {
        setCreateOpen(false)
        keysResource.refresh()
      }
      setCreateError(errorMessage(err, 'The API key could not be created.'))
    } finally {
      setCreating(false)
    }
  }

  const closeReveal = () => {
    setRevealed(null) // discard the secret
    setAcknowledged(false)
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      await revokeApiKey(revokeTarget.id)
      setRevokeTarget(null)
      keysResource.refresh()
      refreshWorkspace()
    } catch (err) {
      setRevokeError(errorMessage(err, 'The API key could not be revoked.'))
    } finally {
      setRevoking(false)
    }
  }

  const columns: Column<ApiKeyView>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (k) => (
        <div className="cx-keycell">
          <span className="cx-keycell__name">{k.name}</span>
          <span className="cx-mono cx-keycell__prefix">{k.prefix ? `${k.prefix}…` : '—'}</span>
        </div>
      ),
    },
    {
      key: 'env',
      header: 'Environment',
      render: (k) => <StatusPill tone={k.environment === 'live' ? 'info' : 'neutral'}>{k.environment === 'live' ? 'Live' : 'Test'}</StatusPill>,
    },
    { key: 'created', header: 'Created', render: (k) => formatDate(k.createdAt) },
    { key: 'used', header: 'Last used', render: (k) => (k.lastUsedAt ? formatRelativeTime(k.lastUsedAt) : 'Never') },
    {
      key: 'status',
      header: 'Status',
      render: (k) =>
        k.active ? <StatusPill tone="success" dot>Active</StatusPill> : <StatusPill tone="danger">Revoked</StatusPill>,
    },
    {
      key: 'actions',
      header: <span className="cx-sr-only">Actions</span>,
      numeric: true,
      render: (k) =>
        k.active ? (
          <Button variant="ghost" size="sm" onClick={() => { setRevokeError(null); setRevokeTarget(k) }} aria-label={`Revoke ${k.name}`}>
            <Trash2 size={14} /> Revoke
          </Button>
        ) : (
          <span className="cx-muted">{k.revokedAt ? formatDate(k.revokedAt) : ''}</span>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="API keys"
        description="Keys authenticate your requests to the Inferxe inference API. Treat them like passwords."
        actions={
          <>
            <Button variant="secondary" onClick={keysResource.refresh} disabled={keysResource.state.status === 'loading'} aria-label="Refresh API keys">
              <RefreshCw size={15} />
            </Button>
            <Button variant="primary" onClick={openCreate} disabled={listError?.kind === 'unauthenticated'}>
              <Plus size={16} /> Create API key
            </Button>
          </>
        }
      />

      {signals.inferenceAvailable === false ? (
        <Notice tone="warning" icon={<AlertTriangle size={17} />}>
          <strong>The inference API is not serving requests right now.</strong> The model provider is not configured on
          the server, so requests made with these keys will fail until it is.
        </Notice>
      ) : null}

      <Card flush aria-labelledby="cx-keys-title">
        <div className="cx-card__pad">
          <CardHeader
            id="cx-keys-title"
            title="Your keys"
            description={keysResource.state.status === 'ready' ? `${activeCount} active · ${keys.length} total` : 'Loading your keys'}
          />
        </div>
        {listError && keys.length === 0 ? (
          <ErrorState error={listError} onRetry={keysResource.refresh} onSignIn={() => void signOutToLogin()} what="your API keys" />
        ) : keysResource.state.status === 'loading' && keys.length === 0 ? (
          <div className="cx-card__pad"><LoadingBlock lines={4} label="Loading API keys" /></div>
        ) : (
          <DataTable
            caption="Your API keys"
            stackOnMobile
            columns={columns}
            rows={keys}
            rowKey={(k) => k.id}
            empty={
              <EmptyState
                icon={<KeyRound size={24} />}
                title="No API keys yet"
                body="Create a key to start sending requests to the inference API."
                actions={<Button variant="primary" onClick={openCreate}><Plus size={16} /> Create API key</Button>}
              />
            }
          />
        )}
      </Card>

      <section className="cx-section" aria-labelledby="cx-quickstart-title">
        <Card>
          <CardHeader
            id="cx-quickstart-title"
            title="Quick start"
            description={
              <>
                Send a prompt to <span className="cx-mono">POST /api/v1/inference</span> with your key as a bearer token.
                The server currently selects the model; the response includes the generated text and token usage.
              </>
            }
            action={
              <Segmented
                label="Example language"
                value={example}
                onChange={setExample}
                options={[{ value: 'curl', label: 'cURL' }, { value: 'python', label: 'Python' }]}
              />
            }
          />
          <CodePanel code={examples[example]} language={example === 'curl' ? 'bash' : 'python'} title={example === 'curl' ? 'Terminal' : 'Python'} />
          <p className="cx-footnote">
            Store the key in an environment variable such as <span className="cx-mono">INFERXE_API_KEY</span> — never commit it to source control.
          </p>
        </Card>
      </section>

      {/* Create */}
      <Dialog
        open={createOpen}
        title="Create API key"
        description="Name the key after where it will be used, for example “production backend”."
        onClose={() => setCreateOpen(false)}
        dismissible={!creating}
      >
        <form onSubmit={submitCreate} className="cx-form" noValidate>
          <Field label="Key name" error={nameError ?? undefined} hint={`Up to ${API_KEY_NAME_MAX} characters.`}>
            {({ inputId, describedBy, invalid }) => (
              <TextInput
                id={inputId}
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={API_KEY_NAME_MAX}
                autoComplete="off"
                aria-describedby={describedBy}
                aria-invalid={invalid}
                data-autofocus
                placeholder="Production backend"
              />
            )}
          </Field>
          <div className="cx-field">
            <span className="cx-field__label" id="cx-env-label">Environment</span>
            <Segmented
              label="Environment"
              value={environment}
              onChange={setEnvironment}
              options={[{ value: 'live', label: 'Live' }, { value: 'test', label: 'Test' }]}
            />
            <p className="cx-field__hint">Live and test keys share the same API; the environment labels the key prefix.</p>
          </div>
          {createError ? <p className="cx-form-error" role="alert">{createError}</p> : null}
          <div className="cx-dialog__foot cx-dialog__foot--inline">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create key'}</Button>
          </div>
        </form>
      </Dialog>

      {/* Reveal (once) */}
      <Dialog
        open={revealed !== null}
        title="Copy your new API key"
        description="This is the only time the full key is shown. Inferxe stores only a hash, so it cannot be recovered later."
        onClose={closeReveal}
        dismissible={acknowledged}
        footer={
          <Button variant="primary" onClick={closeReveal} disabled={!acknowledged}>
            Done
          </Button>
        }
      >
        {revealed ? (
          <div className="cx-stack">
            <div className="cx-secret">
              <code className="cx-secret__value" aria-label="New API key">{revealed.secret}</code>
              <CopyButton text={revealed.secret} label="Copy key" />
            </div>
            <p className="cx-muted cx-small">
              <strong>{revealed.key.name}</strong> · {revealed.key.environment === 'live' ? 'Live' : 'Test'} key
            </p>
            <label className="cx-check">
              <input type="checkbox" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
              <span><ShieldCheck size={15} aria-hidden="true" /> I have stored this key somewhere safe</span>
            </label>
          </div>
        ) : null}
      </Dialog>

      {/* Revoke */}
      <ConfirmDialog
        open={revokeTarget !== null}
        title={`Revoke “${revokeTarget?.name ?? ''}”?`}
        description="Requests using this key will be rejected immediately. This cannot be undone."
        confirmLabel="Revoke key"
        busy={revoking}
        error={revokeError}
        onConfirm={() => void confirmRevoke()}
        onCancel={() => setRevokeTarget(null)}
      />
    </>
  )
}
