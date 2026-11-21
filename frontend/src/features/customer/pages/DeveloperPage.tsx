/**
 * SSH keys & notebooks.
 *
 * SSH keys are real records (8001 /api/v1/ssh-keys). Notebook sessions are records only:
 * the backend's runtime driver is SIMULATED — no GPU, Jupyter server or SSH server is ever
 * provisioned. This page therefore never shows connection commands, Jupyter URLs or access
 * tokens (the data adapter drops them), labels every active state "simulated", and explains
 * the limitation next to every control that could suggest otherwise.
 */
import { useState, type FormEvent } from 'react'
import { FlaskConical, KeyRound, Play, Plus, RefreshCw, Square, SquareTerminal, Trash2 } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import {
  NOTEBOOK_NAME_MAX,
  SSH_KEY_NAME_MAX,
  addSshKey,
  createNotebook,
  listNotebooks,
  listSshKeys,
  removeSshKey,
  runNotebookAction,
  validateSshPublicKey,
  type NotebookAction,
  type NotebookView,
  type SshKeyView,
} from '../data/developer'
import { CustomerApiError } from '../data/http'
import { formatDate, formatRelativeTime } from '../data/selectors'
import { useAsyncResource, type AsyncResource } from '../data/useAsyncResource'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { AvailabilityBadge } from '../ui/AvailabilityBadge'
import { Field, InlineStatus, Select, TextArea, TextInput } from '../ui/controls'
import { ConfirmDialog, Dialog } from '../ui/Dialog'
import { Button, Card, CardHeader, DataTable, Notice, PageHeader, StatusPill, type Column, type PillTone } from '../ui/primitives'
import { EmptyState, ErrorState, LoadingBlock } from '../ui/states'

const errorMessage = (err: unknown, fallback: string) => (err instanceof CustomerApiError ? err.message : fallback)

