import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, Send, TriangleAlert } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { submitContact, type ContactPayload } from '../../lib/api'
import { SITE } from '../../data/site'
import { Button } from '../ui/Button'

const INTERESTS = ['Request access', 'API access & integration', 'Enterprise / private deployment', 'Provider partnership (supply)', 'Benchmarking & research', 'Something else']
const ROLES = ['Developer / engineer', 'Founder / executive', 'Product / program', 'Infrastructure / DevOps', 'Researcher', 'Other']

type Errors = Partial<Record<keyof ContactPayload | 'consent', string>>

const empty: ContactPayload = { name: '', email: '', company: '', role: '', interest: '', message: '' }

function validate(v: ContactPayload, consent: boolean): Errors {
  const e: Errors = {}
  if (!v.name.trim()) e.name = 'Please tell us your name.'
  if (!v.email.trim()) e.email = 'An email is required so we can reply.'
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.email)) e.email = 'That email does not look right.'
  if (!v.interest) e.interest = 'Choose what you are interested in.'
  if (v.message.length > 2000) e.message = 'Please keep the message under 2,000 characters.'
  if (!consent) e.consent = 'Please confirm so we may contact you about this enquiry.'
  return e
}

export function ContactForm() {
  const [v, setV] = useState<ContactPayload>(empty)
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Errors>({})
  const [touched, setTouched] = useState(false)
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle')
  const [delivered, setDelivered] = useState(true)
  const [err, setErr] = useState('')

  const set = (k: keyof ContactPayload, val: string) => {
    const next = { ...v, [k]: val }
    setV(next)
    if (touched) setErrors(validate(next, consent))
  }

  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    setTouched(true)
    const e = validate(v, consent)
    setErrors(e)
    if (Object.keys(e).length) return
    setState('sending')
    const r = await submitContact(v)
    if (r.ok) {
      setDelivered(r.delivered)
      setState('done')
    } else {
      setErr(r.error)
      setState('error')
    }
  }

  const reset = () => {
    setV(empty)
    setConsent(false)
    setErrors({})
    setTouched(false)
    setState('idle')
  }

  return (
    <div className="glass glass--deep cform">
      <AnimatePresence mode="wait">
        {state === 'done' ? (
          <motion.div key="done" className="cform__done" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4 }}>
            <svg viewBox="0 0 80 80" className="cform__check" aria-hidden>
              <circle cx="40" cy="40" r="34" fill="rgba(118,185,0,.12)" stroke="#76b900" strokeWidth="2" />
              <motion.path d="M25 41 l10 10 l21 -23" fill="none" stroke="#b6f23a" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.7, delay: 0.2 }} />
            </svg>
            <h3 className="h2">Thanks, {v.name.split(' ')[0] || 'there'}.</h3>
            <p className="lead">
              {delivered
                ? `We have your enquiry about “${v.interest}” and will reply to ${v.email}.`
                : `Your enquiry about “${v.interest}” is complete on this page.`}
            </p>
            {!delivered && (
              <p className="cform__warn">
                <TriangleAlert aria-hidden /> Preview build: the form is not connected to a mailbox yet, so nothing was sent.
                {SITE.contactEmail ? ` Please email ${SITE.contactEmail} directly.` : ' Set VITE_FORM_ENDPOINT to enable delivery.'}
              </p>
            )}
            <Button variant="ghost" onClick={reset}>
              Send another
            </Button>
          </motion.div>
        ) : (
          <motion.form key="form" onSubmit={submit} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="cform__grid">
              <div className={`field ${errors.name ? 'field--error' : ''}`}>
                <label htmlFor="cf-name">Name *</label>
                <input id="cf-name" className="input" autoComplete="name" value={v.name} onChange={(e) => set('name', e.target.value)} placeholder="Ada Lovelace" aria-invalid={!!errors.name} />
                {errors.name && <span className="field__error">{errors.name}</span>}
              </div>
              <div className={`field ${errors.email ? 'field--error' : ''}`}>
                <label htmlFor="cf-email">Work email *</label>
                <input id="cf-email" type="email" className="input" autoComplete="email" value={v.email} onChange={(e) => set('email', e.target.value)} placeholder="you@company.com" aria-invalid={!!errors.email} />
                {errors.email && <span className="field__error">{errors.email}</span>}
              </div>
              <div className="field">
                <label htmlFor="cf-company">Company</label>
                <input id="cf-company" className="input" autoComplete="organization" value={v.company} onChange={(e) => set('company', e.target.value)} placeholder="Company or project" />
              </div>
              <div className="field">
                <label htmlFor="cf-role">Role</label>
                <select id="cf-role" className="select" value={v.role} onChange={(e) => set('role', e.target.value)}>
                  <option value="">Select…</option>
                  {ROLES.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className={`field cform__wide ${errors.interest ? 'field--error' : ''}`}>
                <label htmlFor="cf-interest">I am interested in *</label>
                <select id="cf-interest" className="select" value={v.interest} onChange={(e) => set('interest', e.target.value)} aria-invalid={!!errors.interest}>
                  <option value="">Select…</option>
                  {INTERESTS.map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                {errors.interest && <span className="field__error">{errors.interest}</span>}
              </div>
              <div className={`field cform__wide ${errors.message ? 'field--error' : ''}`}>
                <label htmlFor="cf-msg">Tell us about your workload</label>
                <textarea
                  id="cf-msg"
                  className="textarea"
                  value={v.message}
                  onChange={(e) => set('message', e.target.value)}
                  placeholder="Model, context length, concurrency, budget, region or latency needs — whatever you can share."
                />
                <span className="cform__count">{v.message.length} / 2000</span>
                {errors.message && <span className="field__error">{errors.message}</span>}
              </div>
            </div>

            <label className={`cform__consent ${errors.consent ? 'is-error' : ''}`}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => {
                  setConsent(e.target.checked)
                  if (touched) setErrors(validate(v, e.target.checked))
                }}
              />
              <span className="cform__box" aria-hidden />
              <span>I agree that Inferxe may contact me about this enquiry. We only use these details to reply to you.</span>
            </label>
            {errors.consent && <span className="field__error">{errors.consent}</span>}

            {state === 'error' && (
              <p className="cform__warn" role="alert">
                <TriangleAlert aria-hidden /> {err}
              </p>
            )}

            <div className="cform__actions">
              <Button size="lg" type="submit" disabled={state === 'sending'} icon={state === 'sending' ? <Loader2 className="spin" /> : <Send />}>
                {state === 'sending' ? 'Sending…' : 'Send request'}
              </Button>
              <span className="dim cform__fine">* required</span>
            </div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
