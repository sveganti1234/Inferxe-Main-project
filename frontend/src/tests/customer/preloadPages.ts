// Console pages are React.lazy chunks. Render helpers that wait a fixed time race their first load when the
// full suite runs in parallel; loading every page module once up front makes lazy() resolve immediately.
const pages = import.meta.glob('../../features/customer/pages/*.tsx')
export const preloadCustomerPages = () => Promise.all(Object.values(pages).map((load) => load()))
