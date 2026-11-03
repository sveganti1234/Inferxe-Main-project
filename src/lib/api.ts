import { SITE } from '../data/site'

export interface ContactPayload {
  name: string
  email: string
  company: string
  role: string
  interest: string
  message: string
}

export type SubmitResult = { ok: true; delivered: boolean } | { ok: false; error: string }

/**
 * Posts the enquiry to VITE_FORM_ENDPOINT (Formspree, Netlify Forms, your own API…).
 * With no endpoint configured the form still completes — but nothing is delivered,
 * and the UI says so (`delivered: false`).
 */
export async function submitContact(p: ContactPayload): Promise<SubmitResult> {
  if (!SITE.formEndpoint) {
    await new Promise((r) => setTimeout(r, 900))
    if (import.meta.env.DEV) console.info('[contact] no VITE_FORM_ENDPOINT set — enquiry not delivered', p)
    return { ok: true, delivered: false }
  }
  try {
    const res = await fetch(SITE.formEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ...p, source: 'inferxe-website' }),
    })
    if (!res.ok) return { ok: false, error: `The server responded with ${res.status}.` }
    return { ok: true, delivered: true }
  } catch {
    return { ok: false, error: 'Network error — please try again.' }
  }
}