const STATUS_VIEW: Record<NotebookView['status'], { label: string; tone: PillTone }> = {
  starting: { label: 'Starting', tone: 'simulated' },
  running: { label: 'Running', tone: 'simulated' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Failed', tone: 'danger' },
  terminated: { label: 'Terminated', tone: 'neutral' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

function NotebookStatus({ notebook }: { notebook: NotebookView }) {
  const view = STATUS_VIEW[notebook.status]
  const active = notebook.status === 'running' || notebook.status === 'starting'
  return (
    <StatusPill tone={view.tone}>
      {view.label}
      {active && notebook.simulated ? ' (simulated)' : ''}
    </StatusPill>
  )
}

/* ───────────────────────── SSH keys ───────────────────────── */

function SshKeysCard({ keys, onChanged }: { keys: AsyncResource<SshKeyView[]>; onChanged: () => void }) {
  const [addOpen, setAddOpen] = useState(false)
  const [name, setName] = useState('')
  const [publicKey, setPublicKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [target, setTarget] = useState<SshKeyView | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const list = keys.state.data ?? []
  const loadError = keys.state.status === 'error' ? keys.state.error : null
  const keyProblem = publicKey.trim() ? validateSshPublicKey(publicKey) : null

  const openAdd = () => {
    setName('')
    setPublicKey('')
    setAddError(null)
    setAddOpen(true)
  }
  const closeAdd = () => {
    setAddOpen(false)
    setName('')
    setPublicKey('')
  }

  const submitAdd = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setAddError('Give the key a name so you can recognise it later.')
    const problem = validateSshPublicKey(publicKey)
    if (problem) return setAddError(problem)
    setAdding(true)
    setAddError(null)
    try {
      await addSshKey(name, publicKey)
      closeAdd()
      keys.refresh()
      onChanged()
    } catch (err) {
      setAddError(errorMessage(err, 'The SSH key could not be added.'))
    } finally {
      setAdding(false)
    }
  }

  const confirmDelete = async () => {
    if (!target) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await removeSshKey(target.id)
      setTarget(null)
      keys.refresh()
      onChanged()
    } catch (err) {
      setDeleteError(errorMessage(err, 'The SSH key could not be deleted.'))
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<SshKeyView>[] = [
    { key: 'name', header: 'Name', render: (k) => <span className="cx-keycell__name">{k.name}</span> },
    { key: 'type', header: 'Type', render: (k) => <StatusPill>{k.keyType}</StatusPill> },
    { key: 'fp', header: 'Fingerprint', render: (k) => <span className="cx-mono cx-fingerprint" title={k.fingerprint}>{k.fingerprint || '—'}</span> },
    { key: 'added', header: 'Added', render: (k) => formatDate(k.createdAt) },
    {
      key: 'actions',
      header: <span className="cx-sr-only">Actions</span>,
      numeric: true,
      render: (k) => (
        <Button variant="ghost" size="sm" onClick={() => { setDeleteError(null); setTarget(k) }} aria-label={`Delete SSH key ${k.name}`}>
          <Trash2 size={14} /> Delete
        </Button>
      ),
    },
  ]

  return (
    <>
      <Card flush aria-labelledby="cx-ssh-title">
        <div className="cx-card__pad">
          <CardHeader
            id="cx-ssh-title"
            title={<span className="cx-title-icon"><KeyRound size={17} aria-hidden="true" /> SSH keys</span>}
            description="Public keys registered to your account. Only public keys are accepted."
            action={
              <div className="cx-card__actions">
                <AvailabilityBadge availability="live" note="Real records in your account." />
                <Button variant="primary" size="sm" onClick={openAdd} disabled={loadError?.kind === 'unauthenticated'}>
                  <Plus size={15} /> Add SSH key
                </Button>
              </div>
            }
          />
        </div>
        {loadError && list.length === 0 ? (
          <ErrorState error={loadError} onRetry={keys.refresh} onSignIn={() => void signOutToLogin()} what="your SSH keys" compact />
        ) : keys.state.status === 'loading' && list.length === 0 ? (
          <div className="cx-card__pad"><LoadingBlock lines={3} label="Loading SSH keys" /></div>
        ) : (
          <DataTable
            caption="Your SSH keys"
            stackOnMobile
            columns={columns}
            rows={list}
            rowKey={(k) => k.id}
            empty={
              <EmptyState
                compact
                icon={<KeyRound size={24} />}
                title="No SSH keys yet"
                body="Add the public half of an SSH key pair (the .pub file). Never paste a private key."
                actions={<Button variant="primary" size="sm" onClick={openAdd}><Plus size={15} /> Add SSH key</Button>}
              />
            }
          />
        )}
      </Card>

      <Dialog open={addOpen} title="Add SSH key" description="Paste the contents of your public key file, for example ~/.ssh/id_ed25519.pub." onClose={closeAdd} dismissible={!adding}>
        <form className="cx-form" onSubmit={submitAdd} noValidate>
          <Field label="Key name" hint={`Up to ${SSH_KEY_NAME_MAX} characters, for example “work laptop”.`}>
            {({ inputId, describedBy }) => (
              <TextInput id={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={SSH_KEY_NAME_MAX} autoComplete="off" aria-describedby={describedBy} data-autofocus placeholder="Work laptop" />
            )}
          </Field>
          <Field label="Public key" error={keyProblem} hint="Starts with ssh-ed25519, ssh-rsa or ecdsa-sha2-… Never paste a private key.">
            {({ inputId, describedBy, invalid }) => (
              <TextArea id={inputId} value={publicKey} onChange={(e) => setPublicKey(e.target.value)} rows={5} spellCheck={false} autoComplete="off" autoCapitalize="off" aria-describedby={describedBy} aria-invalid={invalid} placeholder="ssh-ed25519 AAAAC3Nza… you@laptop" />
            )}
          </Field>
          {addError ? <p className="cx-form-error" role="alert">{addError}</p> : null}
          <div className="cx-dialog__foot cx-dialog__foot--inline">
            <Button variant="ghost" onClick={closeAdd} disabled={adding}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={adding || Boolean(keyProblem)}>{adding ? 'Adding…' : 'Add key'}</Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={target !== null}
        title={`Delete SSH key “${target?.name ?? ''}”?`}
        description="The key is removed from your account. Anything that relied on it will no longer be able to use it."
        confirmLabel="Delete key"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setTarget(null)}
      />
    </>
  )
}

/* ───────────────────────── Notebooks (simulated) ───────────────────────── */

function NotebooksCard({
  notebooks,
  sshKeys,
  onChanged,
}: {
  notebooks: AsyncResource<NotebookView[]>
  sshKeys: SshKeyView[]
  onChanged: () => void
}) {
  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [sshKeyId, setSshKeyId] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [busy, setBusy] = useState<{ id: string; action: NotebookAction } | null>(null)
  const [rowMessage, setRowMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [terminateTarget, setTerminateTarget] = useState<NotebookView | null>(null)
  const [terminateError, setTerminateError] = useState<string | null>(null)

  const list = notebooks.state.data ?? []
  const loadError = notebooks.state.status === 'error' ? notebooks.state.error : null
  const keyName = (id: string | null) => (id === null ? 'None' : (sshKeys.find((k) => k.id === id)?.name ?? 'Deleted key'))

  const openCreate = () => {
    setName('')
    setSshKeyId('')
    setCreateError(null)
    setCreateOpen(true)
  }

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return setCreateError('Give the notebook a name.')
    setCreating(true)
    setCreateError(null)
    try {
      await createNotebook(name, sshKeyId || null)
      setCreateOpen(false)
      setRowMessage({ tone: 'success', text: 'Simulated notebook record created. No GPU or Jupyter server was provisioned.' })
      notebooks.refresh()
      onChanged()
    } catch (err) {
      setCreateError(errorMessage(err, 'The notebook record could not be created.'))
    } finally {
      setCreating(false)
    }
  }

  const act = async (action: NotebookAction, notebook: NotebookView) => {
    setBusy({ id: notebook.id, action })
    setRowMessage(null)
    try {
      await runNotebookAction(action, notebook.id)
      setTerminateTarget(null)
      setRowMessage({
        tone: 'success',
        text:
          action === 'terminate'
            ? `“${notebook.name}” was marked as terminated.`
            : `“${notebook.name}” was marked as ${action === 'start' ? 'running' : 'stopped'} (simulated). Nothing was started or stopped on real infrastructure.`,
      })
      notebooks.refresh()
      onChanged()
    } catch (err) {
      const message = errorMessage(err, `The notebook could not be ${action === 'terminate' ? 'terminated' : action === 'start' ? 'started' : 'stopped'}.`)
      if (action === 'terminate') setTerminateError(message)
      else setRowMessage({ tone: 'error', text: message })
    } finally {
      setBusy(null)
    }
  }

  const columns: Column<NotebookView>[] = [
    { key: 'name', header: 'Notebook', render: (n) => <span className="cx-keycell__name">{n.name}</span> },
    { key: 'status', header: 'Status', render: (n) => <NotebookStatus notebook={n} /> },
    { key: 'profile', header: 'Profile label', render: (n) => <span title="A label stored on the record. No GPU is allocated.">{n.profileLabel}</span> },
    { key: 'ssh', header: 'SSH key', render: (n) => keyName(n.sshKeyId) },
    { key: 'created', header: 'Created', render: (n) => formatDate(n.createdAt) },
    { key: 'active', header: 'Last active', render: (n) => (n.lastActiveAt ? formatRelativeTime(n.lastActiveAt) : '—') },
    {
      key: 'actions',
      header: <span className="cx-sr-only">Actions</span>,
      numeric: true,
      render: (n) => {
        const working = busy?.id === n.id
        return (
          <div className="cx-row-actions">
            <Button variant="ghost" size="sm" onClick={() => void act('start', n)} disabled={working || n.status === 'running' || n.status === 'starting'} aria-label={`Start ${n.name} (simulated)`}>
              <Play size={14} /> Start
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void act('stop', n)} disabled={working || n.status === 'stopped'} aria-label={`Stop ${n.name} (simulated)`}>
              <Square size={13} /> Stop
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setTerminateError(null); setTerminateTarget(n) }} disabled={working} aria-label={`Terminate ${n.name}`}>
              <Trash2 size={14} />
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <>
      <Card flush aria-labelledby="cx-nb-title">
        <div className="cx-card__pad">
          <CardHeader
            id="cx-nb-title"
            title={<span className="cx-title-icon"><SquareTerminal size={17} aria-hidden="true" /> Notebook sessions</span>}
            description="Records of notebook sessions. The runtime is simulated."
            action={
              <div className="cx-card__actions">
                <AvailabilityBadge availability="simulated" note="Records are real; the notebook runtime is simulated and provisions nothing." />
                <Button variant="primary" size="sm" onClick={openCreate} disabled={loadError?.kind === 'unauthenticated'}>
                  <Plus size={15} /> New notebook record
                </Button>
              </div>
            }
          />
          {rowMessage ? <InlineStatus tone={rowMessage.tone}>{rowMessage.text}</InlineStatus> : null}
        </div>
        {loadError && list.length === 0 ? (
          <ErrorState error={loadError} onRetry={notebooks.refresh} onSignIn={() => void signOutToLogin()} what="your notebooks" compact />
        ) : notebooks.state.status === 'loading' && list.length === 0 ? (
          <div className="cx-card__pad"><LoadingBlock lines={3} label="Loading notebooks" /></div>
        ) : (
          <DataTable
            caption="Your notebook sessions (simulated)"
            stackOnMobile
            columns={columns}
            rows={list}
            rowKey={(n) => n.id}
            empty={
              <EmptyState
                compact
                icon={<FlaskConical size={24} />}
                title="No notebook records yet"
                body="Creating one adds a simulated record to your account. It does not start a GPU, a Jupyter server or an SSH server."
                actions={<Button variant="primary" size="sm" onClick={openCreate}><Plus size={15} /> New notebook record</Button>}
              />
            }
          />
        )}
        <p className="cx-card__pad cx-footnote cx-footnote--flush">
          Connection details are intentionally not shown: a simulated notebook has no SSH server or Jupyter URL you could connect to.
        </p>
      </Card>

      <Dialog
        open={createOpen}
        title="New notebook record"
        description="This adds a simulated record to your account. No GPU, Jupyter server or SSH server is provisioned."
        onClose={() => setCreateOpen(false)}
        dismissible={!creating}
      >
        <form className="cx-form" onSubmit={submitCreate} noValidate>
          <Field label="Notebook name" hint={`Up to ${NOTEBOOK_NAME_MAX} characters.`}>
            {({ inputId, describedBy }) => (
              <TextInput id={inputId} value={name} onChange={(e) => setName(e.target.value)} maxLength={NOTEBOOK_NAME_MAX} autoComplete="off" aria-describedby={describedBy} data-autofocus placeholder="Fine-tuning scratchpad" />
            )}
          </Field>
          <Field label="SSH key (optional)" hint="Stored on the record. It has no effect while the runtime is simulated.">
            {({ inputId, describedBy }) => (
              <Select id={inputId} value={sshKeyId} onChange={(e) => setSshKeyId(e.target.value)} aria-describedby={describedBy}>
                <option value="">None</option>
                {sshKeys.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </Select>
            )}
          </Field>
          {createError ? <p className="cx-form-error" role="alert">{createError}</p> : null}
          <div className="cx-dialog__foot cx-dialog__foot--inline">
            <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={creating}>{creating ? 'Creating…' : 'Create record'}</Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={terminateTarget !== null}
        title={`Terminate “${terminateTarget?.name ?? ''}”?`}
        description="The simulated notebook is marked as terminated and removed from this list. No real infrastructure is affected."
        confirmLabel="Terminate"
        busy={busy?.action === 'terminate'}
        error={terminateError}
        onConfirm={() => terminateTarget && void act('terminate', terminateTarget)}
        onCancel={() => setTerminateTarget(null)}
      />
    </>
  )
}

/* ───────────────────────── Page ───────────────────────── */

export default function DeveloperPage() {
  const section = getSection('developer')
  usePageMeta(section.label, section.description)
  const { refresh: refreshWorkspace } = useCustomerWorkspace()
  const sshKeys = useAsyncResource(listSshKeys, { cacheKey: 'ssh-keys' })
  const notebooks = useAsyncResource(listNotebooks, { cacheKey: 'notebooks' })

  const refreshAll = () => {
    sshKeys.refresh()
    notebooks.refresh()
  }

  return (
    <>
      <PageHeader
        title="SSH keys & notebooks"
        description="Register SSH public keys and manage notebook session records."
        actions={
          <Button variant="secondary" onClick={refreshAll} aria-label="Refresh SSH keys and notebooks">
            <RefreshCw size={15} />
          </Button>
        }
      />

      <Notice tone="warning" icon={<FlaskConical size={17} />}>
        <strong>The notebook runtime is simulated.</strong> Creating, starting or stopping a notebook only changes a
        record in your account. No GPU, Jupyter server or SSH server is provisioned, so there is nothing to connect to.
        SSH keys below are real and stored in your account.
      </Notice>

      <div className="cx-stack">
        <SshKeysCard keys={sshKeys} onChanged={refreshWorkspace} />
        <NotebooksCard notebooks={notebooks} sshKeys={sshKeys.state.data ?? []} onChanged={refreshWorkspace} />
      </div>
    </>
  )
}
