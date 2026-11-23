/**
 * Single source of truth for the customer console's sections: routes, labels, icons,
 * grouping and — importantly — an honest availability label for each section.
 *
 * Availability describes the nature of the data a section shows:
 *  - live:        real data from the customer's Inferxe account / services
 *  - reference:   static reference information (not live availability or pricing)
 *  - simulated:   backed by records, but the underlying runtime is simulated
 *  - unavailable: the capability does not exist yet
 */
import {
  Activity,
  BellRing,
  Bookmark,
  BrainCircuit,
  CreditCard,
  Cpu,
  FlaskConical,
  Gift,
  HelpCircle,
  KeyRound,
  LayoutDashboard,
  Receipt,
  Rocket,
  Settings2,
  ShieldCheck,
  SquareTerminal,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/** Base path of the console; also the customer landing page (see home.ts). */
export const CONSOLE_BASE = '/dashboard/app'

export type Availability = 'live' | 'reference' | 'simulated' | 'unavailable'

export type SectionId =
  | 'overview'
  | 'models'
  | 'gpus'
  | 'playground'
  | 'deployments'
  | 'wishlist'
  | 'orders'
  | 'api-keys'
  | 'ssh-keys'
  | 'usage'
  | 'developer'
  | 'billing'
  | 'checkout'
  | 'rewards'
  | 'notifications'
  | 'profile'
  | 'settings'
  | 'help'

export interface ConsoleSection {
  id: SectionId
  label: string
  /** Relative to CONSOLE_BASE ('' = index). */
  path: string
  icon: LucideIcon
  /** Groups follow the original customer portal's sidebar (General, Compute & AI, …). */
  group: 'General' | 'Compute & AI' | 'Orders & Activity' | 'Billing & Payments' | 'Developer Tools' | 'Support' | 'Settings'
  availability: Availability
  /** Short description used in headers and the workspace hub. */
  description: string
  /** Plain-language note explaining the availability label. */
  availabilityNote: string
  /** What the finished section will provide (shown on in-progress previews). */
  capabilities: string[]
}

export const CONSOLE_SECTIONS: ConsoleSection[] = [
  {
    id: 'overview',
    label: 'Overview',
    path: '',
    icon: LayoutDashboard,
    group: 'General',
    availability: 'live',
    description: 'Your account, services and recent activity at a glance.',
    availabilityNote: 'Built from your live workspace data.',
    capabilities: ['Account and organization status', 'Wallet balance and recent activity', 'Inference usage summary from real requests'],
  },
  {
    id: 'models',
    label: 'LLM catalog',
    path: 'models',
    icon: BrainCircuit,
    group: 'Compute & AI',
    availability: 'reference',
    description: 'Explore open-weight LLMs and estimate the GPU memory they need.',
    availabilityNote: 'Reference specifications only — not live availability or pricing.',
    capabilities: ['Searchable reference catalogue of open-weight models', 'VRAM and GPU-fit estimator', 'Side-by-side model comparison'],
  },
  {
    id: 'gpus',
    label: 'GPU marketplace',
    path: 'gpus',
    icon: Cpu,
    group: 'Compute & AI',
    availability: 'live',
    description: 'GPU capacity listed by Inferxe providers.',
    availabilityNote: 'Shows real provider listings. No capacity is listed yet.',
    capabilities: ['Live provider listings with region and specifications', 'Save listings to compare later'],
  },
  {
    id: 'playground',
    label: 'Inference playground',
    path: 'playground',
    icon: FlaskConical,
    group: 'Compute & AI',
    availability: 'live',
    description: 'Send prompts to the Inferxe inference API with your API key.',
    availabilityNote: 'Calls the real inference API. Availability depends on the model provider.',
    capabilities: ['Prompt the inference API with one of your API keys', 'See token usage and latency for each response'],
  },
  {
    id: 'deployments',
    label: 'Deployments',
    path: 'deployments',
    icon: Rocket,
    group: 'Compute & AI',
    availability: 'unavailable',
    description: 'Dedicated model deployments on reserved GPU capacity.',
    availabilityNote: 'Deployment provisioning is not available yet.',
    capabilities: ['Read-only view of your deployment records', 'Provisioning controls once the backend supports them'],
  },
  {
    id: 'wishlist',
    label: 'Wishlist',
    path: 'wishlist',
    icon: Bookmark,
    group: 'Compute & AI',
    availability: 'live',
    description: 'Review your bookmarked GPU listings for quick deployment.',
    availabilityNote: 'Bookmarked GPU instances saved for instant comparison and deployment.',
    capabilities: [
      'Saved GPU instances inventory and specifications',
      'One-click deployment navigation',
      'Remove and toggle bookmarks in sync with GPU Marketplace',
    ],
  },
  {
    id: 'api-keys',
    label: 'API keys',
    path: 'api-keys',
    icon: KeyRound,
    group: 'Developer Tools',
    availability: 'live',
    description: 'Create and revoke keys for the Inferxe inference API.',
    availabilityNote: 'Manages your real API keys.',
    capabilities: ['Create keys (secret shown once)', 'Revoke keys', 'Quick-start code for the inference API'],
  },
  {
    id: 'ssh-keys',
    label: 'SSH Keys',
    path: 'ssh-keys',
    icon: ShieldCheck,
    group: 'Developer Tools',
    availability: 'live',
    description: 'Configure demo SSH credentials for compute cluster access.',
    availabilityNote: 'Register public keys to enable secure terminal and container shell pairing.',
    capabilities: [
      'Register OpenSSH public keys (ed25519, RSA)',
      'Display key fingerprints and public snippets',
      'One-click copy and secure removal',
    ],
  },
  {
    id: 'developer',
    label: 'SSH keys & notebooks',
    path: 'developer',
    icon: SquareTerminal,
    group: 'Compute & AI',
    availability: 'simulated',
    description: 'SSH public keys and notebook sessions for GPU workspaces.',
    availabilityNote: 'SSH keys are real; the notebook runtime is simulated.',
    capabilities: ['Add and remove SSH public keys', 'Create, start and stop notebook sessions (simulated runtime)'],
  },
  {
    id: 'orders',
    label: 'Orders & Purchase History',
    path: 'orders',
    icon: Receipt,
    group: 'Orders & Activity',
    availability: 'live',
    description: 'Track active, completed, cancelled, and archived compute orders.',
    availabilityNote: 'Real-time compute order records and lifecycle tracking.',
    capabilities: ['Complete compute order history', 'Filter by status: Running, Completed, Cancelled, Archived', 'View hardware, datacenter, and payment details', 'Archive and invoice inspection'],
  },
  {
    id: 'usage',
    label: 'Usage & analytics',
    path: 'usage',
    icon: Activity,
    group: 'Orders & Activity',
    availability: 'live',
    description: 'Requests, tokens, latency and reliability of your inference traffic.',
    availabilityNote: 'Computed from your recorded inference requests. Pricing is not configured yet.',
    capabilities: ['Requests and tokens over time', 'Per-model breakdown', 'Latency and success rate', 'Request log'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: 'notifications',
    icon: BellRing,
    group: 'Support',
    availability: 'live',
    description: 'Account, wallet and platform notifications.',
    availabilityNote: 'Your real notification feed.',
    capabilities: ['Notification inbox with unread filter', 'Mark as read and dismiss'],
  },
  {
    id: 'billing',
    label: 'Billing & wallet',
    path: 'billing',
    icon: Wallet,
    group: 'Billing & Payments',
    availability: 'live',
    description: 'Wallet balance and transaction history.',
    availabilityNote: 'Real balance and transactions. Adding funds is not available yet.',
    capabilities: ['Wallet balance', 'Transaction ledger'],
  },
  {
    id: 'checkout',
    label: 'Payment & Checkout',
    path: 'checkout',
    icon: CreditCard,
    group: 'Billing & Payments',
    availability: 'live',
    description: 'Simulated payment processing with demo coupon discounts.',
    availabilityNote: 'Simulated payment processing with demo coupon discounts and sovereign GPU capacity reservation.',
    capabilities: [
      'Dedicated compute reservation by duration',
      'Promotional coupon codes and discount calculations',
      'Prepaid wallet and corporate credit card payment methods',
      'Instant order registration in orders ledger',
    ],
  },
  {
    id: 'rewards',
    label: 'Rewards & Discounts',
    path: 'rewards',
    icon: Gift,
    group: 'Billing & Payments',
    availability: 'live',
    description: 'Referral discounts, coupon codes and creator trial codes.',
    availabilityNote: 'Referral tracking, promotional discount coupons, and 1-hour creator trials.',
    capabilities: [
      'Personal referral link and tracking counter',
      'Earned referral compute discount tracker',
      'Creator and YouTuber 1-hour trial activation',
      'Active coupon codes directory',
    ],
  },
  {
    id: 'profile',
    label: 'Profile and Settings',
    path: 'profile',
    icon: UserRound,
    group: 'Settings',
    availability: 'live',
    description: 'Manage your personal account details, avatar, and role.',
    availabilityNote: 'Real customer profile, organization details, and session security.',
    capabilities: [
      'Personal profile details and dynamic avatar initials',
      'Corporate SSO-managed email and organization preferences',
      'Change account password with real-time strength validation',
      'Sovereign tenant security enclave status and JWT token inspection',
    ],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: 'settings',
    icon: Settings2,
    group: 'Settings',
    availability: 'live',
    description: 'Profile, security and organization details.',
    availabilityNote: 'Your real account settings.',
    capabilities: ['Edit your display name', 'Change your password', 'Organization and access limits'],
  },
  {
    id: 'help',
    label: 'Chatbot and Help',
    path: 'help',
    icon: HelpCircle,
    group: 'Support',
    availability: 'reference',
    description: 'Frequently asked questions, architecture guidelines, and support.',
    availabilityNote: 'Technical architecture, pricing guarantees, hardware specifications, and API documentation.',
    capabilities: [
      'Technical architecture and sovereign compute guidelines',
      'Frequently asked questions and support',
      'Developer documentation and OpenAI SDK reference',
      'Interactive AI Chatbot assistant',
    ],
  },
]

export const NAV_GROUPS: ConsoleSection['group'][] = ['General', 'Compute & AI', 'Orders & Activity', 'Billing & Payments', 'Developer Tools', 'Support', 'Settings']

export function sectionHref(section: Pick<ConsoleSection, 'path'>): string {
  return section.path ? `${CONSOLE_BASE}/${section.path}` : CONSOLE_BASE
}

export function getSection(id: SectionId): ConsoleSection {
  const section = CONSOLE_SECTIONS.find((s) => s.id === id)
  if (!section) throw new Error(`Unknown console section: ${id}`)
  return section
}

/** Resolve the section for a pathname inside the console (null when not a known section). */
export function sectionForPath(pathname: string): ConsoleSection | null {
  const normalised = pathname.replace(/\/+$/, '')
  if (normalised === CONSOLE_BASE) return getSection('overview')
  if (!normalised.startsWith(`${CONSOLE_BASE}/`)) return null
  const first = normalised.slice(CONSOLE_BASE.length + 1).split('/')[0]
  return CONSOLE_SECTIONS.find((s) => s.path === first) ?? null
}

/**
 * Availability shown for a section, refined with live signals where they exist
 * (e.g. the playground cannot run while the model provider is not configured).
 */
export function effectiveAvailability(section: ConsoleSection, signals: { inferenceAvailable?: boolean | null }): Availability {
  if (section.id === 'playground' && signals.inferenceAvailable === false) return 'unavailable'
  return section.availability
}
