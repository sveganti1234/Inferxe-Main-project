import {
  Layers,
  Workflow,
  Cpu,
  Building2,
  Mail,
  type LucideIcon,
} from 'lucide-react'

/** Single source of truth for brand + site-wide config. */
export const SITE = {
  name: 'Inferxe',
  parent: 'Automatrix',
  domain: 'www.inferxe.com',
  url: 'https://www.inferxe.com',
  tagline: 'One API, many GPU providers.',
  stage: 'MVP in build',
  updated: 'October 2026',
  /**
   * Fill these in once confirmed — the UI hides anything left empty.
   * The pitch deck still has [email] / [founder] placeholders.
   */
  contactEmail: '',
  /** POST endpoint for the contact form (Formspree, Netlify, your API…). Set VITE_FORM_ENDPOINT. */
  formEndpoint: (import.meta.env.VITE_FORM_ENDPOINT as string | undefined) ?? '',
}

export interface NavLeaf {
  to: string
  title: string
  desc: string
  icon: LucideIcon
}
export type NavItem =
  | { label: string; to: string; items?: undefined }
  | { label: string; to?: undefined; items: NavLeaf[] }

export const NAV: NavItem[] = [
  {
    label: 'Product',
    items: [
      { to: '/platform', title: 'Platform', desc: 'The unified GPU control plane', icon: Layers },
      { to: '/how-it-works', title: 'How it works', desc: 'From workload to running GPU', icon: Workflow },
      { to: '/gpus', title: 'GPU catalogue', desc: 'L4 to GB200, mapped to workloads', icon: Cpu },
    ],
  },
  { label: 'Solutions', to: '/solutions' },
  { label: 'Pricing', to: '/pricing' },
  { label: 'Security', to: '/security' },
  {
    label: 'Company',
    items: [
      { to: '/company', title: 'About Inferxe', desc: 'Vision, moat and market position', icon: Building2 },
      { to: '/contact', title: 'Contact', desc: 'Request access and partnerships', icon: Mail },
    ],
  },
]

export const FOOTER_COLS = [
  {
    title: 'Product',
    links: [
      { to: '/platform', label: 'Platform' },
      { to: '/how-it-works', label: 'How it works' },
      { to: '/gpus', label: 'GPU catalogue' },
      { to: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { to: '/company', label: 'About' },
      { to: '/solutions', label: 'Solutions' },
      { to: '/security', label: 'Security & trust' },
      { to: '/contact', label: 'Contact' },
    ],
  },
  {
    title: 'Resources',
    links: [
      { to: '/gpus#studio', label: 'GPU fit calculator' },
      { to: '/pricing#estimator', label: 'Cost estimator' },
      { to: '/how-it-works#simulator', label: 'Routing simulator' },
      { to: '/security#risk', label: 'Risk framework' },
    ],
  },
]

export const PAGE_INDEX = [
  { to: '/', title: 'Home', kw: 'overview inferxe one api many gpu providers' },
  { to: '/platform', title: 'Platform', kw: 'control plane routing compatibility adapter vllm console' },
  { to: '/how-it-works', title: 'How it works', kw: 'workflow architecture lifecycle simulator pipeline' },
  { to: '/gpus', title: 'GPU catalogue', kw: 'nvidia l4 l40s h100 h200 b200 gb200 vram calculator' },
  { to: '/solutions', title: 'Solutions', kw: 'developers enterprises researchers use cases' },
  { to: '/pricing', title: 'Pricing', kw: 'cost estimator rates fee inr gpu hour' },
  { to: '/security', title: 'Security & trust', kw: 'security privacy risk reliability monitoring' },
  { to: '/company', title: 'Company', kw: 'about automatrix moat market stack' },
  { to: '/contact', title: 'Contact & early access', kw: 'request access email partnership provider' },
  { to: '/developers', title: 'Developer Hub & API', kw: 'developers api docs vllm python sdk curl endpoints' },
  { to: '/roadmap', title: 'Infrastructure Roadmap', kw: 'roadmap blackwell b200 gb200 timeline sovereign' },
  { to: '/dashboard', title: 'Admin Console · Dashboard', kw: 'dashboard console telemetry clusters deployments admin' },
  { to: '/dashboard/customer', title: 'Customer Portal Overview', kw: 'customer portal dashboard overview spend deployments' },
  { to: '/dashboard/gpus', title: 'GPU Marketplace · Dashboard', kw: 'gpu marketplace buy reserve l4 l40s h100 vram' },
  { to: '/dashboard/models', title: 'Models & Compatibility · Dashboard', kw: 'models llm llama qwen mistral deepseek vram weights' },
  { to: '/dashboard/deployments', title: 'Model Deployments · Dashboard', kw: 'deployments active running endpoints endpoints' },
  { to: '/dashboard/api-keys', title: 'API Keys · Dashboard', kw: 'api keys credentials tokens generate secret' },
  { to: '/dashboard/analytics', title: 'Usage & Analytics · Dashboard', kw: 'analytics usage tokens requests latency metrics' },
  { to: '/dashboard/billing', title: 'Wallet & Billing · Dashboard', kw: 'wallet billing balance invoices payment transactions' },
  { to: '/dashboard/notifications', title: 'Notifications · Dashboard', kw: 'notifications alerts system messages health' },
  { to: '/dashboard/settings', title: 'Settings · Dashboard', kw: 'settings quotas budget preferences workspace' },
  { to: '/dashboard/users', title: 'Users Directory · Dashboard', kw: 'dashboard users list directory accounts members' },
  { to: '/dashboard/provider', title: 'Provider Management · Admin Portal', kw: 'provider management supply hardware listings admin' },
  { to: '/dashboard/provider/listings', title: 'GPU Inventory & Listings', kw: 'provider gpu listings hardware sell supply' },
  { to: '/dashboard/provider/capacity', title: 'Capacity & Health', kw: 'provider capacity health maintenance nodes' },
  { to: '/dashboard/provider/earnings', title: 'Earnings & Payouts', kw: 'provider earnings payouts revenue gross net' },
  { to: '/login', title: 'Sign In · Console Authentication', kw: 'sign in login account authentication console session' },
  { to: '/signup', title: 'Create Account · Organization Registration', kw: 'sign up register create account organization onboard' },
  { to: '/privacy', title: 'Privacy', kw: 'privacy data retention' },
  { to: '/terms', title: 'Terms', kw: 'terms conditions' },
]
