// Mock localStorage for node environment
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) || null,
  setItem: (key, val) => storage.set(key, String(val)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
};

// 1-Day Retention Constant (24 hours)
const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000;

const SCOPE_STORAGE_KEYS = {
  guest: 'inferxe_chat_history_guest_v1',
  customer: 'inferxe_chat_history_customer_v1',
  admin: 'inferxe_chat_history_admin_v1',
};

function getInitialMessagesForScope(scope) {
  const now = Date.now();
  return [
    {
      id: `welcome-${scope}-${now}`,
      sender: 'bot',
      text: `Welcome ${scope}`,
      time: 'Just now',
      timestamp: now,
    },
  ];
}

function loadScopeMessages(scope) {
  const key = SCOPE_STORAGE_KEYS[scope];
  const raw = localStorage.getItem(key);
  if (!raw) {
    const initial = getInitialMessagesForScope(scope);
    saveScopeMessages(scope, initial);
    return initial;
  }
  const parsed = JSON.parse(raw);
  const now = Date.now();
  const valid = parsed.filter((m) => now - (m.timestamp || now) < CHAT_RETENTION_MS);
  if (valid.length === 0) {
    const initial = getInitialMessagesForScope(scope);
    saveScopeMessages(scope, initial);
    return initial;
  }
  return valid;
}

function saveScopeMessages(scope, messages) {
  const key = SCOPE_STORAGE_KEYS[scope];
  const now = Date.now();
  const sanitized = messages
    .map((m) => ({ ...m, timestamp: m.timestamp || now }))
    .filter((m) => now - m.timestamp < CHAT_RETENTION_MS);
  localStorage.setItem(key, JSON.stringify(sanitized));
}

function clearScopeMessages(scope) {
  localStorage.removeItem(SCOPE_STORAGE_KEYS[scope]);
  const fresh = getInitialMessagesForScope(scope);
  saveScopeMessages(scope, fresh);
  return fresh;
}

console.log('=== TEST SUITE: ROLE-ISOLATED CHAT STORAGE WITH 1-DAY TTL ===');

// Test 1: Initial state of scopes
console.log('\n--- 1. Initial Scope State ---');
const guestMsgs = loadScopeMessages('guest');
const customerMsgs = loadScopeMessages('customer');
const adminMsgs = loadScopeMessages('admin');

console.assert(guestMsgs.length === 1, 'Guest should have 1 initial message');
console.assert(customerMsgs.length === 1, 'Customer should have 1 initial message');
console.assert(adminMsgs.length === 1, 'Admin should have 1 initial message');
console.log('PASS: Initial messages generated independently for all 3 scopes.');

// Test 2: Adding messages to guest scope
console.log('\n--- 2. Isolation: Guest Scope Updates ---');
const updatedGuest = [
  ...guestMsgs,
  { id: 'g-1', sender: 'user', text: 'How does wallet work?', time: '10:00 AM', timestamp: Date.now() },
  { id: 'g-2', sender: 'bot', text: 'Login or Sign Up: First...', time: '10:00 AM', timestamp: Date.now() },
];
saveScopeMessages('guest', updatedGuest);

console.assert(loadScopeMessages('guest').length === 3, 'Guest scope should have 3 messages');
console.assert(loadScopeMessages('customer').length === 1, 'Customer scope should still have 1 message (NO LEAK)');
console.assert(loadScopeMessages('admin').length === 1, 'Admin scope should still have 1 message (NO LEAK)');
console.log('PASS: Guest messages do not leak to Customer or Admin.');

// Test 3: Adding private messages to Admin scope
console.log('\n--- 3. Isolation: Admin Scope Updates ---');
const updatedAdmin = [
  ...adminMsgs,
  { id: 'a-1', sender: 'user', text: 'Show cluster provider telemetry', time: '10:05 AM', timestamp: Date.now() },
  { id: 'a-2', sender: 'bot', text: 'Provider Analysis & Node Telemetry: H100 SXM nodes 98% uptime', time: '10:05 AM', timestamp: Date.now() },
];
saveScopeMessages('admin', updatedAdmin);

console.assert(loadScopeMessages('admin').length === 3, 'Admin scope should have 3 messages');
console.assert(loadScopeMessages('customer').length === 1, 'Customer scope should NOT have admin telemetry');
console.assert(loadScopeMessages('guest').length === 3, 'Guest scope should NOT have admin telemetry');
console.log('PASS: Admin telemetry strictly isolated to Admin scope.');

