import { createContext } from 'react'

/**
 * Context indicating whether a DashboardLayout is being rendered inside
 * the persistent AdminShell or as a standalone top-level shell.
 */
export const DashboardLayoutContext = createContext<boolean>(false)

