import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  CornerDownLeft,
  Cpu,
  Globe,
  KeyRound,
  LayoutDashboard,
  Search,
  Server,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react'
import { GPUS } from '../../data/gpus'
import { fetchCustomers, type CustomerRecord } from '../../lib/customerService'
import {
  AVAILABLE_MODELS,
  AVAILABLE_PROVIDERS,
  loadUsers,
} from '../../lib/userStore'
import { getAdminAccounts } from '../../lib/adminAccountStore'
import { getAllRoles } from '../../lib/adminRoleStore'
import { GEO_DISTRIBUTION } from './SovereignNodesMap'
import type { UserRecord } from '../../types/dashboard'

export interface AdminSearchSectionItem {
  label: string
  to: string
  group: string
  keywords?: string
}

interface AdminHeaderSearchProps {
  sections: AdminSearchSectionItem[]
  isSuperAdmin: boolean
}

type SearchCategory =
  | 'Admin Sections'
  | 'Customers'
  | 'Users Directory'
  | 'GPUs & Inventory'
  | 'Telemetry & Nodes'
  | 'Super Admin'

interface SearchResultItem {
  id: string
  category: SearchCategory
  title: string
  subtitle: string
  badge?: string
  to: string
}

interface StoredProviderListing {
  id?: string
  name?: string
  gpu?: string
  vram?: string
  region?: string
  quantity?: number
  price?: number
  status?: string
  arch?: string
}

const SECTION_KEYWORDS: Record<string, string> = {
  '/dashboard': 'overview console cluster metrics telemetry kpi deployments',
  '/dashboard/customers': 'customers accounts client database online active inactive export csv',
  '/dashboard/users': 'users directory team members roles permissions access',
  '/dashboard/users/add': 'add user create invite provision member',
  '/dashboard/users/map': 'sovereign nodes map telemetry geography datacenter latency fleet regions',
  '/dashboard/keys': 'key monitoring api keys ssh keys fingerprints security alerts audit usage readonly',
  '/dashboard/provider': 'provider overview gpu datacenter inventory onboarding',
  '/dashboard/provider/listings': 'gpu listings hardware pricing h100 h200 l40s l4 a100 vram inventory',
  '/dashboard/provider/capacity': 'capacity health uptime telemetry maintenance nodes status',
  '/dashboard/provider/workloads': 'workloads deployments inference models running endpoints',
  '/dashboard/provider/analytics': 'provider analytics telemetry charts utilization throughput latency',
  '/dashboard/provider/earnings': 'earnings payouts revenue billing settlements invoices',
  '/dashboard/provider/integrations': 'integrations api webhook adapter maintenance settings',
  '/dashboard/provider/profile': 'provider profile datacenter facilities tier specifications',
  '/dashboard/super-admin': 'super admin governance rbac security overview',
  '/dashboard/super-admin/accounts': 'admin accounts administrators staff suspend',
  '/dashboard/super-admin/roles': 'role management rbac roles',
  '/dashboard/super-admin/permissions': 'permission management access matrix policies',
  '/dashboard/super-admin/activity': 'activity monitoring telemetry admin actions live',
  '/dashboard/super-admin/audit': 'audit logs compliance security trail',
}

function readStoredListings(): StoredProviderListing[] {
  try {
    const raw = localStorage.getItem('inferxe_demo_provider_listings_v1')
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as StoredProviderListing[]) : []
  } catch {
    return []
  }
}

function getCategoryIcon(category: SearchCategory) {
  switch (category) {
    case 'Customers':
    case 'Users Directory':
      return Users
    case 'GPUs & Inventory':
      return Cpu
    case 'Telemetry & Nodes':
      return Globe
    case 'Super Admin':
      return ShieldCheck
    default:
      return LayoutDashboard
  }
}

