import { useState } from 'react'
import { Check, Copy, KeyRound, Terminal, Zap } from 'lucide-react'
import { PageHero } from '../components/PageHero'
import { Plate } from '../components/ui/Glass'
import { LinkButton } from '../components/ui/Button'
import { usePageMeta } from '../lib/hooks'

// Mirrors the real contract in backend/inference (POST /api/v1/inference): prompt in, text + usage out. No streaming.
function snippets(endpoint: string) {
  return {
    curl: `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer $INFERXE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "prompt": "Explain tensor parallelism in two sentences.",
    "max_tokens": 300,
    "temperature": 0.2
  }'`,
    python: `import os
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
print(data["usage"])  # prompt_tokens, completion_tokens, total_tokens`,
    typescript: `const res = await fetch('${endpoint}', {
  method: 'POST',
  headers: {
    Authorization: \`Bearer \${process.env.INFERXE_API_KEY}\`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    prompt: 'Explain tensor parallelism in two sentences.',
    max_tokens: 300,
    temperature: 0.2,
  }),
})
if (!res.ok) throw new Error(\`Inference failed: \${res.status}\`)
const data = await res.json()
console.log(data.response, data.usage)`,
  }
}

export default function Developers() {
  usePageMeta('Developer Hub · Inference API', 'Call the Inferxe inference API over HTTPS with an Inferxe API key: send a prompt, get generated text and token usage back.')
  const [tab, setTab] = useState<'curl' | 'python' | 'typescript'>('curl')
  const [copied, setCopied] = useState(false)
  const SNIPPETS = snippets(`${window.location.origin}/api/v1/inference`)

  const handleCopy = () => {
    navigator.clipboard
      ?.writeText(SNIPPETS[tab])
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div className="inner-page">
      <PageHero
        crumb="Developers"
        eyebrow="Developer Hub"
        title={['One unified endpoint.', 'Zero provider lock-in.']}
        lead="A simple HTTPS inference endpoint authenticated with your Inferxe API key. Send a prompt, get generated text and exact token usage back."
        image="/images/enterprise.webp"
        actions={
          <div className="row row--wrap" style={{ gap: 12 }}>
            <LinkButton to="/dashboard/app/api-keys" arrow>
              Get API Key
            </LinkButton>
            <LinkButton to="/dashboard/app/models" variant="glass">
              Explore Models
            </LinkButton>
          </div>
        }
      />

      <section className="section">
        <div className="container">
          <div className="grid grid--2" style={{ gap: 24, alignItems: 'start' }}>
            {/* Left: Code Snippet Card */}
            <Plate style={{ padding: 24 }}>
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="row" style={{ gap: 8 }}>
                  <Terminal size={17} style={{ color: 'var(--brand-hi)' }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>
                    Quickstart SDK
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn--sm btn--glass"
                  onClick={handleCopy}
                  style={{ fontSize: '0.74rem' }}
                >
                  {copied ? <Check size={13} style={{ color: 'var(--brand-hi)' }} /> : <Copy size={13} />}
                  <span>{copied ? 'Copied' : 'Copy snippet'}</span>
                </button>
              </div>

              {/* Tabs */}
              <div className="dash-presets-row" style={{ marginTop: 0, marginBottom: 14 }}>
                {(['curl', 'python', 'typescript'] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`dash-preset-chip ${tab === t ? 'is-active' : ''}`}
                    aria-pressed={tab === t}
                    onClick={() => setTab(t)}
                  >
                    {t === 'curl' ? 'cURL' : t === 'python' ? 'Python' : 'TypeScript'}
                  </button>
                ))}
              </div>

              <pre
                style={{
                  background: 'var(--bg-0)',
                  border: '1px solid var(--line)',
                  borderRadius: 8,
                  padding: 16,
                  overflowX: 'auto',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.78rem',
                  lineHeight: 1.6,
                  color: 'var(--ink-2)',
                }}
              >
                <code>{SNIPPETS[tab]}</code>
              </pre>
            </Plate>

            {/* Right: API Architecture & Endpoints */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <Plate style={{ padding: 24 }}>
                <h3 className="h3" style={{ fontSize: '1.1rem', marginBottom: 8, color: 'var(--ink)' }}>
                  Endpoints Specification
                </h3>
                <p className="muted" style={{ fontSize: '0.84rem', marginBottom: 16 }}>
                  Plain JSON over HTTPS with <code>Authorization: Bearer &lt;your Inferxe API key&gt;</code>. It is not OpenAI-SDK compatible yet.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag" style={{ background: 'rgba(118,185,0,0.15)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>POST</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>/api/v1/inference</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>Body: <code>prompt</code>, optional <code>max_tokens</code> (1–4096) and <code>temperature</code> (0–2). Returns <code>response</code> and <code>usage</code>. The server picks the model; no streaming.</small>
                  </div>

                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag" style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4', borderColor: '#06b6d4' }}>GET</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>/api/v1/health</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>Service and model-provider health status.</small>
                  </div>

                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag">Planned</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>Chat completions, streaming, embeddings</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>OpenAI-compatible endpoints, token streaming, embeddings and JSON-schema output are on the roadmap and not available yet.</small>
                  </div>
                </div>
              </Plate>

              <div className="grid grid--2" style={{ gap: 12 }}>
                <Plate style={{ padding: 18 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Zap size={16} style={{ color: 'var(--brand-hi)' }} />
                    <strong style={{ fontSize: '0.84rem', color: 'var(--ink)' }}>Controlled overload</strong>
                  </div>
                  <p className="muted" style={{ fontSize: '0.74rem', margin: 0 }}>
                    At capacity, requests get HTTP 503 with a Retry-After header. No uptime SLA or automatic failover yet.
                  </p>
                </Plate>
                <Plate style={{ padding: 18 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <KeyRound size={16} style={{ color: 'var(--brand-hi)' }} />
                    <strong style={{ fontSize: '0.84rem', color: 'var(--ink)' }}>API key auth</strong>
                  </div>
                  <p className="muted" style={{ fontSize: '0.74rem', margin: 0 }}>
                    Create live or test keys in the console. A key is shown once and can be revoked at any time.
                  </p>
                </Plate>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
