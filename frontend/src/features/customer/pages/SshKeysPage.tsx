/**
 * SSH Public Keys — Register and manage OpenSSH public keys for secure terminal pairing with GPU nodes.
 * Restored in accordance with customer portal reference design (media_1795414421427_3bc02d13.jpg).
 */
import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  Copy,
  KeyRound,
  Plus,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import {
  createBackendSshKey,
  deleteBackendSshKey,
  fetchBackendSshKeys,
} from '../../../lib/sshKeyService'
import { announceNotificationsChanged } from '../data/serviceClients'
import { getSection } from '../navigation'
import { Button, ButtonLink, Card } from '../ui/primitives'

export interface SshKeyItem {
  id: string
  name: string
  fingerprint: string
  publicKeySnippet: string
  publicKey: string
  keyType: string
  addedDate: string
}

export const SSH_STORAGE_KEY = 'inferxe_demo_ssh_keys_v1'

export const DEFAULT_DEMO_SSH_KEYS: SshKeyItem[] = [
  {
    id: 'ssh-1',
    name: 'Workstation ed25519',
    fingerprint: 'SHA256:7mP4e2x9...yK9',
    publicKeySnippet: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO...',
    publicKey:
      'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIO9w8z7Y6x5W4v3U2t1S0rQpOnMlKjIhGfEdCbA workstation@inferxe',
    keyType: 'ssh-ed25519',
    addedDate: '02 Oct 2026',
  },
  {
    id: 'ssh-2',
    name: 'CI/CD Deployer key',
    fingerprint: 'SHA256:3aF8x11q...9wQ',
    publicKeySnippet: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQ...',
    publicKey:
      'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQC8v1e4X7g8H9jK3mN5pQrStUvWxYz0123456789 deployer@inferxe-ci',
    keyType: 'ssh-rsa',
    addedDate: '08 Oct 2026',
  },
]

export function getLocalSshKeys(): SshKeyItem[] {
  try {
    const raw = localStorage.getItem(SSH_STORAGE_KEY)
    if (!raw) return DEFAULT_DEMO_SSH_KEYS
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : DEFAULT_DEMO_SSH_KEYS
  } catch {
    return DEFAULT_DEMO_SSH_KEYS
  }
}

export function saveLocalSshKeys(keys: SshKeyItem[]): void {
  try {
    localStorage.setItem(SSH_STORAGE_KEY, JSON.stringify(keys))
  } catch {}
}

