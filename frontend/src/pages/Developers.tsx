import { useState } from 'react'
import { Check, Copy, KeyRound, Terminal, Zap } from 'lucide-react'
import { PageHero } from '../components/PageHero'
import { Plate } from '../components/ui/Glass'
import { LinkButton } from '../components/ui/Button'
import { usePageMeta } from '../lib/hooks'

const SNIPPETS = {
  curl: `curl https://api.inferxe.com/v1/chat/completions \\
  -H "Authorization: Bearer ix_live_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "qwen2.5-7b",
    "messages": [{"role": "user", "content": "Explain tensor parallelism."}],
    "temperature": 0.7,
    "stream": true
  }'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="https://api.inferxe.com/v1",
    api_key="ix_live_your_api_key",
)

response = client.chat.completions.create(
    model="llama-3.1-8b",
    messages=[{"role": "user", "content": "Optimize KV cache for 16k context."}],
    stream=True,
)

for chunk in response:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end="")`,
  typescript: `import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'https://api.inferxe.com/v1',
  apiKey: process.env.INFERXE_API_KEY,
})

async function main() {
  const stream = await client.chat.completions.create({
    model: 'deepseek-r1-671b',
    messages: [{ role: 'user', content: 'Design sovereign inference mesh' }],
    stream: true,
  })

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '')
  }
}

main()`,
}

export default function Developers() {
  usePageMeta('Developer Hub · Unified Inference API', 'Drop-in OpenAI SDK compatibility, low-latency streaming endpoints, and high-performance sovereign GPU placement.')
  const [tab, setTab] = useState<'curl' | 'python' | 'typescript'>('curl')
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard?.writeText(SNIPPETS[tab])
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="inner-page">
      <PageHero
        crumb="Developers"
        eyebrow="Developer Hub"
        title={['One unified endpoint.', 'Zero provider lock-in.']}
        lead="Standard OpenAI-compatible interface backed by intelligent GPU routing across sovereign Indian datacenters."
        image="/images/enterprise.webp"
        actions={
          <div className="row row--wrap" style={{ gap: 12 }}>
            <LinkButton to="/dashboard/api-keys" arrow>
              Get API Key
            </LinkButton>
            <LinkButton to="/dashboard/models" variant="glass">
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
                  Direct drop-in replacement for OpenAI SDKs — simply point your client to <code>https://api.inferxe.com/v1</code>.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag" style={{ background: 'rgba(118,185,0,0.15)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>POST</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>/v1/chat/completions</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>Streaming SSE tokens, reasoning delta blocks, JSON schema enforcement.</small>
                  </div>

                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag" style={{ background: 'rgba(6,182,212,0.15)', color: '#06b6d4', borderColor: '#06b6d4' }}>GET</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>/v1/models</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>List supported open-weights models and active sovereign placement routes.</small>
                  </div>

                  <div style={{ padding: '10px 14px', borderRadius: 8, background: 'var(--bg-2)', border: '1px solid var(--line)' }}>
                    <div className="row" style={{ gap: 8, marginBottom: 4 }}>
                      <span className="tag" style={{ background: 'rgba(118,185,0,0.15)', color: 'var(--brand-hi)', borderColor: 'var(--brand)' }}>POST</span>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem', color: 'var(--ink)' }}>/v1/embeddings</strong>
                    </div>
                    <small style={{ color: 'var(--ink-3)', fontSize: '0.74rem' }}>Dense 1024d vector embeddings powered by BGE-M3 nodes.</small>
                  </div>
                </div>
              </Plate>

              <div className="grid grid--2" style={{ gap: 12 }}>
                <Plate style={{ padding: 18 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <Zap size={16} style={{ color: 'var(--brand-hi)' }} />
                    <strong style={{ fontSize: '0.84rem', color: 'var(--ink)' }}>99.98% Routing SLA</strong>
                  </div>
                  <p className="muted" style={{ fontSize: '0.74rem', margin: 0 }}>
                    Instant automatic failover if a provider node degrades or runs out of KV memory.
                  </p>
                </Plate>
                <Plate style={{ padding: 18 }}>
                  <div className="row" style={{ gap: 8, marginBottom: 6 }}>
                    <KeyRound size={16} style={{ color: 'var(--brand-hi)' }} />
                    <strong style={{ fontSize: '0.84rem', color: 'var(--ink)' }}>Secret Token Auth</strong>
                  </div>
                  <p className="muted" style={{ fontSize: '0.74rem', margin: 0 }}>
                    Create scoped API credentials with custom token and spending quotas.
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
