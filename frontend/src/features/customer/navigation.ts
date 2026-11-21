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
  BrainCircuit,
  Cpu,
  FlaskConical,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  Receipt,
  Rocket,
  Settings2,
  SquareTerminal,
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
  | 'orders'
  | 'api-keys'
  | 'usage'
  | 'developer'
  | 'billing'
  | 'notifications'
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
    label: 'Model marketplace',
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
    label: 'Help',
    path: 'help',
    icon: LifeBuoy,
    group: 'Support',
    availability: 'reference',
    description: 'Guides, answers and the Inferxe assistant.',
    availabilityNote: 'Reference documentation.',
    capabilities: ['Answers to common questions', 'Developer documentation', 'Ask the Inferxe assistant'],
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
