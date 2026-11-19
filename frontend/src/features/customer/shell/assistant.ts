/**
 * Open the existing Inferxe assistant (`components/bot/GlobalBotCompanion`).
 * That component already listens for this window event, so no assistant code is changed and no
 * answers are created here — the console only asks the same assistant to open.
 */
export const OPEN_ASSISTANT_EVENT = 'inferxe_open_bot'

export function openAssistant(): void {
  window.dispatchEvent(new Event(OPEN_ASSISTANT_EVENT))
}
