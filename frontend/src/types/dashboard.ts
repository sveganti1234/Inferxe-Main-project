export type UserRole = 'admin' | 'developer' | 'viewer'

export type AccountStatus = 'active' | 'inactive'

export type AuthMethod = 'invite' | 'password'

export type ModelAccessType = 'all' | 'selected'

export type ProviderAccessType = 'all' | 'selected'

export interface UserFormData {
  fullName: string
  email: string
  username: string
  avatarUrl: string
  role: UserRole
  status: AccountStatus
  authMethod: AuthMethod
  temporaryPassword: string
  sendInviteEmail: boolean
  requirePasswordChange: boolean
  modelAccess: ModelAccessType
  selectedModels: string[]
  providerAccess: ProviderAccessType
  selectedProviders: string[]
  apiAccess: boolean
  analyticsAccess: boolean
  monthlySpendLimit: string
  rateLimit: string
  internalNote: string
}

export interface UserRecord {
  id: string
  fullName: string
  email: string
  username: string
  avatarUrl: string
  role: UserRole
  status: AccountStatus
  authMethod: AuthMethod
  modelAccess: ModelAccessType
  selectedModels: string[]
  providerAccess: ProviderAccessType
  selectedProviders: string[]
  apiAccess: boolean
  analyticsAccess: boolean
  monthlySpendLimit: number | null // null means unlimited
  totalRequests?: number // Total inference requests processed
  successRate?: number // Reliability percentage of user API requests (0-100)
  rateLimit: string
  internalNote: string
  createdAt: string
  lastActive: string
}
