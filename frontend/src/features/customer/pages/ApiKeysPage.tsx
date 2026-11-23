/**
 * API Keys & JWT Tokens — Generate and manage authentication tokens for client applications
 * and OpenAI SDK callers.
 *
 * Restored in accordance with customer portal reference design (media_1795415386682_3d3f521e.jpg).
 */
import { useMemo, useState, type FormEvent } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import {
  API_KEY_NAME_MAX,
  createApiKey,
  formatApiKeyDate,
  getMaskedToken,
  listApiKeys,
  revokeApiKey,
  type ApiKeyEnvironment,
  type ApiKeyView,
} from '../data/apiKeys'
import { CustomerApiError } from '../data/http'
import { useAsyncResource } from '../data/useAsyncResource'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { CONSOLE_BASE, getSection } from '../navigation'
import { useSharedConsoleSignals } from '../shell/useConsoleSignals'
import { signOutToLogin } from '../shell/CustomerShell'
import { CodePanel, CopyButton, Field, Segmented, TextInput } from '../ui/controls'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import { Button, ButtonLink, Card, CardHeader, Notice, StatusPill } from '../ui/primitives'
import { ErrorState, LoadingBlock } from '../ui/states'

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
  usePageMeta('API Keys & JWT Tokens · Inferxe', section.description)
  const keysResource = useAsyncResource(listApiKeys, { cacheKey: 'api-keys' })
  const { refresh: refreshWorkspace } = useCustomerWorkspace()
  const signals = useSharedConsoleSignals()

  // User feedback message
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

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
      setFeedback({ tone: 'success', text: `Demo API key "${result.key.name}" generated successfully.` })
    } catch (err) {
      setCreateError(errorMessage(err, 'The API key could not be created.'))
    } finally {
      setCreating(false)
    }
  }

  const closeReveal = () => {
    setRevealed(null)
    setAcknowledged(false)
  }

  const handleCopyKey = async (k: ApiKeyView) => {
    const tokenToCopy = k.secretToken || `${k.prefix}demo_active_token_${k.id}`
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(tokenToCopy)
      }
      setFeedback({ tone: 'success', text: `API key token for "${k.name}" copied to clipboard.` })
    } catch {
      setFeedback({ tone: 'error', text: 'Could not copy to clipboard.' })
    }
  }

  const confirmRevoke = async () => {
    if (!revokeTarget) return
    setRevoking(true)
    setRevokeError(null)
    try {
      await revokeApiKey(revokeTarget.id)
      const targetName = revokeTarget.name
      setRevokeTarget(null)
      keysResource.refresh()
      refreshWorkspace()
      setFeedback({ tone: 'success', text: `API key "${targetName}" has been revoked.` })
    } catch (err) {
      setRevokeError(errorMessage(err, 'The API key could not be revoked.'))
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="cx-api-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">API Keys &amp; JWT Tokens</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>API Keys &amp; JWT Tokens</h1>
          <p className="cx-page-header__desc">
            Create and manage demo API keys and inspect simulated JWT bearer tokens.
          </p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to={CONSOLE_BASE} variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-api-toolbar">
        <div>
          <h2>API Credentials</h2>
          <p>Generate and manage authentication tokens for client applications and OpenAI SDK callers.</p>
        </div>
        <div className="cx-api-toolbar-actions">
          {keysResource.state.status === 'loading' && <span className="cx-muted cx-api-syncing">Syncing...</span>}
          <Button variant="primary" size="sm" onClick={openCreate} className="cx-add-key-btn">
            <Plus size={15} /> Create Demo Key<span className="cx-sr-only"> Create API key</span>
          </Button>
        </div>
      </div>

      {/* ── Feedback Banner ── */}
      {feedback && (
        <div className={`cx-alert cx-alert--${feedback.tone}`} role={feedback.tone === 'error' ? 'alert' : 'status'}>
          <span>{feedback.text}</span>
        </div>
      )}

      {/* ── Offline/Inference Warning Notice ── */}
      {signals.inferenceAvailable === false ? (
        <Notice tone="warning" icon={<AlertTriangle size={17} />}>
          <strong>The inference API is not serving requests right now.</strong> The model provider is not configured on
          the server, so requests made with these keys will fail until it is.
        </Notice>
      ) : null}

      {/* ── Issued API Keys Card & Table ── */}
      <div className="cx-api-card">
        <div className="cx-api-card__head">
          <div className="cx-api-card__title-group">
            <h3>Issued API Keys</h3>
          </div>
          <div className="cx-api-card__meta">
            <span className="cx-api-count-badge">
              {keysResource.state.status === 'ready' ? `${activeCount} active` : 'Loading keys...'}
            </span>
          </div>
        </div>

        {keysResource.state.status === 'error' && keys.length === 0 ? (
          <div className="cx-card__pad">
            <ErrorState
              error={keysResource.state.error}
              onRetry={keysResource.refresh}
              onSignIn={() => void signOutToLogin()}
              what="your API keys"
            />
          </div>
        ) : keysResource.state.status === 'loading' && keys.length === 0 ? (
          <div className="cx-card__pad">
            <LoadingBlock lines={3} label="Loading API credentials" />
          </div>
        ) : keys.length === 0 ? (
          <div className="cx-api-empty">
            <div className="cx-api-empty__icon">
              <KeyRound size={28} />
            </div>
            <h4>No API keys yet</h4>
            <p>Generate a demo key to start authenticating inference API and OpenAI SDK calls.</p>
            <Button variant="primary" size="sm" onClick={openCreate}>
              <Plus size={15} /> Create API key
            </Button>
          </div>
        ) : (
          <div className="cx-api-table-wrap">
            <table className="cx-api-table cx-table">
              <thead>
                <tr>
                  <th>KEY LABEL</th>
                  <th>SECRET TOKEN</th>
                  <th>ISSUED DATE</th>
                  <th>STATUS</th>
                  <th className="is-right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const masked = getMaskedToken(k)
                  const issuedDate = formatApiKeyDate(k.createdAt)
                  return (
                    <tr key={k.id} className={!k.active ? 'is-revoked' : ''}>
                      <td className="cx-api-cell--label">
                        <div className="cx-key-title">{k.name}</div>
                        <div className="cx-key-id">{k.id}</div>
                      </td>
                      <td className="cx-api-cell--secret">
                        <div className="cx-secret-pill" onClick={() => void handleCopyKey(k)} title="Click to copy token">
                          <code className="cx-secret-code">{masked}</code>
                          <button
                            type="button"
                            className="cx-secret-copy-icon"
                            aria-label={`Copy token for ${k.name}`}
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </td>
                      <td className="cx-api-cell--date">
                        <span>{issuedDate}</span>
                      </td>
                      <td className="cx-api-cell--status">
                        {k.active ? (
                          <StatusPill tone="success" dot>
                            Active
                          </StatusPill>
                        ) : (
                          <StatusPill tone="danger">
                            Revoked
                          </StatusPill>
                        )}
                      </td>
                      <td className="cx-api-cell--actions is-right">
                        <div className="cx-api-actions-row">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void handleCopyKey(k)}
                            className="cx-key-copy-btn"
                            aria-label={`Copy token for ${k.name}`}
                          >
                            <Copy size={13} /> Copy
                          </Button>
                          {k.active ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRevokeError(null)
                                setRevokeTarget(k)
                              }}
                              className="cx-key-revoke-btn"
                              aria-label={`Revoke ${k.name}`}
                            >
                              <Trash2 size={13} /> Revoke
                            </Button>
                          ) : (
                            <span className="cx-muted cx-small cx-revoked-text">Revoked</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Quick Start Card ── */}
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
                options={[
                  { value: 'curl', label: 'cURL' },
                  { value: 'python', label: 'Python' },
                ]}
              />
            }
          />
          <CodePanel
            code={examples[example]}
            language={example === 'curl' ? 'bash' : 'python'}
            title={example === 'curl' ? 'Terminal' : 'Python'}
          />
          <p className="cx-footnote">
            Store the key in an environment variable such as <span className="cx-mono">INFERXE_API_KEY</span> — never commit it to source control.
          </p>
        </Card>
      </section>

      {/* ── Create Demo Key Dialog ── */}
      <Dialog
        open={createOpen}
        title="Create Demo Key"
        description="Name the key after where it will be used, for example “Production Backend API”."
        onClose={() => setCreateOpen(false)}
        dismissible={!creating}
      >
        <form onSubmit={submitCreate} className="cx-form" noValidate>
          <Field label="Key label" error={nameError ?? undefined} hint={`Up to ${API_KEY_NAME_MAX} characters.`}>
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
                placeholder="Production Backend API"
              />
            )}
          </Field>
          <div className="cx-field">
            <span className="cx-field__label" id="cx-env-label">Environment</span>
            <Segmented
              label="Environment"
              value={environment}
              onChange={setEnvironment}
              options={[
                { value: 'live', label: 'Live (inf_demo_live_)' },
                { value: 'test', label: 'Test (inf_demo_test_)' },
              ]}
            />
            <p className="cx-field__hint">
              Live and test keys share the same demo inference API; the environment labels the key prefix.
            </p>
          </div>
          {createError ? (
            <p className="cx-form-error" role="alert">
              {createError}
            </p>
          ) : null}
          <div className="cx-dialog__foot cx-dialog__foot--inline">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={creating}>
              {creating ? 'Creating…' : 'Create key'}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* ── Reveal Secret Dialog (One-time) ── */}
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
              <code className="cx-secret__value" aria-label="New API key">
                {revealed.secret}
              </code>
              <CopyButton text={revealed.secret} label="Copy key" />
            </div>
            <p className="cx-muted cx-small">
              <strong>{revealed.key.name}</strong> · {revealed.key.environment === 'live' ? 'Live' : 'Test'} key
            </p>
            <label className="cx-check">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>
                <ShieldCheck size={15} aria-hidden="true" /> I have stored this key somewhere safe
              </span>
            </label>
          </div>
        ) : null}
      </Dialog>

      {/* ── Revoke Confirmation Dialog ── */}
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
    </div>
  )
}