export function AdminHeaderSearch({ sections, isSuperAdmin }: AdminHeaderSearchProps) {
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)

  // Live customer results from backend /api/admin/customers
  const [customerMatches, setCustomerMatches] = useState<CustomerRecord[]>([])
  const [loadingCustomers, setLoadingCustomers] = useState(false)
  const customerReqSeqRef = useRef(0)

  // Live directory users loaded lazily from /api/admin/data/users
  const [directoryUsers, setDirectoryUsers] = useState<UserRecord[]>([])
  const usersLoadedRef = useRef(false)

  // Intercept Cmd+K / Ctrl+K while inside the Admin Portal to focus this search bar
  useEffect(() => {
    const onGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        e.stopPropagation()
        inputRef.current?.focus()
        inputRef.current?.select()
        setOpen(true)
      }
    }
    window.addEventListener('keydown', onGlobalKeyDown, { capture: true })
    return () => {
      window.removeEventListener('keydown', onGlobalKeyDown, { capture: true })
    }
  }, [])

  // Close dropdown on click outside
  useEffect(() => {
    if (!open) return
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('touchstart', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('touchstart', handleClickOutside)
    }
  }, [open])

  // Lazily fetch real directory users once when search is opened
  useEffect(() => {
    if (!open || usersLoadedRef.current) return
    usersLoadedRef.current = true
    let active = true
    void loadUsers()
      .then((records) => {
        if (active) setDirectoryUsers(records)
      })
      .catch(() => {
        /* silently ignore if backend is offline or unauthorized */
      })
    return () => {
      active = false
    }
  }, [open])

  // Debounced live customer search via existing /api/admin/customers endpoint
  useEffect(() => {
    const trimmed = query.trim()
    if (!open || trimmed.length === 0) {
      setCustomerMatches([])
      setLoadingCustomers(false)
      return
    }

    const reqId = ++customerReqSeqRef.current
    setLoadingCustomers(true)

    const timer = window.setTimeout(() => {
      void fetchCustomers({ search: trimmed, limit: 5, page: 1 })
        .then((res) => {
          if (customerReqSeqRef.current === reqId) {
            setCustomerMatches(res.customers || [])
            setLoadingCustomers(false)
          }
        })
        .catch(() => {
          if (customerReqSeqRef.current === reqId) {
            setCustomerMatches([])
            setLoadingCustomers(false)
          }
        })
    }, 160)

    return () => {
      window.clearTimeout(timer)
    }
  }, [query, open])

  // Build searchable Admin sections (only routes actually accessible to the current admin)
  const allSections = useMemo<AdminSearchSectionItem[]>(() => {
    const extras: AdminSearchSectionItem[] = [
      { label: 'Add User', to: '/dashboard/users/add', group: 'Administration' },
    ]
    const seen = new Set(sections.map((s) => s.to))
    return [...sections, ...extras.filter((e) => !seen.has(e.to))]
  }, [sections])

  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase()

    // Empty query: show quick access to available Admin sections
    if (!q) {
      return allSections.slice(0, 8).map((sec) => ({
        id: `sec:${sec.to}`,
        category: 'Admin Sections',
        title: sec.label,
        subtitle: sec.group,
        to: sec.to,
      }))
    }

    const items: SearchResultItem[] = []

    // 1. Matching Admin / Provider / Super Admin sections
    for (const sec of allSections) {
      const kw = `${sec.label} ${sec.group} ${sec.to} ${sec.keywords ?? ''} ${SECTION_KEYWORDS[sec.to] ?? ''}`.toLowerCase()
      if (kw.includes(q)) {
        items.push({
          id: `sec:${sec.to}`,
          category: 'Admin Sections',
          title: sec.label,
          subtitle: `${sec.group} · ${sec.to}`,
          to: sec.to,
        })
      }
    }

    // 2. Live Customers from backend API
    for (const c of customerMatches) {
      const searchTarget = c.email || c.full_name
      items.push({
        id: `cust:${c.customer_id}`,
        category: 'Customers',
        title: c.full_name || c.email,
        subtitle: [c.email, c.organization].filter(Boolean).join(' · '),
        badge: c.activity_status,
        to: `/dashboard/customers?search=${encodeURIComponent(searchTarget)}`,
      })
    }

    // 3. Live Directory Users from /api/admin/data/users
    let userCount = 0
    for (const u of directoryUsers) {
      if (userCount >= 4) break
      const hay = `${u.fullName} ${u.email} ${u.username} ${u.role} ${u.status}`.toLowerCase()
      if (hay.includes(q)) {
        userCount++
        items.push({
          id: `usr:${u.id}`,
          category: 'Users Directory',
          title: u.fullName,
          subtitle: `${u.email} · ${u.role}`,
          badge: u.status,
          to: `/dashboard/users?search=${encodeURIComponent(u.email || u.fullName)}`,
        })
      }
    }

    // 4. GPUs (stored provider listings + reference GPUS catalog from data/gpus.ts)
    const seenGpuKeys = new Set<string>()
    const storedListings = readStoredListings()
    for (const listing of storedListings) {
      const name = listing.name || listing.gpu || ''
      const hay = `${name} ${listing.gpu ?? ''} ${listing.vram ?? ''} ${listing.region ?? ''} ${listing.arch ?? ''} ${listing.status ?? ''} gpu inventory listing`.toLowerCase()
      if (name && hay.includes(q)) {
        const key = (listing.gpu || name).toLowerCase()
        seenGpuKeys.add(key)
        items.push({
          id: `listing:${listing.id || name}`,
          category: 'GPUs & Inventory',
          title: name,
          subtitle: [listing.vram, listing.region, listing.price ? `₹${listing.price}/hr` : null].filter(Boolean).join(' · '),
          badge: listing.status || undefined,
          to: '/dashboard/provider/listings',
        })
      }
    }

    for (const gpu of GPUS) {
      if (seenGpuKeys.has(gpu.id.toLowerCase()) || seenGpuKeys.has(gpu.name.toLowerCase())) continue
      const hay = `nvidia ${gpu.name} ${gpu.id} ${gpu.vramLabel} ${gpu.arch} ${gpu.tier} ${gpu.status} ${gpu.role} ${gpu.uses.join(' ')} gpu`.toLowerCase()
      if (hay.includes(q)) {
        items.push({
          id: `gpu:${gpu.id}`,
          category: 'GPUs & Inventory',
          title: `NVIDIA ${gpu.name}`,
          subtitle: `${gpu.vramLabel} · ${gpu.arch} · ${gpu.tier}${gpu.rate ? ` · ₹${gpu.rate}/hr` : ''}`,
          badge: gpu.status,
          to: '/dashboard/provider/listings',
        })
      }
    }

    // 5. Telemetry, Sovereign Nodes, Providers & Models
    for (const node of GEO_DISTRIBUTION) {
      if (node.id === 'other') continue
      const hay = `${node.name} ${node.region} ${node.dc ?? ''} ${node.latency} telemetry sovereign nodes map cluster`.toLowerCase()
      if (hay.includes(q)) {
        items.push({
          id: `node:${node.id}`,
          category: 'Telemetry & Nodes',
          title: `${node.name} — ${node.region}`,
          subtitle: [node.dc, `${node.nodes} nodes`, node.latency].filter(Boolean).join(' · '),
          badge: 'Telemetry',
          to: '/dashboard/users/map',
        })
      }
    }

    for (const prov of AVAILABLE_PROVIDERS) {
      const hay = `${prov.name} ${prov.region} ${prov.tier} ${prov.latency} provider datacenter telemetry capacity`.toLowerCase()
      if (hay.includes(q)) {
        items.push({
          id: `prov:${prov.id}`,
          category: 'Telemetry & Nodes',
          title: prov.name,
          subtitle: `${prov.region} · ${prov.tier} · ${prov.latency}`,
          badge: 'Datacenter',
          to: '/dashboard/provider/capacity',
        })
      }
    }

    for (const model of AVAILABLE_MODELS) {
      const hay = `${model.name} ${model.tag} ${model.category} model workload inference`.toLowerCase()
      if (hay.includes(q)) {
        items.push({
          id: `model:${model.id}`,
          category: 'Telemetry & Nodes',
          title: `${model.name} (${model.tag})`,
          subtitle: `Workload Model · ${model.category}`,
          badge: 'Model',
          to: '/dashboard/provider/workloads',
        })
      }
    }

    // 6. Super Admin live accounts & roles (only if current user has Super Admin access)
    if (isSuperAdmin) {
      try {
        const accounts = getAdminAccounts()
        let acctCount = 0
        for (const acct of accounts) {
          if (acctCount >= 3) break
          const hay = `${acct.fullName} ${acct.email} ${acct.role} ${acct.department ?? ''} ${acct.status}`.toLowerCase()
          if (hay.includes(q)) {
            acctCount++
            items.push({
              id: `sa-acct:${acct.id}`,
              category: 'Super Admin',
              title: acct.fullName,
              subtitle: `${acct.email} · ${acct.role.replace(/_/g, ' ')}`,
              badge: acct.status,
              to: '/dashboard/super-admin/accounts',
            })
          }
        }
      } catch {
        /* ignore */
      }

      try {
        const roles = getAllRoles()
        let roleCount = 0
        for (const r of roles) {
          if (roleCount >= 3) break
          const hay = `${r.name} ${r.description} ${r.id} role rbac`.toLowerCase()
          if (hay.includes(q)) {
            roleCount++
            items.push({
              id: `sa-role:${r.id}`,
              category: 'Super Admin',
              title: r.name,
              subtitle: r.description,
              badge: 'Role',
              to: '/dashboard/super-admin/roles',
            })
          }
        }
      } catch {
        /* ignore */
      }
    }

    return items.slice(0, 14)
  }, [query, allSections, customerMatches, directoryUsers, isSuperAdmin])

  // Group results while keeping flat indices for keyboard navigation
  const groupedResults = useMemo(() => {
    const groups: Array<{ category: SearchCategory; items: Array<SearchResultItem & { flatIndex: number }> }> = []
    const map = new Map<SearchCategory, Array<SearchResultItem & { flatIndex: number }>>()
    results.forEach((item, idx) => {
      const list = map.get(item.category) ?? []
      list.push({ ...item, flatIndex: idx })
      if (!map.has(item.category)) {
        map.set(item.category, list)
        groups.push({ category: item.category, items: list })
      }
    })
    return groups
  }, [results])

  // Keep activeIndex in bounds whenever results change
  useEffect(() => {
    setActiveIndex(0)
  }, [query, results.length])

  // Keep keyboard-selected item scrolled into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const activeEl = listRef.current.querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)
    if (activeEl && typeof activeEl.scrollIntoView === 'function') {
      activeEl.scrollIntoView({ block: 'nearest' })
    }
  }, [activeIndex, open])

  const selectResult = (item: SearchResultItem) => {
    setOpen(false)
    setQuery('')
    inputRef.current?.blur()
    navigate(item.to)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) {
        setOpen(true)
        return
      }
      if (results.length > 0) {
        setActiveIndex((prev) => (prev + 1) % results.length)
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (results.length > 0) {
        setActiveIndex((prev) => (prev - 1 + results.length) % results.length)
      }
    } else if (e.key === 'Enter') {
      if (open && results[activeIndex]) {
        e.preventDefault()
        selectResult(results[activeIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (query) {
        setQuery('')
      } else {
        setOpen(false)
        inputRef.current?.blur()
      }
    }
  }

  const renderItemIcon = (item: SearchResultItem) => {
    if (item.id.startsWith('sa-role:')) return <KeyRound size={14} />
    if (item.id.startsWith('prov:')) return <Server size={14} />
    if (item.id.startsWith('model:')) return <Activity size={14} />
    const IconComp = getCategoryIcon(item.category)
    return <IconComp size={14} />
  }

  return (
    <div ref={containerRef} className={`admin-search-wrap ${open ? 'is-open' : ''}`}>
      <div
        className="verdelo-search-pill"
        onClick={() => {
          inputRef.current?.focus()
          setOpen(true)
        }}
      >
        <Search size={14} className="verdelo-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          className="admin-search-input"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder="Search customers, GPUs, telemetry..."
          aria-label="Search customers, GPUs, telemetry, and Admin sections"
          role="combobox"
          aria-expanded={open}
          aria-controls="admin-header-search-results"
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
        />
        {query ? (
          <button
            type="button"
            className="admin-search-clear-btn"
            aria-label="Clear search"
            onClick={(e) => {
              e.stopPropagation()
              setQuery('')
              inputRef.current?.focus()
            }}
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="verdelo-search-kbd">⌘K</kbd>
        )}
      </div>

      {open && (
        <div
          id="admin-header-search-results"
          ref={listRef}
          className="admin-search-dropdown"
          role="listbox"
          aria-label="Admin search results"
        >
          {groupedResults.length > 0 ? (
            groupedResults.map((group) => (
              <div key={group.category} className="admin-search-group">
                <div className="admin-search-group-label">
                  <span>{query.trim() ? group.category : 'Quick Navigation'}</span>
                  {group.category === 'Customers' && loadingCustomers && (
                    <span className="admin-search-syncing">Searching…</span>
                  )}
                </div>
                {group.items.map((item) => {
                  const isActive = item.flatIndex === activeIndex
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={isActive}
                      data-search-index={item.flatIndex}
                      className={`admin-search-option ${isActive ? 'is-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(item.flatIndex)}
                      onMouseDown={(e) => {
                        e.preventDefault()
                        selectResult(item)
                      }}
                    >
                      <span className="admin-search-option-icon" aria-hidden="true">
                        {renderItemIcon(item)}
                      </span>
                      <span className="admin-search-option-body">
                        <span className="admin-search-option-title">{item.title}</span>
                        <span className="admin-search-option-sub">{item.subtitle}</span>
                      </span>
                      {item.badge && (
                        <span className="admin-search-option-badge">{item.badge}</span>
                      )}
                      {isActive && (
                        <CornerDownLeft size={12} className="admin-search-option-enter" aria-hidden="true" />
                      )}
                    </button>
                  )
                })}
              </div>
            ))
          ) : (
            <div className="admin-search-empty">
              {loadingCustomers
                ? 'Searching customers, GPUs, and telemetry…'
                : `No matching sections, customers, GPUs, or telemetry found for “${query.trim()}”.`}
            </div>
          )}

          <div className="admin-search-footer">
            <span>↑↓ Navigate</span>
            <span>↵ Open</span>
            <span>Esc Clear</span>
          </div>
        </div>
      )}
    </div>
  )
}

