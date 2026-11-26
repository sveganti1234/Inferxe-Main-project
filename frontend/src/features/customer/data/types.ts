/**
 * Typed contracts for the customer workspace.
 *
 * `CustomerWorkspace` mirrors the column lists in `backend/api/supabaseApi.js`
 * (`WORKSPACE_SELECTS`) returned by `GET /api/customer/workspace`. Every collection is
 * scoped server-side to the authenticated Cognito identity; the frontend never sends a user id.
 */

export type Nullable<T> = T | null

export interface WorkspaceProfile {
  user_id: string
  full_name: Nullable<string>
  email: Nullable<string>
  username: Nullable<string>
  avatar_path: Nullable<string>
  role: Nullable<string>
  status: Nullable<string>
  organization_id: Nullable<string>
}

export interface Organization {
  id: string
  name: string
  slug: Nullable<string>
  billing_email: Nullable<string>
  status: Nullable<string>
  created_at: Nullable<string>
}

export interface OrganizationMember {
  id: string
  organization_id: string
  user_id: string
  member_role: Nullable<string>
  status: Nullable<string>
  joined_at: Nullable<string>
  created_at: Nullable<string>
}

export interface UserAccessPolicy {
  id: string
  user_id: string
  organization_id: Nullable<string>
  model_access: Nullable<string>
  selected_models: unknown
  provider_access: Nullable<string>
  selected_providers: unknown
  api_access: Nullable<boolean>
  analytics_access: Nullable<boolean>
  monthly_spend_limit: Nullable<number | string>
  rate_limit: Nullable<number | string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface GpuProvider {
  id: string
  name: string
  slug: Nullable<string>
  region: Nullable<string>
  status: Nullable<string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface GpuListing {
  id: string
  provider_id: Nullable<string>
  name: Nullable<string>
  gpu_model: Nullable<string>
  vram: Nullable<number | string>
  architecture: Nullable<string>
  bandwidth: Nullable<number | string>
  tflops: Nullable<number | string>
  region: Nullable<string>
  quantity: Nullable<number>
  hourly_price: Nullable<number | string>
  currency: Nullable<string>
  status: Nullable<string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface SavedGpuListing {
  id: string
  user_id: string
  listing_id: string
  created_at: Nullable<string>
}

export interface Deployment {
  id: string
  user_id: string
  organization_id: Nullable<string>
  listing_id: Nullable<string>
  name: string
  model_name: Nullable<string>
  gpu_model: Nullable<string>
  region: Nullable<string>
  status: Nullable<string>
  hourly_rate: Nullable<number | string>
  /** Currency of hourly_rate (ISO 4217, e.g. INR). */
  currency?: Nullable<string>
  endpoint_url: Nullable<string>
  started_at: Nullable<string>
  stopped_at: Nullable<string>
  metadata: unknown
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface Order {
  id: string
  user_id: string
  organization_id: Nullable<string>
  deployment_id: Nullable<string>
  order_number: Nullable<string>
  item_name: Nullable<string>
  provider_name: Nullable<string>
  order_date: Nullable<string>
  duration_minutes: Nullable<number>
  total_cost: Nullable<number | string>
  currency: Nullable<string>
  status: Nullable<string>
  details: unknown
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface UsageRecord {
  id: string
  user_id: string
  organization_id: Nullable<string>
  deployment_id: Nullable<string>
  order_id: Nullable<string>
  model_name: Nullable<string>
  gpu_model: Nullable<string>
  input_tokens: Nullable<number>
  output_tokens: Nullable<number>
  duration_seconds: Nullable<number>
  amount: Nullable<number | string>
  currency: Nullable<string>
  recorded_at: Nullable<string>
  metadata: unknown
}

export interface WalletAccount {
  id: string
  user_id: string
  organization_id: Nullable<string>
  balance: Nullable<number | string>
  currency: Nullable<string>
  status: Nullable<string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface WalletTransaction {
  id: string
  wallet_id: Nullable<string>
  user_id: string
  order_id: Nullable<string>
  transaction_reference: Nullable<string>
  transaction_type: Nullable<string>
  direction: Nullable<string>
  amount: Nullable<number | string>
  currency: Nullable<string>
  status: Nullable<string>
  description: Nullable<string>
  created_at: Nullable<string>
}

export interface ApiKeyRecord {
  id: string
  user_id: string
  organization_id: Nullable<string>
  name: string
  key_prefix: Nullable<string>
  created_at: Nullable<string>
  last_used_at: Nullable<string>
  expires_at: Nullable<string>
  revoked_at: Nullable<string>
  status: Nullable<string>
}

export interface SshPublicKey {
  id: string
  user_id: string
  name: string
  public_key: Nullable<string>
  fingerprint: Nullable<string>
  created_at: Nullable<string>
  revoked_at: Nullable<string>
}

export interface WorkspaceNotification {
  id: string
  user_id: string
  title: Nullable<string>
  detail: Nullable<string>
  notification_type: Nullable<string>
  is_read: Nullable<boolean>
  created_at: Nullable<string>
  read_at: Nullable<string>
}

export interface OrderReview {
  id: string
  order_id: string
  user_id: string
  rating: Nullable<number>
  note: Nullable<string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface NotebookSession {
  id: string
  user_id: string
  deployment_id: Nullable<string>
  name: Nullable<string>
  status: Nullable<string>
  session_url: Nullable<string>
  storage_path: Nullable<string>
  bot_access_enabled: Nullable<boolean>
  started_at: Nullable<string>
  stopped_at: Nullable<string>
  created_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface InferenceRequestRecord {
  id: string
  user_id: Nullable<string>
  organization_id: Nullable<string>
  api_key_id: Nullable<string>
  deployment_id: Nullable<string>
  model_name: Nullable<string>
  provider_name: Nullable<string>
  input_tokens: Nullable<number>
  output_tokens: Nullable<number>
  latency_ms: Nullable<number>
  status: Nullable<string>
  error_message: Nullable<string>
  cost: Nullable<number | string>
  created_at: Nullable<string>
}

/** Normalised workspace: every collection is always an array (never undefined). */
/** Plan set by administrators (Supabase customer_plans). Trial state is derived from the dates. */
export interface CustomerPlan {
  user_id: string
  tier: Nullable<string>
  trial_started_at: Nullable<string>
  trial_ends_at: Nullable<string>
  updated_at: Nullable<string>
}

export interface CustomerWorkspace {
  profile: WorkspaceProfile
  organizations: Organization[]
  organization_members: OrganizationMember[]
  user_access_policies: UserAccessPolicy[]
  gpu_providers: GpuProvider[]
  gpu_listings: GpuListing[]
  saved_gpu_listings: SavedGpuListing[]
  deployments: Deployment[]
  orders: Order[]
  usage_records: UsageRecord[]
  wallet_accounts: WalletAccount[]
  wallet_transactions: WalletTransaction[]
  api_keys: ApiKeyRecord[]
  ssh_public_keys: SshPublicKey[]
  notifications: WorkspaceNotification[]
  order_reviews: OrderReview[]
  notebook_sessions: NotebookSession[]
  /** Requests from the last 90 days (the longest usage window); older history is only counted. */
  inference_requests: InferenceRequestRecord[]
  /** All-time request count from the server; absent from older backends (then the array length is used). */
  inference_requests_total?: number
  customer_plans: CustomerPlan[]
}

export const WORKSPACE_COLLECTIONS = [
  'organizations',
  'organization_members',
  'user_access_policies',
  'gpu_providers',
  'gpu_listings',
  'saved_gpu_listings',
  'deployments',
  'orders',
  'usage_records',
  'wallet_accounts',
  'wallet_transactions',
  'api_keys',
  'ssh_public_keys',
  'notifications',
  'order_reviews',
  'notebook_sessions',
  'inference_requests',
  'customer_plans',
] as const satisfies ReadonlyArray<keyof CustomerWorkspace>

export type WorkspaceCollection = (typeof WORKSPACE_COLLECTIONS)[number]

/* ── 8002 notifications service ── */
export interface NotificationItem {
  id: string
  title: Nullable<string>
  detail?: Nullable<string>
  message?: Nullable<string>
  notification_type: Nullable<string>
  is_read: boolean
  created_at: Nullable<string>
  read_at?: Nullable<string>
  related_entity_id?: Nullable<string>
}

export interface NotificationPage {
  total: number
  unread_count: number
  items: NotificationItem[]
}

/* ── 8002 wallet balance (table `wallets`) ── */
/** Customer-configured monthly budget (8002 GET /api/workspace/settings). null = never set. */
export interface WorkspaceBudget {
  monthlyBudget: number | null
}

export interface WalletBalance {
  balance: number
  currency: string
  lowBalanceAlertLevel: Nullable<string>
  updatedAt: Nullable<string>
}

/* ── 8001 inference service health ── */
export interface InferenceServiceHealth {
  status: string
  inferenceAvailable: boolean
  /** True when the server answers with simulated (demo) replies instead of a real model. */
  simulated: boolean
  providerStatus: Nullable<string>
}