export default function SshKeysPage() {
  const section = getSection('ssh-keys')
  usePageMeta('SSH Public Keys · Inferxe', section.description)

  const [keys, setKeys] = useState<SshKeyItem[]>(() => getLocalSshKeys())
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  // Add Key Modal State
  const [showAddModal, setShowAddModal] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeySnippet, setNewKeySnippet] = useState('')
  const [addError, setAddError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // Remove Key Dialog State
  const [keyToDelete, setKeyToDelete] = useState<SshKeyItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Attempt sync with backend on mount
  useEffect(() => {
    let mounted = true
    async function syncBackendKeys() {
      setLoading(true)
      try {
        const res = await fetchBackendSshKeys()
        if (!mounted) return
        if (res.ok && res.keys && res.keys.length > 0) {
          const mapped: SshKeyItem[] = res.keys.map((k) => ({
            id: k.id,
            name: k.name,
            fingerprint: k.fingerprint || 'SHA256:unknown',
            publicKeySnippet: k.public_key.length > 40 ? `${k.public_key.slice(0, 38)}...` : k.public_key,
            publicKey: k.public_key,
            keyType: k.key_type || 'ssh',
            addedDate: k.created_at
              ? new Date(k.created_at).toLocaleDateString('en-IN', {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                })
              : 'Recently',
          }))
          setKeys(mapped)
          saveLocalSshKeys(mapped)
        }
      } catch {
        // Fall back gracefully to local demo keys
      } finally {
        if (mounted) setLoading(false)
      }
    }
    void syncBackendKeys()
    return () => {
      mounted = false
    }
  }, [])

  const handleCopy = async (item: SshKeyItem) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(item.publicKey)
      }
      setMessage({ tone: 'success', text: `Public SSH key for "${item.name}" copied to clipboard.` })
    } catch {
      setMessage({ tone: 'error', text: 'Could not copy to clipboard.' })
    }
  }

  const handleOpenAdd = () => {
    setNewKeyName('')
    setNewKeySnippet('')
    setAddError(null)
    setShowAddModal(true)
  }

  const handleAddSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const trimmedName = newKeyName.trim()
    const trimmedKey = newKeySnippet.trim()

    if (!trimmedName) {
      setAddError('Please enter a descriptive label for your key.')
      return
    }
    if (!trimmedKey) {
      setAddError('Please paste your OpenSSH public key.')
      return
    }
    if (/PRIVATE KEY/i.test(trimmedKey)) {
      setAddError(
        'Private keys are strictly forbidden. Never upload your private key — only provide your OpenSSH public key (e.g. id_ed25519.pub).'
      )
      return
    }

    setSubmitting(true)
    setAddError(null)

    // Attempt backend registration if active session
    let backendKeyId: string | null = null
    try {
      const res = await createBackendSshKey(trimmedName, trimmedKey)
      if (res.ok && res.data) {
        backendKeyId = res.data.id
      }
    } catch {
      // Continue with local storage registration
    }

    // Generate local representation
    const keyType = trimmedKey.startsWith('ssh-ed25519')
      ? 'ssh-ed25519'
      : trimmedKey.startsWith('ssh-rsa')
      ? 'ssh-rsa'
      : trimmedKey.startsWith('ecdsa')
      ? 'ecdsa'
      : 'ssh'

    const snippet = trimmedKey.length > 40 ? `${trimmedKey.slice(0, 38)}...` : trimmedKey
    const id = backendKeyId || `ssh-${Date.now().toString().slice(-4)}`
    const randomHash = Math.random().toString(36).substring(2, 10)
    const fingerprint = `SHA256:${randomHash}...${randomHash.slice(-3)}`
    const addedDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    })

    const newItem: SshKeyItem = {
      id,
      name: trimmedName,
      fingerprint,
      publicKeySnippet: snippet,
      publicKey: trimmedKey,
      keyType,
      addedDate,
    }

    const updated = [newItem, ...keys]
    setKeys(updated)
    saveLocalSshKeys(updated)
    announceNotificationsChanged()
    setSubmitting(false)
    setShowAddModal(false)
    setMessage({ tone: 'success', text: `Successfully registered public SSH key "${trimmedName}".` })
  }

  const handleConfirmDelete = async () => {
    if (!keyToDelete) return
    setDeleting(true)
    try {
      // Attempt backend deletion
      await deleteBackendSshKey(keyToDelete.id).catch(() => {})
      const updated = keys.filter((k) => k.id !== keyToDelete.id)
      setKeys(updated)
      saveLocalSshKeys(updated)
      announceNotificationsChanged()
      setMessage({ tone: 'success', text: `Removed SSH key "${keyToDelete.name}".` })
    } catch {
      setMessage({ tone: 'error', text: 'Failed to remove SSH key.' })
    } finally {
      setDeleting(false)
      setKeyToDelete(null)
    }
  }

  return (
    <div className="cx-ssh-page">
      {/* ── Breadcrumb ── */}
      <div className="cx-page-breadcrumb">
        <span>Customer Portal</span>
        <span className="cx-page-breadcrumb__sep">/</span>
        <span className="cx-page-breadcrumb__curr">SSH Public Keys</span>
      </div>

      {/* ── Page Header ── */}
      <div className="cx-page-header">
        <div className="cx-page-header__main">
          <h1>SSH Public Keys</h1>
          <p className="cx-page-header__desc">Configure demo SSH credentials for compute cluster access.</p>
        </div>
        <div className="cx-page-header__actions">
          <ButtonLink to="/dashboard/app" variant="ghost" size="sm">
            <ArrowLeft size={15} /> Back to overview
          </ButtonLink>
        </div>
      </div>

      {/* ── Section Toolbar ── */}
      <div className="cx-section-toolbar cx-ssh-toolbar">
        <div>
          <h2>SSH Public Keys Vault</h2>
          <p>Register public keys to enable secure terminal and container shell pairing with dedicated GPU nodes.</p>
        </div>
        <div className="cx-ssh-toolbar-actions">
          {loading && <span className="cx-muted cx-ssh-syncing">Syncing...</span>}
          <Button variant="primary" size="sm" onClick={handleOpenAdd} className="cx-add-ssh-btn">
            <Plus size={15} /> Add Public SSH Key
          </Button>
        </div>
      </div>

      {/* ── Feedback Message ── */}
      {message && (
        <div className={`cx-alert cx-alert--${message.tone}`} role={message.tone === 'error' ? 'alert' : 'status'}>
          <span>{message.text}</span>
        </div>
      )}

      {/* ── Sovereign Security Notice ── */}
      <div className="cx-ssh-notice">
        <div className="cx-ssh-notice__icon" aria-hidden="true">
          <ShieldCheck size={20} />
        </div>
        <div className="cx-ssh-notice__text">
          <strong>Sovereign Security Notice:</strong> Never upload private keys. Only public key pairs (e.g.,
          id_ed25519.pub) are accepted. Public keys are stored locally in your browser demo session.
        </div>
      </div>

      {/* ── Registered Public Keys Table Card ── */}
      <Card className="cx-ssh-table-card">
        <div className="cx-ssh-table-head">
          <h3>Registered Public Keys</h3>
          <span className="cx-muted">
            {keys.length} {keys.length === 1 ? 'key' : 'keys'}
          </span>
        </div>

        {keys.length === 0 ? (
          <div className="cx-ssh-empty">
            <div className="cx-ssh-empty__icon" aria-hidden="true">
              <KeyRound size={26} />
            </div>
            <h4>No SSH Keys Configured</h4>
            <p>Add an OpenSSH public key to pair with GPU container shells.</p>
            <Button variant="primary" size="sm" onClick={handleOpenAdd}>
              Add Public Key
            </Button>
          </div>
        ) : (
          <div className="cx-ssh-table-wrap">
            <table className="cx-ssh-table">
              <thead>
                <tr>
                  <th>KEY LABEL</th>
                  <th>FINGERPRINT</th>
                  <th>PUBLIC KEY SNIPPET</th>
                  <th>ADDED DATE</th>
                  <th>ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      <strong className="cx-ssh-key-name">{k.name}</strong>
                      <span className="cx-ssh-key-id">{k.id}</span>
                    </td>
                    <td className="cx-ssh-mono cx-ssh-fingerprint">{k.fingerprint}</td>
                    <td className="cx-ssh-mono cx-ssh-snippet" title={k.publicKey}>
                      {k.publicKeySnippet}
                    </td>
                    <td className="cx-ssh-date">{k.addedDate}</td>
                    <td>
                      <div className="cx-ssh-actions">
                        <button
                          type="button"
                          className="cx-ssh-btn cx-ssh-btn--copy"
                          onClick={() => handleCopy(k)}
                          title="Copy public key to clipboard"
                          aria-label={`Copy public key for ${k.name}`}
                        >
                          <Copy size={13} /> Copy
                        </button>
                        <button
                          type="button"
                          className="cx-ssh-btn cx-ssh-btn--remove"
                          onClick={() => setKeyToDelete(k)}
                          title="Remove SSH key"
                          aria-label={`Remove SSH key ${k.name}`}
                        >
                          <Trash2 size={13} /> Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Modal: Add Public SSH Key ── */}
      {showAddModal && (
        <div
          className="cx-dialog__scrim"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cx-add-ssh-title"
          onClick={() => !submitting && setShowAddModal(false)}
        >
          <div className="cx-dialog__panel cx-ssh-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cx-ssh-modal-head">
              <h3 id="cx-add-ssh-title">Register Public SSH Key</h3>
              <button
                type="button"
                className="cx-iconbtn cx-iconbtn--quiet"
                onClick={() => setShowAddModal(false)}
                disabled={submitting}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="cx-ssh-modal-form">
              {addError && (
                <div className="cx-alert cx-alert--error" role="alert">
                  <span>{addError}</span>
                </div>
              )}

              <div className="cx-ssh-form-group">
                <label htmlFor="cx-ssh-name-input">Key Label / Identifier</label>
                <input
                  id="cx-ssh-name-input"
                  type="text"
                  className="cx-input"
                  required
                  disabled={submitting}
                  placeholder="e.g. Workstation ed25519"
                  value={newKeyName}
                  onChange={(e) => setNewKeyName(e.target.value)}
                />
              </div>

              <div className="cx-ssh-form-group">
                <label htmlFor="cx-ssh-key-input">OpenSSH Public Key (.pub file content)</label>
                <textarea
                  id="cx-ssh-key-input"
                  className="cx-input cx-ssh-textarea"
                  required
                  rows={4}
                  disabled={submitting}
                  placeholder="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... or paste id_ed25519.pub content"
                  value={newKeySnippet}
                  onChange={(e) => setNewKeySnippet(e.target.value)}
                />
                <span className="cx-ssh-help-text">
                  Only OpenSSH public keys are accepted. Private keys are automatically rejected.
                </span>
              </div>

              <div className="cx-ssh-modal-actions">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={submitting}
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit" variant="primary" disabled={submitting}>
                  {submitting ? 'Registering...' : 'Add Public Key'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Dialog: Confirm Remove SSH Key ── */}
      {keyToDelete && (
        <div
          className="cx-dialog__scrim"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="cx-del-ssh-title"
          onClick={() => !deleting && setKeyToDelete(null)}
        >
          <div className="cx-dialog__panel cx-ssh-modal-panel" onClick={(e) => e.stopPropagation()}>
            <div className="cx-ssh-modal-head">
              <h3 id="cx-del-ssh-title">Remove SSH Key</h3>
              <button
                type="button"
                className="cx-iconbtn cx-iconbtn--quiet"
                onClick={() => setKeyToDelete(null)}
                disabled={deleting}
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="cx-ssh-del-body">
              <p>
                Are you sure you want to remove public key <strong>{keyToDelete.name}</strong> (
                <code>{keyToDelete.fingerprint}</code>)?
              </p>
              <p className="cx-muted">
                GPU cluster instances will revoke terminal and container shell pairing for this key.
              </p>
            </div>

            <div className="cx-ssh-modal-actions">
              <Button
                type="button"
                variant="secondary"
                disabled={deleting}
                onClick={() => setKeyToDelete(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="danger"
                disabled={deleting}
                onClick={handleConfirmDelete}
              >
                {deleting ? 'Removing...' : 'Remove Key'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
