/**
 * Where a signed-in customer lands. Dependency-free on purpose so the login page, navbar and
 * route guards can import it without pulling the console into their bundles.
 * Kept in sync with CONSOLE_BASE in navigation.ts by a unit test.
 */
export const CUSTOMER_HOME_PATH = '/dashboard/app'
