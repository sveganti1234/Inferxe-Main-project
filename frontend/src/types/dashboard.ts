export type UserRole = 'admin' | 'customer' | 'provider' | 'developer' | 'viewer'

export type AccountStatus = 'active' | 'inactive'
export type UserRecordStatus = AccountStatus | 'pending' | 'suspended'

export type ModelAccessType = 'all' | 'selected'

export type ProviderAccessType = 'all' | 'selected'

export interface UserFormData {
  fullName: string
  email: string
  username: string
  avatarUrl: string
  role: UserRole
  status: AccountStatus
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
  status: UserRecordStatus
  authMethod: 'cognito'
  modelAccess: ModelAccessType
  selectedModels: string[]
  providerAccess: ProviderAccessType
  selectedProviders: string[]
  apiAccess: boolean
  analyticsAccess: boolean
  monthlySpendLimit: number | null // null means unlimited
  rateLimit: string
  internalNote: string
  createdAt: string
  lastActive: string
}
