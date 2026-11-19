/**
 * Settings — the signed-in customer's profile, security, organization and account status.
 * - Display name: PATCH /api/customer/profile (Node customer API)
 * - Password:     existing Cognito utility `changeUserPassword` (Amplify updatePassword)
 * Internal identifiers (user id, organization id, slug, billing email) are never displayed.
 */
import { useEffect, useState, type FormEvent } from 'react'
import { Building2, KeyRound, LogOut, ShieldCheck, UserRound } from 'lucide-react'
import { changeUserPassword } from '../../../lib/authStore'
import { usePageMeta } from '../../../lib/hooks'
import { CustomerApiError } from '../data/http'
import { DISPLAY_NAME_MAX, updateDisplayName } from '../data/serviceClients'
import { formatDate, formatInteger, humaniseCode, selectProfileSummary, toFiniteNumber } from '../data/selectors'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import { getSection } from '../navigation'
import { signOutToLogin } from '../shell/CustomerShell'
import { Field, InlineStatus, TextInput } from '../ui/controls'
import { Button, Card, CardHeader, PageHeader, StatusPill } from '../ui/primitives'
import { ErrorState, LoadingBlock } from '../ui/states'

const PASSWORD_MIN = 8 // enforced by the existing changeUserPassword utility

function ProfileCard() {
  const { workspace, refresh } = useCustomerWorkspace()
  const profile = workspace ? selectProfileSummary(workspace) : null
  const savedName = workspace?.profile.full_name ?? ''
  const [name, setName] = useState(savedName)
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  useEffect(() => setName(savedName), [savedName])

  const trimmed = name.trim()
  const invalid = trimmed.length === 0 ? 'Display name cannot be empty.' : trimmed.length > DISPLAY_NAME_MAX ? `Use ${DISPLAY_NAME_MAX} characters or fewer.` : null
  const dirty = trimmed !== savedName.trim()

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (invalid || !dirty) return
    setSaving(true)
    setResult(null)
    try {
      await updateDisplayName(trimmed)
      setResult({ tone: 'success', text: 'Display name updated.' })
      refresh()
    } catch (err) {
      setResult({ tone: 'error', text: err instanceof CustomerApiError ? err.message : 'Your display name could not be updated.' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card aria-labelledby="cx-profile-title">
      <CardHeader id="cx-profile-title" title={<span className="cx-title-icon"><UserRound size={17} aria-hidden="true" /> Profile</span>} description="How you appear across the Inferxe console" />
      {!profile ? (
        <LoadingBlock lines={3} label="Loading profile" />
      ) : (
        <form className="cx-form" onSubmit={submit} noValidate>
          <Field label="Display name" error={dirty ? invalid : null} hint="Shown in the console and on your organization.">
            {({ inputId, describedBy, invalid: isInvalid }) => (
              <TextInput
                id={inputId}
                value={name}
                onChange={(e) => { setName(e.target.value); setResult(null) }}
                maxLength={DISPLAY_NAME_MAX}
                autoComplete="name"
                aria-describedby={describedBy}
                aria-invalid={isInvalid}
              />
            )}
          </Field>
          <Field label="Email" hint="Your sign-in email is managed by your Inferxe account and cannot be changed here.">
            {({ inputId, describedBy }) => (
              <TextInput id={inputId} value={profile.email ?? ''} readOnly aria-describedby={describedBy} />
            )}
          </Field>
          {result ? <InlineStatus tone={result.tone}>{result.text}</InlineStatus> : null}
          <div className="cx-form__actions">
            <Button variant="primary" type="submit" disabled={saving || !dirty || Boolean(invalid)}>
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </div>
        </form>
      )}
    </Card>
  )
}

function PasswordCard() {
  const { workspace } = useCustomerWorkspace()
  const email = workspace?.profile.email ?? ''
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)

  const mismatch = confirm.length > 0 && next !== confirm ? 'The new passwords do not match.' : null
  const tooShort = next.length > 0 && next.length < PASSWORD_MIN ? `Use at least ${PASSWORD_MIN} characters.` : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !next || mismatch || tooShort) {
      setResult({ tone: 'error', text: mismatch ?? tooShort ?? 'Fill in all password fields.' })
      return
    }
    setSaving(true)
    setResult(null)
    const outcome = await changeUserPassword(email, current, next)
    setSaving(false)
    // Passwords are cleared from component state after every attempt.
    setCurrent('')
    setNext('')
    setConfirm('')
    setResult(outcome.ok ? { tone: 'success', text: 'Password changed. Use your new password next time you sign in.' } : { tone: 'error', text: outcome.error ?? 'Your password could not be changed.' })
  }

  return (
    <Card aria-labelledby="cx-password-title">
      <CardHeader id="cx-password-title" title={<span className="cx-title-icon"><KeyRound size={17} aria-hidden="true" /> Password</span>} description="Change the password you use to sign in" />
      <form className="cx-form" onSubmit={submit} noValidate>
        <Field label="Current password">
          {({ inputId }) => <TextInput id={inputId} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}
        </Field>
        <Field label="New password" error={tooShort} hint={`At least ${PASSWORD_MIN} characters. Your account's password policy may require more.`}>
          {({ inputId, describedBy, invalid }) => (
            <TextInput id={inputId} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        <Field label="Confirm new password" error={mismatch}>
          {({ inputId, describedBy, invalid }) => (
            <TextInput id={inputId} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-describedby={describedBy} aria-invalid={invalid} />
          )}
        </Field>
        {result ? <InlineStatus tone={result.tone}>{result.text}</InlineStatus> : null}
        <div className="cx-form__actions">
          <Button variant="primary" type="submit" disabled={saving || !email}>
            {saving ? 'Updating…' : 'Update password'}
          </Button>
        </div>
      </form>
    </Card>
  )
}

function OrganizationCard() {
  const { workspace } = useCustomerWorkspace()
  const profile = workspace ? selectProfileSummary(workspace) : null
  const org = profile?.organization ?? null
  return (
    <Card aria-labelledby="cx-org-title">
      <CardHeader id="cx-org-title" title={<span className="cx-title-icon"><Building2 size={17} aria-hidden="true" /> Organization</span>} description="Read-only" />
      {!workspace ? (
        <LoadingBlock lines={3} label="Loading organization" />
      ) : !org ? (
        <p className="cx-muted">Your account is not linked to an organization yet.</p>
      ) : (
        <dl className="cx-kv">
          <dt>Name</dt>
          <dd>{org.name}</dd>
          <dt>Status</dt>
          <dd>{org.status ? <StatusPill tone={org.status.toLowerCase() === 'active' ? 'success' : 'warning'} dot>{humaniseCode(org.status)}</StatusPill> : '—'}</dd>
          <dt>Created</dt>
          <dd>{formatDate(org.created_at)}</dd>
        </dl>
      )}
      <p className="cx-footnote">Team membership and roles cannot be managed from the console yet.</p>
    </Card>
  )
}

function AccountCard() {
  const { workspace } = useCustomerWorkspace()
  const profile = workspace ? selectProfileSummary(workspace) : null
  const policy = workspace?.user_access_policies[0] ?? null
  const spendLimit = toFiniteNumber(policy?.monthly_spend_limit)
  const rateLimit = toFiniteNumber(policy?.rate_limit)
  const [signingOut, setSigningOut] = useState(false)

  return (
    <Card aria-labelledby="cx-account-title">
      <CardHeader id="cx-account-title" title={<span className="cx-title-icon"><ShieldCheck size={17} aria-hidden="true" /> Account</span>} description="Status and access" />
      {!profile ? (
        <LoadingBlock lines={3} label="Loading account" />
      ) : (
        <dl className="cx-kv">
          <dt>Status</dt>
          <dd>
            <StatusPill tone={profile.isActive ? 'success' : 'warning'} dot>
              {profile.isActive ? 'Active' : humaniseCode(profile.status) || 'Inactive'}
            </StatusPill>
          </dd>
          <dt>Account type</dt>
          <dd>Customer</dd>
          <dt>Access limits</dt>
          <dd>
            {!policy
              ? 'Default limits — no custom limits are configured'
              : [
                  spendLimit !== null ? `Monthly spend limit ${formatInteger(spendLimit)}` : null,
                  rateLimit !== null ? `Rate limit ${formatInteger(rateLimit)}` : null,
                ].filter(Boolean).join(' · ') || 'Custom policy without numeric limits'}
          </dd>
        </dl>
      )}
      <div className="cx-form__actions cx-form__actions--start">
        <Button
          variant="danger"
          disabled={signingOut}
          onClick={() => {
            setSigningOut(true)
            void signOutToLogin()
          }}
        >
          <LogOut size={15} /> {signingOut ? 'Signing out…' : 'Sign out'}
        </Button>
      </div>
    </Card>
  )
}

export default function SettingsPage() {
  const section = getSection('settings')
  usePageMeta(section.label, section.description)
  const { state, workspace, refresh } = useCustomerWorkspace()

  return (
    <>
      <PageHeader
        title="Settings"
        description="Manage your profile and security. Organization details are read-only."
      />
      {state.status === 'error' && !workspace ? (
        <Card>
          <ErrorState error={state.error} onRetry={refresh} onSignIn={() => void signOutToLogin()} what="your settings" />
        </Card>
      ) : (
        <div className="cx-grid cx-grid--2">
          <ProfileCard />
          <PasswordCard />
          <OrganizationCard />
          <AccountCard />
        </div>
      )}
    </>
  )
}
