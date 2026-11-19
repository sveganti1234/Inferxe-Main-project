/**
 * Inference playground — sends a real request to POST /api/v1/inference.
 *
 * Guarantees:
 *  - Disabled unless the public health endpoint reports the model provider as configured;
 *    health is re-checked immediately before every run.
 *  - Authenticates with one of the customer's own Inferxe API keys, held only in this
 *    component's state (never storage, never logged). There is deliberately no <form>, so
 *    browsers are not prompted to save it.
 *  - Sends only prompt / max_tokens / temperature. The backend currently chooses the model,
 *    and the page says so.
 *  - Shows only what the service returned. There is no demo mode and no simulated response.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { Eye, EyeOff, FlaskConical, Info, KeyRound, Play, RefreshCw, Square, Trash2 } from 'lucide-react'
import { usePageMeta } from '../../../lib/hooks'
import { fetchInferenceHealth } from '../data/serviceClients'
import { useAsyncResource } from '../data/useAsyncResource'
import { useCustomerWorkspace } from '../data/WorkspaceContext'
import {
  InferenceError,
  MAX_TOKENS_DEFAULT,
  MAX_TOKENS_MAX,
  MAX_TOKENS_MIN,
  PROMPT_MAX_CHARS,
  TEMPERATURE_DEFAULT,
  TEMPERATURE_MAX,
  TEMPERATURE_MIN,
  runInference,
  validateApiKeyInput,
  validatePrompt,
  type InferenceResult,
} from '../data/inference'
import { formatInteger } from '../data/selectors'
import { getSection, sectionHref } from '../navigation'
import { CopyButton, Field, InlineStatus, TextArea, TextInput } from '../ui/controls'
import { Button, ButtonLink, Card, CardHeader, Notice, PageHeader, StatusPill } from '../ui/primitives'

type Gate = { runnable: true } | { runnable: false; reason: string; tone: 'checking' | 'unavailable' | 'unknown' }

export default function PlaygroundPage() {
  const section = getSection('playground')
  usePageMeta(section.label, section.description)
  const { refresh: refreshWorkspace } = useCustomerWorkspace()
  const health = useAsyncResource(fetchInferenceHealth)

  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [maxTokensText, setMaxTokensText] = useState(String(MAX_TOKENS_DEFAULT))
  const [temperature, setTemperature] = useState(TEMPERATURE_DEFAULT)
  const [touched, setTouched] = useState({ key: false, prompt: false })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<InferenceResult | null>(null)
  const [error, setError] = useState<{ message: string; kind: InferenceError['kind'] | 'gate' } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Leaving the page cancels any in-flight request and drops the key, prompt and response with it.
  useEffect(() => () => abortRef.current?.abort(), [])

  const gate: Gate =
    health.state.status === 'loading' && !health.state.data
      ? { runnable: false, reason: 'Checking the inference service…', tone: 'checking' }
      : health.state.status === 'error'
        ? { runnable: false, reason: 'The inference service could not be reached, so running is disabled until it can be verified.', tone: 'unknown' }
        : health.state.data && !health.state.data.inferenceAvailable
          ? { runnable: false, reason: 'The model provider is not configured on the server, so inference is unavailable. Running is disabled.', tone: 'unavailable' }
          : { runnable: true }


  const maxTokens = Number(maxTokensText)
  const maxTokensValid = Number.isInteger(maxTokens) && maxTokens >= MAX_TOKENS_MIN && maxTokens <= MAX_TOKENS_MAX
  const keyProblem = validateApiKeyInput(apiKey)
  const promptProblem = validatePrompt(prompt)
  const ready = gate.runnable && !running && !keyProblem && !promptProblem && maxTokensValid

  const run = async () => {
    setTouched({ key: true, prompt: true })
    if (running || keyProblem || promptProblem || !maxTokensValid) return
    setRunning(true)
    setError(null)
    setNotice(null)
    setResult(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      // Fresh pre-flight: never send a request unless the provider is reported as configured right now.
      let current: Awaited<ReturnType<typeof fetchInferenceHealth>> | null = null
      try {
        current = await fetchInferenceHealth(controller.signal)
      } catch {
        current = null
      }
      if (controller.signal.aborted) throw new InferenceError('cancelled', 'The request was cancelled.')
      if (!current || !current.inferenceAvailable) {
        health.refresh()
        setError({
          kind: 'gate',
          message: current
            ? 'The model provider is not configured on the server, so the request was not sent.'
            : 'The inference service could not be verified, so the request was not sent.',
        })
        return
      }
      const outcome = await runInference({ apiKey, prompt, maxTokens, temperature, signal: controller.signal })
      setResult(outcome)
      refreshWorkspace() // the run is recorded in the customer's usage
    } catch (err) {
      if (err instanceof InferenceError && err.kind === 'cancelled') setNotice('The request was cancelled. Nothing was returned.')
      else if (err instanceof InferenceError) setError({ kind: err.kind, message: err.message })
      else setError({ kind: 'unexpected', message: 'Something went wrong while running the request.' })
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  const onPromptKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (ready) void run()
    }
  }

  const healthPill =
    health.state.status === 'loading' && !health.state.data ? (
      <StatusPill>Checking…</StatusPill>
    ) : gate.runnable ? (
      <StatusPill tone="success" dot>Online</StatusPill>
    ) : gate.tone === 'unavailable' ? (
      <StatusPill tone="warning" dot>Unavailable</StatusPill>
    ) : (
      <StatusPill>Unknown</StatusPill>
    )

  return (
    <>
      <PageHeader
        title="Inference playground"
        description="Send a prompt to the Inferxe inference API with one of your API keys."
      />

      <Notice icon={<Info size={17} />}>
        <strong>This runs on the live inference service.</strong> Requests use your API key and are recorded in your{' '}
        <Link to={sectionHref(getSection('usage'))}>usage</Link>. The model is chosen by the server — it cannot be selected here.
      </Notice>

      <div className="cx-playground">
        <div className="cx-stack">
          <Card aria-labelledby="cx-health-title">
            <div className="cx-health">
              <span className="cx-tile__icon" aria-hidden="true"><FlaskConical size={17} /></span>
              <div className="cx-health__text">
                <h2 className="cx-card__title" id="cx-health-title">Inference service</h2>
                <p className="cx-card__desc" role="status">
                  {gate.runnable
                    ? 'The model provider is configured. You can run requests.'
                    : gate.reason}
                </p>
              </div>
              {healthPill}
              <Button variant="ghost" size="sm" onClick={health.refresh} disabled={health.state.status === 'loading'} aria-label="Re-check inference service">
                <RefreshCw size={14} /> Re-check
              </Button>
            </div>
          </Card>

          <Card aria-labelledby="cx-run-title">
            <CardHeader id="cx-run-title" title="Request" description="Only the prompt, max tokens and temperature are sent." />
            <div className="cx-form">
              <Field
                label="Inferxe API key"
                error={touched.key && keyProblem ? keyProblem : null}
                hint="Paste one of your keys. It stays in memory on this page only and is never saved to your browser's storage."
              >
                {({ inputId, describedBy, invalid }) => (
                  <div className="cx-keyfield">
                    <TextInput
                      id={inputId}
                      type={showKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, key: true }))}
                      autoComplete="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      data-lpignore="true"
                      data-1p-ignore="true"
                      data-bwignore="true"
                      placeholder="inf_live_…"
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                    />
                    <Button variant="ghost" size="sm" onClick={() => setShowKey((s) => !s)} aria-label={showKey ? 'Hide API key' : 'Show API key'} aria-pressed={showKey}>
                      {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => { setApiKey(''); setShowKey(false); setTouched((t) => ({ ...t, key: false })) }} disabled={!apiKey} aria-label="Clear API key">
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
              </Field>
              <p className="cx-field__hint cx-keyhint">
                <KeyRound size={13} aria-hidden="true" /> Don’t have one? <Link to={sectionHref(getSection('api-keys'))}>Create an API key</Link>. Keys can only be copied when they are created.
              </p>

              <Field label="Model" hint="The backend currently chooses the model. It is reported with each response.">
                {({ inputId, describedBy }) => <TextInput id={inputId} value="Chosen by the server" readOnly aria-describedby={describedBy} />}
              </Field>

              <Field
                label="Prompt"
                error={touched.prompt && promptProblem ? promptProblem : null}
                hint={`${formatInteger(prompt.length)} / ${formatInteger(PROMPT_MAX_CHARS)} characters · Ctrl+Enter to run`}
              >
                {({ inputId, describedBy, invalid }) => (
                  <TextArea
                    id={inputId}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onBlur={() => setTouched((t) => ({ ...t, prompt: true }))}
                    onKeyDown={onPromptKeyDown}
                    rows={7}
                    maxLength={PROMPT_MAX_CHARS + 200}
                    placeholder="Explain tensor parallelism in two sentences."
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="cx-prompt"
                  />
                )}
              </Field>

              <div className="cx-params">
                <Field label="Max tokens" error={maxTokensValid ? null : `Whole number from ${MAX_TOKENS_MIN} to ${MAX_TOKENS_MAX}.`}>
                  {({ inputId, describedBy, invalid }) => (
                    <TextInput id={inputId} type="number" inputMode="numeric" min={MAX_TOKENS_MIN} max={MAX_TOKENS_MAX} step={1} value={maxTokensText} onChange={(e) => setMaxTokensText(e.target.value)} aria-describedby={describedBy} aria-invalid={invalid} />
                  )}
                </Field>
                <Field label={`Temperature · ${temperature.toFixed(1)}`} hint="Lower is more deterministic.">
                  {({ inputId, describedBy }) => (
                    <input id={inputId} className="cx-range" type="range" min={TEMPERATURE_MIN} max={TEMPERATURE_MAX} step={0.1} value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} aria-describedby={describedBy} />
                  )}
                </Field>
              </div>

              <div className="cx-form__actions cx-form__actions--between">
                <span className="cx-small cx-muted cx-gate" role="status">
                  {gate.runnable ? '' : gate.reason}
                </span>
                {running ? (
                  <Button variant="secondary" onClick={() => abortRef.current?.abort()}>
                    <Square size={14} /> Cancel
                  </Button>
                ) : null}
                <Button variant="primary" onClick={() => void run()} disabled={!ready}>
                  <Play size={15} /> {running ? 'Running…' : 'Run request'}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        <Card aria-labelledby="cx-response-title" className="cx-response-card">
          <CardHeader
            id="cx-response-title"
            title="Response"
            description="Exactly what the inference service returned"
            action={result ? <CopyButton text={result.text} label="Copy response" /> : undefined}
          />
          <div aria-live="polite" aria-busy={running}>
            {error ? (
              <InlineStatus tone="error">
                {error.message}
                {error.kind === 'invalid_key' ? (
                  <>
                    {' '}
                    <Link to={sectionHref(getSection('api-keys'))}>Manage your API keys</Link>.
                  </>
                ) : null}
              </InlineStatus>
            ) : null}
            {notice ? <InlineStatus tone="success">{notice}</InlineStatus> : null}
            {running ? (
              <p className="cx-response__empty">Waiting for the model… The first request can take a while. You can cancel at any time.</p>
            ) : result ? (
              <>
                <pre className="cx-response__text" tabIndex={0} aria-label="Model response">{result.text}</pre>
                <dl className="cx-kv cx-response__meta">
                  <dt>Model</dt>
                  <dd className="cx-mono">{result.model}</dd>
                  {result.provider ? (<><dt>Provider</dt><dd>{result.provider}</dd></>) : null}
                  <dt>Tokens</dt>
                  <dd>{formatInteger(result.promptTokens)} prompt · {formatInteger(result.completionTokens)} generated · {formatInteger(result.totalTokens)} total</dd>
                  <dt>Round trip</dt>
                  <dd>{formatInteger(result.roundTripMs)} ms <span className="cx-muted">(measured in your browser)</span></dd>
                </dl>
                <p className="cx-footnote">This request was recorded in your usage.</p>
              </>
            ) : !error && !notice ? (
              <p className="cx-response__empty">
                {gate.runnable
                  ? 'Run a request to see the model’s response here. Nothing is shown until the service answers.'
                  : 'Running is disabled while the inference service is unavailable. Nothing is simulated.'}
              </p>
            ) : null}
          </div>
          {!gate.runnable && gate.tone === 'unavailable' ? (
            <div className="cx-form__actions cx-form__actions--start">
              <ButtonLink to={sectionHref(getSection('models'))} variant="secondary" size="sm">Browse the model catalogue</ButtonLink>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  )
}
