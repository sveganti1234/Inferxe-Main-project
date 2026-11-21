/**
 * Help content. Every answer describes behaviour that exists today and was verified against the
 * codebase; where a capability does not exist yet, the answer says so plainly. Keep this file
 * in step with the product — an FAQ that over-promises is worse than none.
 */

export type FaqCategory = 'Getting started' | 'Inference & models' | 'GPUs & deployments' | 'Billing & usage' | 'Account & security'
export const FAQ_CATEGORIES: FaqCategory[] = ['Getting started', 'Inference & models', 'GPUs & deployments', 'Billing & usage', 'Account & security']

export interface FaqLink {
  label: string
  /** Console section id (resolved by the page) or an absolute site path starting with "/". */
  to: string
}

export interface FaqEntry {
  id: string
  category: FaqCategory
  question: string
  answer: string
  links?: FaqLink[]
}

export const FAQ: FaqEntry[] = [
  {
    id: 'what-can-i-do',
    category: 'Getting started',
    question: 'What can I do in the Inferxe console?',
    answer:
      'You can create and revoke API keys, send requests to the Inferxe inference API (and try them in the playground), review your usage, see your wallet balance and transaction history, browse a reference catalogue of open-weight models and the GPU capacity providers have listed, register SSH public keys, and manage your account. Some sections are reference-only, simulated or not available yet — the labels tell you which.',
    links: [{ label: 'Overview', to: 'overview' }],
  },
  {
    id: 'labels',
    category: 'Getting started',
    question: 'What do the Live, Reference, Simulated and Unavailable labels mean?',
    answer:
      'Live means the data comes from your real account or Inferxe services. Reference means static information — model specifications and estimates, not live availability or pricing. Simulated means the records are real but the runtime behind them is simulated, so nothing is provisioned. Unavailable means the capability does not exist yet.',
  },
  {
    id: 'first-request',
    category: 'Getting started',
    question: 'How do I send my first inference request?',
    answer:
      'Create an API key on the API keys page and copy it when it is shown — it is displayed only once. Then send a POST request to /api/v1/inference with your key as a bearer token and a JSON body containing a prompt (optionally max_tokens and temperature). The API keys page has ready-to-copy cURL and Python examples, and the playground lets you try a request from the browser.',
    links: [
      { label: 'API keys', to: 'api-keys' },
      { label: 'Inference playground', to: 'playground' },
    ],
  },
  {
    id: 'which-model',
    category: 'Inference & models',
    question: 'Which model answers my requests?',
    answer:
      'The inference service currently chooses the model itself. A model name included in a request is not used to select a model. Every response reports the model that actually ran, so you can always see what answered.',
  },
  {
    id: 'playground-disabled',
    category: 'Inference & models',
    question: 'Why is the playground disabled?',
    answer:
      'The playground only runs when the inference service reports that its model provider is configured, and it re-checks this before every run. When the provider is missing or the service cannot be reached, running is disabled and the console says why. Nothing is ever simulated.',
    links: [{ label: 'Inference playground', to: 'playground' }],
  },
  {
    id: 'catalogue',
    category: 'Inference & models',
    question: 'Are the models in the Model marketplace available to run?',
    answer:
      'No. The Model marketplace is a reference catalogue of open-weight model specifications plus a GPU memory estimator. It does not show what Inferxe is serving, and it shows no prices or availability.',
    links: [{ label: 'Model marketplace', to: 'models' }],
  },
  {
    id: 'estimator',
    category: 'Inference & models',
    question: 'How accurate is the GPU memory estimator?',
    answer:
      'It uses a simple sizing formula — model weights plus KV cache plus runtime overhead, compared with 90% of a GPU’s memory. That is good for rough planning, not a guarantee. The decode figure is a theoretical upper bound from memory bandwidth, not a benchmark.',
  },
  {
    id: 'no-gpus',
    category: 'GPUs & deployments',
    question: 'Why are there no GPUs in the GPU marketplace?',
    answer:
      'The marketplace shows only listings that Inferxe GPU providers have published. When none are published it says so rather than showing placeholders. You can save listings once they appear, but ordering them is not available yet.',
    links: [{ label: 'GPU marketplace', to: 'gpus' }],
  },
  {
    id: 'deploy',
    category: 'GPUs & deployments',
    question: 'Can I deploy a model on a GPU?',
    answer:
      'Not yet. Deployment provisioning is not available. The Deployments page shows any records on your account, read-only; a recorded status does not mean a GPU is running or a model is being served.',
    links: [{ label: 'Deployments', to: 'deployments' }],
  },
  {
    id: 'notebooks',
    category: 'GPUs & deployments',
    question: 'What are notebook sessions, and can I connect to them?',
    answer:
      'Notebook sessions are records on your account. The runtime is simulated: no GPU, Jupyter server or SSH server is created, so there is nothing to connect to. The SSH public keys you register are real and stored with your account.',
    links: [{ label: 'SSH keys & notebooks', to: 'developer' }],
  },
  {
    id: 'add-funds',
    category: 'Billing & usage',
    question: 'Can I add funds or pay from the console?',
    answer:
      'Yes, as a demo: click Add money on the Billing & wallet page and enter an amount. It is credited straight away and no real payment is taken; real payments are not available yet.',
    links: [{ label: 'Billing & wallet', to: 'billing' }],
  },
  {
    id: 'cost',
    category: 'Billing & usage',
    question: 'What does inference cost?',
    answer:
      'Pricing is not configured yet. Inference requests are recorded without a cost and are not charged to your wallet, so the console shows “Pricing not configured” instead of a number.',
  },
  {
    id: 'usage-source',
    category: 'Billing & usage',
    question: 'Where do the usage numbers come from?',
    answer:
      'From the requests recorded when you call the inference API with one of your keys: counts, tokens, latency and success. Nothing is estimated or sampled. Days are UTC calendar days, and a latency percentile such as p95 appears only once there are enough requests for it to mean something.',
    links: [{ label: 'Usage & analytics', to: 'usage' }],
  },
  {
    id: 'profile',
    category: 'Account & security',
    question: 'How do I change my name or password?',
    answer:
      'Open Settings. You can edit your display name and change your password there. Your sign-in email is managed by your Inferxe account and cannot be changed from the console.',
    links: [{ label: 'Settings', to: 'settings' }],
  },
  {
    id: 'privacy',
    category: 'Account & security',
    question: 'Can other customers see my data?',
    answer:
      'No. Every request from the console is authenticated with your sign-in, the console never sends a user ID, and the servers return only records that belong to your account.',
  },
  {
    id: 'key-storage',
    category: 'Account & security',
    question: 'Can I see an API key again after creating it?',
    answer:
      'No. Inferxe stores only a hash of each key, so the full key cannot be recovered. It is shown once, when you create it. If you lose a key, revoke it and create a new one.',
    links: [{ label: 'API keys', to: 'api-keys' }],
  },
]

export function filterFaq(entries: FaqEntry[], f: { query: string; category: FaqCategory | 'all' }): FaqEntry[] {
  const q = f.query.trim().toLowerCase()
  return entries.filter((e) => {
    if (f.category !== 'all' && e.category !== f.category) return false
    if (!q) return true
    return `${e.question} ${e.answer}`.toLowerCase().includes(q)
  })
}
