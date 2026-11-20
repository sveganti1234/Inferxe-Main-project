import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CircleDollarSign,
  Database,
  Info,
  Lock,
  ShieldCheck,
} from 'lucide-react'
import type {
  GpuHourlyRateTarget,
  GpuHourlyRateUpdateRequest,
  GpuHourlyRateUpdateResult,
  InfrastructureDataSource,
} from '../../lib/gpuInfrastructureService'

export interface GpuHourlyRateEditorProps {
  targets: GpuHourlyRateTarget[]
  isSuperAdmin: boolean
  persistenceAvailable: boolean
  pendingMessage: string
  plannedEndpoint?: string
  dataSource: InfrastructureDataSource
  onSubmitRateChange: (req: GpuHourlyRateUpdateRequest) => Promise<GpuHourlyRateUpdateResult>
}

export function GpuHourlyRateEditor({
  targets,
  isSuperAdmin,
  persistenceAvailable,
  pendingMessage,
  plannedEndpoint,
  dataSource,
  onSubmitRateChange,
}: GpuHourlyRateEditorProps) {
  const [selectedTargetId, setSelectedTargetId] = useState<string>(() => targets[0]?.id ?? '')
  const [rateInput, setRateInput] = useState<string>(() =>
    targets[0] ? String(targets[0].currentSpotRate) : '',
  )
  const [reason, setReason] = useState<string>('')
  const [submitting, setSubmitting] = useState<boolean>(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null)

  const selectedTarget = useMemo(
    () => targets.find((t) => t.id === selectedTargetId) ?? targets[0] ?? null,
    [targets, selectedTargetId],
  )

  useEffect(() => {
    if (!selectedTarget) return
    if (selectedTarget.id !== selectedTargetId) {
      setSelectedTargetId(selectedTarget.id)
      setRateInput(String(selectedTarget.currentSpotRate))
    }
  }, [selectedTarget, selectedTargetId])

  const handleTargetChange = (nextId: string) => {
    setSelectedTargetId(nextId)
    const found = targets.find((t) => t.id === nextId)
    if (found) {
      setRateInput(String(found.currentSpotRate))
    }
    setFeedbackError(null)
    setFeedbackSuccess(null)
  }

  const parsedRate = Number(rateInput)
  const isRateValid =
    rateInput.trim() !== '' && Number.isFinite(parsedRate) && parsedRate > 0
  const isReasonValid = reason.trim().length >= 5
  const isSameRate = selectedTarget ? parsedRate === selectedTarget.currentSpotRate : false

  const rateDelta =
    selectedTarget && isRateValid ? parsedRate - selectedTarget.currentSpotRate : null
  const rateDeltaPct =
    selectedTarget && rateDelta !== null && selectedTarget.currentSpotRate > 0
      ? ((rateDelta / selectedTarget.currentSpotRate) * 100).toFixed(1)
      : null

  const canSubmit =
    isSuperAdmin &&
    persistenceAvailable &&
    Boolean(selectedTarget) &&
    isRateValid &&
    !isSameRate &&
    isReasonValid &&
    !submitting

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setFeedbackError(null)
    setFeedbackSuccess(null)

    if (!isSuperAdmin) {
      setFeedbackError('Only Super Admin accounts can modify global GPU hourly pricing.')
      return
    }
    if (!persistenceAvailable) {
      setFeedbackError(pendingMessage)
      return
    }
    if (!selectedTarget) {
      setFeedbackError('Select a GPU listing before submitting a pricing update.')
      return
    }
    if (!isRateValid) {
      setFeedbackError('Enter a valid positive hourly rate greater than ₹0.')
      return
    }
    if (isSameRate) {
      setFeedbackError('New hourly rate must differ from the current rate.')
      return
    }
    if (!isReasonValid) {
      setFeedbackError('Provide an audit reason of at least 5 characters.')
      return
    }

    setSubmitting(true)
    try {
      const res = await onSubmitRateChange({
        targetId: selectedTarget.id,
        clusterId: selectedTarget.clusterId,
        gpuModel: selectedTarget.gpuModel,
        newHourlyRate: parsedRate,
        reason: reason.trim(),
      })

      if (res.ok) {
        setFeedbackSuccess(
          res.message ||
            `Updated ${selectedTarget.gpuModel} hourly rate to ₹${parsedRate}/hr.`,
        )
        setReason('')
      } else {
        setFeedbackError(res.error || 'Failed to persist GPU pricing update.')
      }
    } catch (err) {
      setFeedbackError(
        err instanceof Error ? err.message : 'Unexpected error submitting GPU pricing update.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      style={{
        background: '#0F1612',
        border: '1px solid #1B2E24',
        borderRadius: '12px',
        padding: '22px 24px',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <CircleDollarSign size={18} style={{ color: '#FBBF24' }} />
            <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: '#FFFFFF' }}>
              GPU Hourly Rate Editor
            </h2>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '2px 8px',
                borderRadius: '999px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.64rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                background: 'rgba(251, 191, 36, 0.14)',
                color: '#FBBF24',
                border: '1px solid rgba(251, 191, 36, 0.35)',
              }}
            >
              <ShieldCheck size={10} />
              Super Admin Only
            </span>
            {dataSource === 'demo' && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                  padding: '2px 8px',
                  borderRadius: '999px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.64rem',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  background: 'rgba(245, 158, 11, 0.14)',
                  color: '#F59E0B',
                  border: '1px solid rgba(245, 158, 11, 0.35)',
                }}
              >
                <Database size={10} />
                DEMO DATA
              </span>
            )}
          </div>
          <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: '#9CA3AF' }}>
            Govern global hourly GPU spot pricing with strict validation and mandatory audit reasons.
          </p>
        </div>
      </div>

      {/* Standard Admin Read-Only Gate */}
      {!isSuperAdmin ? (
        <div
          role="status"
          style={{
            background: 'rgba(148, 163, 184, 0.08)',
            border: '1px solid rgba(148, 163, 184, 0.24)',
            borderRadius: '10px',
            padding: '16px 18px',
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            color: '#D1D5DB',
            fontSize: '0.84rem',
          }}
        >
          <Lock size={18} style={{ color: '#9CA3AF', flexShrink: 0 }} />
          <div>
            <div style={{ fontWeight: 600, color: '#FFFFFF' }}>Read-Only Access</div>
            <div style={{ marginTop: 2, color: '#9CA3AF', fontSize: '0.8rem' }}>
              Standard Admin accounts can inspect current GPU rates but cannot modify global hourly pricing. Sign in with a Super Admin account to manage pricing.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Pending Backend Persistence Disclosure */}
          {!persistenceAvailable && (
            <div
              role="status"
              style={{
                background: 'rgba(245, 158, 11, 0.08)',
                border: '1px solid rgba(245, 158, 11, 0.35)',
                borderRadius: '10px',
                padding: '12px 16px',
                marginBottom: '16px',
                display: 'flex',
                alignItems: 'flex-start',
                gap: '10px',
                fontSize: '0.8rem',
                color: '#FDE68A',
              }}
            >
              <Info size={16} style={{ color: '#F59E0B', flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontWeight: 700, color: '#FFFFFF' }}>
                  Backend Pricing Persistence Pending (Phase 3)
                </div>
                <div style={{ marginTop: 2, color: '#D1D5DB', lineHeight: 1.45 }}>
                  {pendingMessage}
                  {plannedEndpoint && (
                    <>
                      {' '}
                      Target contract:{' '}
                      <code style={{ fontFamily: 'var(--font-mono)', color: '#FBBF24' }}>
                        {plannedEndpoint}
                      </code>
                      .
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {feedbackError && (
            <div
              role="alert"
              style={{
                background: '#2B1214',
                border: '1px solid #7F1D1D',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '14px',
                color: '#FCA5A5',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <AlertCircle size={15} />
              <span>{feedbackError}</span>
            </div>
          )}

          {feedbackSuccess && (
            <div
              role="status"
              style={{
                background: '#0D2818',
                border: '1px solid #10B981',
                borderRadius: '8px',
                padding: '10px 14px',
                marginBottom: '14px',
                color: '#6EE7B7',
                fontSize: '0.82rem',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <CheckCircle2 size={15} />
              <span>{feedbackSuccess}</span>
            </div>
          )}

          {targets.length === 0 ? (
            <div
              style={{
                padding: '24px',
                textAlign: 'center',
                borderRadius: '8px',
                border: '1px dashed #23382C',
                color: '#9CA3AF',
                fontSize: '0.82rem',
              }}
            >
              No GPU inventory listings available to edit.
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                  gap: '14px',
                  marginBottom: '14px',
                }}
              >
                {/* GPU Target Selector */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontWeight: 600 }}>
                    GPU Target (Provider · Region)
                  </span>
                  <select
                    value={selectedTarget?.id ?? ''}
                    onChange={(e) => handleTargetChange(e.target.value)}
                    style={{
                      background: '#121C16',
                      border: '1px solid #23382C',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: '#FFFFFF',
                      fontSize: '0.82rem',
                      outline: 'none',
                    }}
                  >
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.gpuModel} · {t.provider} ({t.region}) — ₹{t.currentSpotRate}/hr
                      </option>
                    ))}
                  </select>
                </label>

                {/* New Hourly Rate */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontWeight: 600 }}>
                    New Hourly Rate (₹/hr)
                  </span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={rateInput}
                    onChange={(e) => {
                      setRateInput(e.target.value)
                      setFeedbackError(null)
                      setFeedbackSuccess(null)
                    }}
                    placeholder="Enter positive rate in INR"
                    style={{
                      background: '#121C16',
                      border: `1px solid ${!isRateValid && rateInput !== '' ? '#EF4444' : '#23382C'}`,
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: '#FFFFFF',
                      fontSize: '0.84rem',
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                    }}
                  />
                  {!isRateValid && rateInput !== '' ? (
                    <span style={{ fontSize: '0.7rem', color: '#FCA5A5' }}>
                      Rate must be a positive number greater than ₹0.
                    </span>
                  ) : selectedTarget && rateDelta !== null && rateDelta !== 0 ? (
                    <span
                      style={{
                        fontSize: '0.7rem',
                        fontFamily: 'var(--font-mono)',
                        color: rateDelta > 0 ? '#FBBF24' : '#6EE7B7',
                      }}
                    >
                      ₹{selectedTarget.currentSpotRate}/hr → ₹{parsedRate}/hr (
                      {rateDelta > 0 ? `+${rateDeltaPct}%` : `${rateDeltaPct}%`})
                    </span>
                  ) : (
                    <span style={{ fontSize: '0.7rem', color: '#9CA3AF' }}>
                      Current spot: ₹{selectedTarget?.currentSpotRate ?? '—'}/hr · On-demand: ₹
                      {selectedTarget?.currentOnDemandRate ?? '—'}/hr
                    </span>
                  )}
                </label>

                {/* Mandatory Audit Reason */}
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <span style={{ fontSize: '0.74rem', color: '#9CA3AF', fontWeight: 600 }}>
                    Mandatory Audit Reason (min. 5 characters)
                  </span>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => {
                      setReason(e.target.value)
                      setFeedbackError(null)
                      setFeedbackSuccess(null)
                    }}
                    placeholder="e.g. Q4 sovereign cluster cost adjustment"
                    style={{
                      background: '#121C16',
                      border: '1px solid #23382C',
                      borderRadius: '8px',
                      padding: '9px 12px',
                      color: '#FFFFFF',
                      fontSize: '0.82rem',
                      outline: 'none',
                    }}
                  />
                </label>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '12px',
                  paddingTop: '10px',
                  borderTop: '1px solid #15241C',
                }}
              >
                <span style={{ fontSize: '0.74rem', color: '#9CA3AF' }}>
                  {persistenceAvailable
                    ? 'Pricing updates are written to the catalog and logged in audit_logs.'
                    : 'Saving is disabled until the Phase 3 backend pricing persistence endpoint is available.'}
                </span>

                <button
                  type="submit"
                  disabled={!canSubmit}
                  title={
                    !persistenceAvailable
                      ? 'Disabled: backend pricing persistence is pending Phase 3'
                      : !isRateValid
                        ? 'Enter a valid positive hourly rate'
                        : isSameRate
                          ? 'Enter a rate different from the current rate'
                          : !isReasonValid
                            ? 'Provide an audit reason of at least 5 characters'
                            : 'Save updated hourly rate'
                  }
                  style={{
                    background: canSubmit ? '#10B981' : '#1F2E26',
                    color: canSubmit ? '#040D08' : '#6B7280',
                    border: `1px solid ${canSubmit ? '#10B981' : '#23382C'}`,
                    borderRadius: '8px',
                    padding: '9px 16px',
                    fontSize: '0.82rem',
                    fontWeight: 700,
                    cursor: canSubmit ? 'pointer' : 'not-allowed',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '7px',
                  }}
                >
                  <CircleDollarSign size={14} />
                  <span>
                    {!persistenceAvailable
                      ? 'Save Unavailable (Backend Pending)'
                      : submitting
                        ? 'Saving Rate...'
                        : 'Save Hourly Rate'}
                  </span>
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  )
}

