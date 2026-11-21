import { describe, it, expect, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ContactForm } from '../components/widgets/ContactForm'

vi.mock('../lib/api', () => ({ submitContact: vi.fn(async () => ({ ok: true, delivered: false })) }))

async function until(check: () => boolean, ms = 3000) {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
  }
}

function type(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const proto = Object.getPrototypeOf(el)
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value)
  el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
}

describe('ContactForm without a delivery endpoint', () => {
  it('says the enquiry was not sent and keeps what was typed', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => root.render(<ContactForm />))

    await act(async () => {
      type(host.querySelector<HTMLInputElement>('#cf-name')!, 'Ada Lovelace')
      type(host.querySelector<HTMLInputElement>('#cf-email')!, 'ada@example.com')
      type(host.querySelector<HTMLSelectElement>('#cf-interest')!, 'Something else')
      host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click()
    })
    await act(async () => {
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    await until(() => host.textContent!.includes('Not sent'))
    expect(host.textContent).toContain('was not sent')
    expect(host.textContent).not.toContain('Thanks')

    const back = [...host.querySelectorAll('button')].find((b) => b.textContent === 'Back to form')!
    await act(async () => back.click())
    await until(() => !!host.querySelector('#cf-name'))
    expect(host.querySelector<HTMLInputElement>('#cf-name')!.value).toBe('Ada Lovelace')

    await act(async () => root.unmount())
    host.remove()
  })
})
