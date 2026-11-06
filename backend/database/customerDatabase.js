// @ts-nocheck
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import crypto from 'node:crypto'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '../..')
const DB_DIR = path.join(ROOT_DIR, 'database')
const DB_PATH = path.join(DB_DIR, 'inferxe_customers.db')
const BACKUP_DIR = path.join(DB_DIR, 'backups')

// Ensure database and backup directories exist
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true })
}
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true })
}

let dbInstance = null

export function getDatabase() {
  if (!dbInstance) {
    dbInstance = new DatabaseSync(DB_PATH)
    // Enable Write-Ahead Logging (WAL) for high concurrency and resilience
    dbInstance.exec('PRAGMA journal_mode = WAL;')
    dbInstance.exec('PRAGMA synchronous = NORMAL;')
    dbInstance.exec('PRAGMA busy_timeout = 5000;')
    dbInstance.exec('PRAGMA foreign_keys = ON;')
    runMigrations(dbInstance)
  }
  return dbInstance
}

/**
 * Execute schema migrations in order to guarantee database reliability and evolution.
 */
function runMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `)

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all()
  const applied = new Set(appliedRows.map((r) => r.version))

  // Migration 1: Initial core schema
  if (!applied.has(1)) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        customer_id TEXT PRIMARY KEY,
        cognito_sub TEXT UNIQUE,
        full_name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        phone_number TEXT,
        organization TEXT,
        role TEXT DEFAULT 'customer',
        registration_date TEXT NOT NULL,
        last_login_at TEXT,
        last_active_at TEXT NOT NULL,
        last_heartbeat_at TEXT NOT NULL,
        account_status TEXT DEFAULT 'active',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS customer_activity_logs (
        id TEXT PRIMARY KEY,
        customer_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        event_timestamp TEXT NOT NULL,
        metadata TEXT,
        FOREIGN KEY (customer_id) REFERENCES customers(customer_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
      CREATE INDEX IF NOT EXISTS idx_customers_cognito_sub ON customers(cognito_sub);
      CREATE INDEX IF NOT EXISTS idx_customers_last_active ON customers(last_active_at);
      CREATE INDEX IF NOT EXISTS idx_activity_customer_id ON customer_activity_logs(customer_id);
      CREATE INDEX IF NOT EXISTS idx_activity_timestamp ON customer_activity_logs(event_timestamp);
    `)

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      1,
      '001_initial_core_schema',
      new Date().toISOString(),
    )
  }

  // Migration 2: Add login_count and additional performance indexes
  if (!applied.has(2)) {
    const tableInfo = db.prepare("PRAGMA table_info('customers')").all()
    const hasLoginCount = tableInfo.some((col) => col.name === 'login_count')
    if (!hasLoginCount) {
      db.exec('ALTER TABLE customers ADD COLUMN login_count INTEGER DEFAULT 0;')
    }

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_customers_account_status ON customers(account_status);
      CREATE INDEX IF NOT EXISTS idx_customers_registration ON customers(registration_date);
    `)

    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
      2,
      '002_add_login_count_and_indexes',
      new Date().toISOString(),
    )
  }
}

/**
 * Calculate Activity Status according to Inferxe rules:
 * - Online: Heartbeat within the previous 2 minutes (120,000 ms)
 * - Active: Not Online, but last active within 5 consecutive days (432,000,000 ms)
 * - Inactive: No recorded activity for 5 consecutive days or more
 */
export function computeActivityStatus(lastActiveAt, lastHeartbeatAt) {
  const now = Date.now()
  const heartbeatTime = lastHeartbeatAt ? new Date(lastHeartbeatAt).getTime() : 0
  const activeTime = lastActiveAt ? new Date(lastActiveAt).getTime() : 0

  // 1. Online: Heartbeat within previous 2 minutes (120,000 ms)
  if (heartbeatTime > 0 && now - heartbeatTime <= 2 * 60 * 1000) {
    return 'Online'
  }

  // 2. Active: Not Online, but activity occurred within 5 consecutive days
  const fiveDaysMs = 5 * 24 * 60 * 60 * 1000
  if (activeTime > 0 && now - activeTime < fiveDaysMs) {
    return 'Active'
  }

  // 3. Inactive: 5 consecutive days or more without activity
  return 'Inactive'
}

/**
 * Register or update customer profile in the persistent database.
 * Preserves existing activity history, registration timestamps, and deduplicates by Cognito sub or email.
 */
export function registerOrUpdateCustomer({
  cognito_sub,
  full_name,
  email,
  phone_number = null,
  organization = null,
  role = 'customer',
  account_status = 'active',
  isLogin = false,
  metadata = {},
}) {
  const db = getDatabase()
  const nowIso = new Date().toISOString()
  const cleanEmail = (email || '').trim().toLowerCase()

  if (!cleanEmail) {
    throw new Error('Valid email address is required to register a customer.')
  }

  const cleanName =
    (full_name || '').trim() ||
    cleanEmail
      .split('@')[0]
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase())

  // Check existing by cognito_sub or email
  let existing = null
  if (cognito_sub) {
    existing = db.prepare('SELECT * FROM customers WHERE cognito_sub = ?').get(cognito_sub)
  }
  if (!existing) {
    existing = db.prepare('SELECT * FROM customers WHERE email = ?').get(cleanEmail)
  }

  if (existing) {
    // Update existing customer record
    const customerId = existing.customer_id
    const updatedSub = cognito_sub || existing.cognito_sub
    const updatedPhone = phone_number || existing.phone_number
    const updatedOrg = organization || existing.organization
    const updatedRole = role || existing.role || 'customer'
    const lastLogin = isLogin ? nowIso : existing.last_login_at
    const lastActive = nowIso
    const lastHeartbeat = isLogin ? nowIso : existing.last_heartbeat_at

    db.prepare(`
      UPDATE customers
      SET
        cognito_sub = ?,
        full_name = ?,
        phone_number = ?,
        organization = ?,
        role = ?,
        last_login_at = ?,
        last_active_at = ?,
        last_heartbeat_at = ?,
        account_status = ?,
        login_count = CASE WHEN ? THEN COALESCE(login_count, 0) + 1 ELSE COALESCE(login_count, 0) END,
        updated_at = ?
      WHERE customer_id = ?
    `).run(
      updatedSub,
      cleanName,
      updatedPhone,
      updatedOrg,
      updatedRole,
      lastLogin,
      lastActive,
      lastHeartbeat,
      account_status,
      isLogin ? 1 : 0,
      nowIso,
      customerId,
    )

    // Log meaningful activity event (Login)
    if (isLogin) {
      logCustomerActivity({
        customer_id: customerId,
        event_type: 'login',
        event_timestamp: nowIso,
        metadata: {
          client: 'Inferxe Web Console',
          email: cleanEmail,
          organization: updatedOrg,
          ...metadata,
        },
      })
    }

    const updated = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customerId)
    return {
      ...updated,
      activity_status: computeActivityStatus(updated.last_active_at, updated.last_heartbeat_at),
    }
  } else {
    // Create new customer record
    const customerId = `cst_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
    const sub = cognito_sub || `sub_${crypto.randomUUID().replace(/-/g, '')}`

    db.prepare(`
      INSERT INTO customers (
        customer_id,
        cognito_sub,
        full_name,
        email,
        phone_number,
        organization,
        role,
        registration_date,
        last_login_at,
        last_active_at,
        last_heartbeat_at,
        account_status,
        login_count,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      customerId,
      sub,
      cleanName,
      cleanEmail,
      phone_number,
      organization,
      role,
      nowIso,
      isLogin ? nowIso : null,
      nowIso,
      nowIso,
      account_status,
      isLogin ? 1 : 0,
      nowIso,
      nowIso,
    )

    // Log Registration event
    logCustomerActivity({
      customer_id: customerId,
      event_type: 'registration',
      event_timestamp: nowIso,
      metadata: {
        registration_source: 'AWS Cognito Self-Service',
        email: cleanEmail,
        organization,
        ...metadata,
      },
    })

    if (isLogin) {
      logCustomerActivity({
        customer_id: customerId,
        event_type: 'login',
        event_timestamp: nowIso,
        metadata: {
          client: 'Inferxe Web Console',
          email: cleanEmail,
        },
      })
    }

    const created = db.prepare('SELECT * FROM customers WHERE customer_id = ?').get(customerId)
    return {
      ...created,
      activity_status: computeActivityStatus(created.last_active_at, created.last_heartbeat_at),
    }
  }
}

/**
 * Synchronize existing registered customers (e.g. from Cognito user pools or registry).
 * - Deduplicates using Cognito sub and email.
 * - Prevents duplicate records.
 * - DOES NOT overwrite existing activity history, registration dates, or login timestamps.
 */
export function syncCustomersBatch(customersList = []) {
  const db = getDatabase()
  const nowIso = new Date().toISOString()
  let syncedCount = 0
  let updatedCount = 0
  let newCount = 0

  for (const raw of customersList) {
    const email = (raw.email || '').trim().toLowerCase()
    if (!email) continue
    const cognito_sub = (raw.cognito_sub || raw.sub || '').trim() || null

    let existing = null
    if (cognito_sub) {
      existing = db.prepare('SELECT * FROM customers WHERE cognito_sub = ?').get(cognito_sub)
    }
    if (!existing) {
      existing = db.prepare('SELECT * FROM customers WHERE email = ?').get(email)
    }

    if (existing) {
      // Backfill missing fields without resetting active or historical timestamps
      const updatedSub = cognito_sub || existing.cognito_sub
      const updatedPhone = raw.phone_number || raw.phone || existing.phone_number
      const updatedOrg = raw.organization || existing.organization
      const updatedName = (raw.full_name || raw.name || '').trim() || existing.full_name

      db.prepare(`
        UPDATE customers
        SET
          cognito_sub = ?,
          full_name = ?,
          phone_number = ?,
          organization = ?,
          updated_at = ?
        WHERE customer_id = ?
      `).run(updatedSub, updatedName, updatedPhone, updatedOrg, nowIso, existing.customer_id)

      updatedCount++
    } else {
      const customerId = `cst_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
      const sub = cognito_sub || `sub_${crypto.randomUUID().replace(/-/g, '')}`
      const name = (raw.full_name || raw.name || '').trim() || email.split('@')[0]
      const regDate = raw.registration_date || raw.created_at || nowIso

      db.prepare(`
        INSERT INTO customers (
          customer_id,
          cognito_sub,
          full_name,
          email,
          phone_number,
          organization,
          role,
          registration_date,
          last_login_at,
          last_active_at,
          last_heartbeat_at,
          account_status,
          login_count,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        customerId,
        sub,
        name,
        email,
        raw.phone_number || raw.phone || null,
        raw.organization || null,
        raw.role || 'customer',
        regDate,
        raw.last_login_at || null,
        raw.last_active_at || regDate,
        raw.last_heartbeat_at || regDate,
        raw.account_status || 'active',
        raw.login_count || (raw.last_login_at ? 1 : 0),
        regDate,
        nowIso,
      )

      logCustomerActivity({
        customer_id: customerId,
        event_type: 'registration',
        event_timestamp: regDate,
        metadata: {
          source: 'Cognito Customer Sync',
          synced_at: nowIso,
        },
      })

      newCount++
    }
    syncedCount++
  }

  return { ok: true, syncedCount, updatedCount, newCount }
}

// In-memory heartbeat cache to debounce high-frequency database writes (avoids excessive writes while staying lightweight)
const lastHeartbeatCache = new Map()

/**
 * Record customer heartbeat.
 * Updates last_heartbeat_at and last_active_at in customers table.
 * Debounced: Skips DB write if last heartbeat was within the last 25 seconds.
 * NOTE: Heartbeats DO NOT write to customer_activity_logs (per specification).
 */
export function recordHeartbeat({ cognito_sub, email }) {
  const db = getDatabase()
  const cleanEmail = (email || '').trim().toLowerCase()
  if (!cleanEmail && !cognito_sub) return false

  const cacheKey = cognito_sub || cleanEmail
  const now = Date.now()
  const lastTime = lastHeartbeatCache.get(cacheKey) || 0

  // Debounce: 25 seconds
  if (now - lastTime < 25000) {
    return true
  }

  const nowIso = new Date(now).toISOString()

  let customer = null
  if (cognito_sub) {
    customer = db.prepare('SELECT customer_id FROM customers WHERE cognito_sub = ?').get(cognito_sub)
  }
  if (!customer && cleanEmail) {
    customer = db.prepare('SELECT customer_id FROM customers WHERE email = ?').get(cleanEmail)
  }

  if (customer) {
    db.prepare(`
      UPDATE customers
      SET last_heartbeat_at = ?, last_active_at = ?, updated_at = ?
      WHERE customer_id = ?
    `).run(nowIso, nowIso, nowIso, customer.customer_id)

    lastHeartbeatCache.set(cacheKey, now)
    return true
  }

  return false
}

/**
 * Record customer logout event.
 */
export function recordCustomerLogout({ cognito_sub, email }) {
  const db = getDatabase()
  const cleanEmail = (email || '').trim().toLowerCase()
  if (!cleanEmail && !cognito_sub) return false

  let customer = null
  if (cognito_sub) {
    customer = db.prepare('SELECT customer_id FROM customers WHERE cognito_sub = ?').get(cognito_sub)
  }
  if (!customer && cleanEmail) {
    customer = db.prepare('SELECT customer_id FROM customers WHERE email = ?').get(cleanEmail)
  }

  if (customer) {
    const nowIso = new Date().toISOString()
    // Set last_heartbeat_at to 3 minutes ago so customer status transitions off 'Online' immediately
    const pastHeartbeat = new Date(Date.now() - 3 * 60 * 1000).toISOString()

    db.prepare(`
      UPDATE customers
      SET last_heartbeat_at = ?, updated_at = ?
      WHERE customer_id = ?
    `).run(pastHeartbeat, nowIso, customer.customer_id)

    logCustomerActivity({
      customer_id: customer.customer_id,
      event_type: 'logout',
      event_timestamp: nowIso,
      metadata: { action: 'Session closed by user' },
    })

    const cacheKey = cognito_sub || cleanEmail
    lastHeartbeatCache.delete(cacheKey)
    return true
  }

  return false
}

/**
 * Log meaningful customer activity event in customer_activity_logs.
 * Strips sensitive fields (passwords, tokens) to protect personal data.
 */
export function logCustomerActivity({ customer_id, event_type, event_timestamp, metadata = {} }) {
  const db = getDatabase()
  const logId = `act_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`

  // Strip sensitive metadata
  let safeMeta = {}
  if (typeof metadata === 'object' && metadata !== null) {
    safeMeta = { ...metadata }
    delete safeMeta.password
    delete safeMeta.passwordHash
    delete safeMeta.token
    delete safeMeta.secret
  }

  const metaStr = JSON.stringify(safeMeta)

  db.prepare(`
    INSERT INTO customer_activity_logs (id, customer_id, event_type, event_timestamp, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(logId, customer_id, event_type, event_timestamp || new Date().toISOString(), metaStr)
}

/**
 * Retrieve all customers with search, status filtering, sorting, and pagination.
 * Computes Activity Status (Online, Active, Inactive) dynamically for every customer.
 * Inactive customers are NEVER excluded.
 */
export function listCustomers({
  search = '',
  status = 'all', // 'all' | 'online' | 'active' | 'inactive'
  sortBy = 'registration_date', // 'registration_date' | 'last_active' | 'full_name' | 'email'
  sortOrder = 'desc',
  page = 1,
  limit = 20,
}) {
  const db = getDatabase()
  const cleanSearch = (search || '').trim().toLowerCase()

  let rows = db.prepare(`SELECT * FROM customers`).all()

  // Attach computed activity status
  rows = rows.map((r) => ({
    ...r,
    activity_status: computeActivityStatus(r.last_active_at, r.last_heartbeat_at),
  }))

  // Apply search query across name, email, customer_id, organization
  if (cleanSearch) {
    rows = rows.filter(
      (r) =>
        r.full_name.toLowerCase().includes(cleanSearch) ||
        r.email.toLowerCase().includes(cleanSearch) ||
        r.customer_id.toLowerCase().includes(cleanSearch) ||
        (r.organization && r.organization.toLowerCase().includes(cleanSearch)) ||
        (r.cognito_sub && r.cognito_sub.toLowerCase().includes(cleanSearch)),
    )
  }

  // Apply status filter
  if (status && status !== 'all') {
    const targetStatus = status.toLowerCase()
    rows = rows.filter((r) => r.activity_status.toLowerCase() === targetStatus)
  }

  // Apply sorting
  rows.sort((a, b) => {
    let valA = a[sortBy] || ''
    let valB = b[sortBy] || ''

    if (sortBy === 'last_active') {
      valA = a.last_active_at || ''
      valB = b.last_active_at || ''
    }

    if (valA < valB) return sortOrder === 'asc' ? -1 : 1
    if (valA > valB) return sortOrder === 'asc' ? 1 : -1
    return 0
  })

  const total = rows.length
  const pageNum = Math.max(1, parseInt(page, 10) || 1)
  const pageSize = Math.max(1, Math.min(100, parseInt(limit, 10) || 20))
  const totalPages = Math.ceil(total / pageSize) || 1
  const startIndex = (pageNum - 1) * pageSize
  const paginatedRows = rows.slice(startIndex, startIndex + pageSize)

  return {
    customers: paginatedRows,
    pagination: {
      total,
      page: pageNum,
      limit: pageSize,
      totalPages,
    },
  }
}

/**
 * Retrieve activity summary metrics (Total, Online, Active, Inactive).
 */
export function getCustomerSummary() {
  const db = getDatabase()
  const rows = db.prepare(`SELECT last_active_at, last_heartbeat_at FROM customers`).all()

  let online = 0
  let active = 0
  let inactive = 0

  for (const r of rows) {
    const st = computeActivityStatus(r.last_active_at, r.last_heartbeat_at)
    if (st === 'Online') online++
    else if (st === 'Active') active++
    else inactive++
  }

  return {
    total: rows.length,
    online,
    active,
    inactive,
  }
}

/**
 * Retrieve a specific customer's full profile, login history, and activity log ledger.
 */
export function getCustomerDetails(idOrSubOrEmail) {
  const db = getDatabase()
  const target = (idOrSubOrEmail || '').trim()

  const customer = db.prepare(`
    SELECT * FROM customers
    WHERE customer_id = ? OR cognito_sub = ? OR email = ?
  `).get(target, target, target.toLowerCase())

  if (!customer) return null

  const activityStatus = computeActivityStatus(customer.last_active_at, customer.last_heartbeat_at)

  // Retrieve previous login timestamps
  const loginLogs = db.prepare(`
    SELECT event_timestamp FROM customer_activity_logs
    WHERE customer_id = ? AND event_type = 'login'
    ORDER BY event_timestamp DESC
    LIMIT 20
  `).all(customer.customer_id)

  const previousLogins = loginLogs.map((l) => l.event_timestamp)
  const totalLogins = Math.max(customer.login_count || 0, previousLogins.length)

  // Retrieve all activity logs (chronological)
  const logs = db.prepare(`
    SELECT * FROM customer_activity_logs
    WHERE customer_id = ?
    ORDER BY event_timestamp DESC
    LIMIT 50
  `).all(customer.customer_id)

  const parsedLogs = logs.map((l) => {
    let meta = {}
    try {
      meta = l.metadata ? JSON.parse(l.metadata) : {}
    } catch {
      meta = { raw: l.metadata }
    }
    return {
      ...l,
      metadata: meta,
    }
  })

  return {
    ...customer,
    login_count: totalLogins,
    previous_logins: previousLogins,
    activity_status: activityStatus,
    activity_logs: parsedLogs,
  }
}

/**
 * Export all customer records (including inactive) formatted as RFC 4180 CSV string.
 */
export function exportCustomersToCsv() {
  const db = getDatabase()
  const rows = db.prepare('SELECT * FROM customers ORDER BY registration_date DESC').all()

  const escapeCsv = (str) => {
    if (str === null || str === undefined) return ''
    const s = String(str)
    if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }

  const headers = [
    'Customer ID',
    'Cognito Sub',
    'Full Name',
    'Email',
    'Phone Number',
    'Organization',
    'Role',
    'Registration Date',
    'Last Login At',
    'Last Active At',
    'Last Heartbeat At',
    'Account Status',
    'Activity Status',
    'Total Logins',
    'Created At',
    'Updated At',
  ]

  const lines = [headers.join(',')]

  for (const r of rows) {
    const activityStatus = computeActivityStatus(r.last_active_at, r.last_heartbeat_at)
    const line = [
      escapeCsv(r.customer_id),
      escapeCsv(r.cognito_sub),
      escapeCsv(r.full_name),
      escapeCsv(r.email),
      escapeCsv(r.phone_number),
      escapeCsv(r.organization),
      escapeCsv(r.role),
      escapeCsv(r.registration_date),
      escapeCsv(r.last_login_at),
      escapeCsv(r.last_active_at),
      escapeCsv(r.last_heartbeat_at),
      escapeCsv(r.account_status),
      escapeCsv(activityStatus),
      escapeCsv(r.login_count || 0),
      escapeCsv(r.created_at),
      escapeCsv(r.updated_at),
    ]
    lines.push(line.join(','))
  }

  return lines.join('\r\n')
}

/**
 * Create a timestamped backup of the SQLite database.
 */
export function backupDatabase() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const backupFileName = `inferxe_customers_backup_${timestamp}.db`
  const backupFilePath = path.join(BACKUP_DIR, backupFileName)

  const db = getDatabase()
  // Run PRAGMA wal_checkpoint to ensure all WAL pages are committed
  try {
    db.exec('PRAGMA wal_checkpoint(FULL);')
  } catch {}

  fs.copyFileSync(DB_PATH, backupFilePath)
  const stats = fs.statSync(backupFilePath)

  return {
    ok: true,
    backupFile: backupFileName,
    backupPath: backupFilePath,
    sizeBytes: stats.size,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Restore customer database from an existing backup file.
 */
export function restoreDatabase(backupFileName) {
  const cleanFileName = path.basename(backupFileName)
  const backupFilePath = path.join(BACKUP_DIR, cleanFileName)

  if (!fs.existsSync(backupFilePath)) {
    throw new Error(`Backup file not found: ${cleanFileName}`)
  }

  const stats = fs.statSync(backupFilePath)
  if (stats.size === 0) {
    throw new Error('Backup file is empty')
  }

  // Close active connection
  if (dbInstance) {
    try {
      dbInstance.exec('PRAGMA wal_checkpoint(FULL);')
      dbInstance.close()
    } catch {}
    dbInstance = null
  }

  // Remove existing WAL & SHM files to ensure clean state
  try {
    if (fs.existsSync(DB_PATH + '-wal')) fs.unlinkSync(DB_PATH + '-wal')
    if (fs.existsSync(DB_PATH + '-shm')) fs.unlinkSync(DB_PATH + '-shm')
  } catch {}

  // Overwrite DB_PATH with backup file
  fs.copyFileSync(backupFilePath, DB_PATH)

  // Re-open and verify restored database
  const restoredDb = getDatabase()
  const countRow = restoredDb.prepare('SELECT COUNT(*) AS count FROM customers').get()

  return {
    ok: true,
    restoredFrom: cleanFileName,
    customerCount: countRow?.count || 0,
    timestamp: new Date().toISOString(),
  }
}

/**
 * Seed initial/sample customers into the database if the database is currently empty.
 */
export function seedInitialCustomersIfEmpty() {
  const db = getDatabase()
  const countRow = db.prepare('SELECT COUNT(*) AS count FROM customers').get()
  if (countRow && countRow.count > 0) {
    return
  }

  const now = Date.now()
  const dayMs = 24 * 60 * 60 * 1000

  const initialCustomers = [
    {
      cognito_sub: 'c7b41982-5d93-4a61-9dfa-8b1a3e9c4001',
      full_name: 'Sahith V',
      email: 'sahith1689vss@gmail.com',
      phone_number: '+919876543210',
      organization: 'VSS Sovereign Cloud Labs',
      role: 'customer',
      registration_date: new Date(now - 14 * dayMs).toISOString(),
      last_login_at: new Date(now - 30 * 60 * 1000).toISOString(),
      last_active_at: new Date(now - 20 * 1000).toISOString(),
      last_heartbeat_at: new Date(now - 20 * 1000).toISOString(),
      login_count: 12,
    },
    {
      cognito_sub: 'a1f82c40-3e11-4791-b1e2-9d3c5f7a2002',
      full_name: 'Priya Sharma',
      email: 'priya.s@novatech.ai',
      phone_number: '+919811223344',
      organization: 'NovaTech AI Systems',
      role: 'customer',
      registration_date: new Date(now - 30 * dayMs).toISOString(),
      last_login_at: new Date(now - 1 * dayMs).toISOString(),
      last_active_at: new Date(now - 1 * dayMs).toISOString(),
      last_heartbeat_at: new Date(now - 1 * dayMs).toISOString(),
      login_count: 5,
    },
    {
      cognito_sub: 'e5d93b11-7c22-4a82-9f33-1a2b4c5d3003',
      full_name: 'Rohan Verma',
      email: 'rohan.v@finscale.in',
      phone_number: '+919900112233',
      organization: 'FinScale Technologies',
      role: 'customer',
      registration_date: new Date(now - 45 * dayMs).toISOString(),
      last_login_at: new Date(now - 3 * dayMs).toISOString(),
      last_active_at: new Date(now - 3 * dayMs).toISOString(),
      last_heartbeat_at: new Date(now - 3 * dayMs).toISOString(),
      login_count: 8,
    },
    {
      cognito_sub: 'b3c41a77-9d88-4f11-8e22-6a7b8c9d4004',
      full_name: 'Ananya Deshmukh',
      email: 'ananya.d@finscale.in',
      phone_number: '+919844556677',
      organization: 'FinScale Technologies',
      role: 'customer',
      registration_date: new Date(now - 60 * dayMs).toISOString(),
      last_login_at: new Date(now - 7 * dayMs).toISOString(),
      last_active_at: new Date(now - 7 * dayMs).toISOString(),
      last_heartbeat_at: new Date(now - 7 * dayMs).toISOString(),
      login_count: 3,
    },
    {
      cognito_sub: 'f8e71d22-4c33-4b99-7a11-5d6e7f8a5005',
      full_name: 'Devon Vance',
      email: 'd.vance@quantcore.io',
      phone_number: '+14155552671',
      organization: 'QuantCore Research Ltd',
      role: 'customer',
      registration_date: new Date(now - 90 * dayMs).toISOString(),
      last_login_at: new Date(now - 18 * dayMs).toISOString(),
      last_active_at: new Date(now - 18 * dayMs).toISOString(),
      last_heartbeat_at: new Date(now - 18 * dayMs).toISOString(),
      login_count: 1,
    },
  ]

  for (const c of initialCustomers) {
    const customerId = `cst_${c.email.split('@')[0]}_seed`
    db.prepare(`
      INSERT INTO customers (
        customer_id, cognito_sub, full_name, email, phone_number, organization, role,
        registration_date, last_login_at, last_active_at, last_heartbeat_at, account_status,
        login_count, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `).run(
      customerId,
      c.cognito_sub,
      c.full_name,
      c.email,
      c.phone_number,
      c.organization,
      c.role,
      c.registration_date,
      c.last_login_at,
      c.last_active_at,
      c.last_heartbeat_at,
      c.login_count || 1,
      c.registration_date,
      c.last_active_at,
    )

    logCustomerActivity({
      customer_id: customerId,
      event_type: 'registration',
      event_timestamp: c.registration_date,
      metadata: { source: 'Initial Customer Seed', email: c.email },
    })

    if (c.last_login_at) {
      logCustomerActivity({
        customer_id: customerId,
        event_type: 'login',
        event_timestamp: c.last_login_at,
        metadata: { client: 'Inferxe Console' },
      })
    }
  }

  console.log('[Inferxe] Customer database seeded with initial records.')
}

// Auto-initialize schema, migrations and initial seed upon load
getDatabase()
seedInitialCustomersIfEmpty()