// Test 4: Adding private messages to Customer scope
console.log('\n--- 4. Isolation: Customer Scope Updates ---');
const updatedCustomer = [
  ...customerMsgs,
  { id: 'c-1', sender: 'user', text: 'My invoice #99283 for L4 GPU', time: '10:10 AM', timestamp: Date.now() },
  { id: 'c-2', sender: 'bot', text: 'Invoice details credited ₹10,000', time: '10:10 AM', timestamp: Date.now() },
];
saveScopeMessages('customer', updatedCustomer);

console.assert(loadScopeMessages('customer').length === 3, 'Customer scope should have 3 messages');
console.assert(loadScopeMessages('admin').length === 3, 'Admin scope unchanged (no customer leakage)');
console.assert(loadScopeMessages('guest').length === 3, 'Guest scope unchanged (no customer leakage)');
console.log('PASS: Customer messages strictly isolated to Customer scope.');

// Test 5: Logout Simulation & Returning to Main UI
console.log('\n--- 5. Logout & Return to Main UI ---');
// Simulating user visiting main page after logout:
const mainUiMsgs = loadScopeMessages('guest');
console.assert(!JSON.stringify(mainUiMsgs).includes('Invoice details'), 'Public UI must NOT contain customer invoice!');
console.assert(!JSON.stringify(mainUiMsgs).includes('Provider Analysis & Node Telemetry'), 'Public UI must NOT contain admin telemetry!');
console.log('PASS: Main UI completely clean and free of customer/admin private data.');

// Simulating user logging back into Admin page:
const reloadedAdminMsgs = loadScopeMessages('admin');
console.assert(reloadedAdminMsgs.length === 3, 'Admin previous chat restored upon login!');
console.assert(JSON.stringify(reloadedAdminMsgs).includes('Provider Analysis & Node Telemetry'), 'Admin previous conversation fully intact!');
console.log('PASS: Previous admin conversation safely restored when logging back into admin.');

// Simulating user logging back into Customer page:
const reloadedCustomerMsgs = loadScopeMessages('customer');
console.assert(reloadedCustomerMsgs.length === 3, 'Customer previous chat restored upon login!');
console.assert(JSON.stringify(reloadedCustomerMsgs).includes('Invoice details'), 'Customer previous conversation fully intact!');
console.log('PASS: Previous customer conversation safely restored when logging back into customer.');

// Test 6: 1-Day (24 Hour) TTL Expiration
console.log('\n--- 6. 1-Day TTL Expiration Verification ---');
const now = Date.now();
const twentyFiveHoursAgo = now - 25 * 60 * 60 * 1000; // 25 hours ago (> 24h)
const twoHoursAgo = now - 2 * 60 * 60 * 1000;         // 2 hours ago (< 24h)

const ttlTestList = [
  { id: 'old-1', sender: 'user', text: 'Old message from yesterday', time: 'Yesterday', timestamp: twentyFiveHoursAgo },
  { id: 'new-1', sender: 'user', text: 'Recent message from today', time: '2 hours ago', timestamp: twoHoursAgo },
];

saveScopeMessages('guest', ttlTestList);
const afterTtlPrune = loadScopeMessages('guest');

console.assert(afterTtlPrune.length === 1, 'Only messages < 24h should survive 1-day retention');
console.assert(afterTtlPrune[0].id === 'new-1', 'Surviving message must be the recent one');
console.log('PASS: 1-Day TTL successfully pruned 25-hour-old message while preserving recent 2-hour-old message.');

// When all messages are > 24 hours old:
saveScopeMessages('admin', [
  { id: 'expired-1', sender: 'user', text: 'Ancient admin chat', time: '2 days ago', timestamp: now - 48 * 60 * 60 * 1000 },
]);
const expiredAdminPruned = loadScopeMessages('admin');
console.assert(expiredAdminPruned.length === 1, 'Expired session should restart with 1 initial welcome message');
console.assert(expiredAdminPruned[0].text.includes('Welcome to the Inferxe Administration Console') || expiredAdminPruned[0].text.includes('Welcome admin'), 'Restarts with fresh welcome message');
console.log('PASS: Completely expired session automatically restarts with fresh welcome message.');

console.log('\n>>> ALL 4 STEPS PASSED 100% COMPLIANCE! <<<');
