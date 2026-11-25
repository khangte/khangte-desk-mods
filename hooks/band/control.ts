import type { Plan, PlanItem, Settings } from '../../types'
import { atom, read } from 'claude-code'
import type { EngineInterface } from 'claude-code'
import { DEFAULT_SETTINGS } from './layout'

// Two palettes of one blue family. DARK is the original look (light text on the dark app and a black terminal);
// LIGHT keeps the same roles with dark text for a white app or terminal.
// deep = titles and strong text, mid = secondary text, blue = accents and fills, pale = tracks and borders.
const DARK = {
  deep: '#dbeafe', blue: '#60a5fa', mid: '#93c5fd', sky: '#bfdbfe', pale: '#1e3a8a', ice: '#0b1226', white: '#ffffff',
  // the band above the prompt
  navy: '#0f1b3d', name: '#e6ebf5', gray: '#b8c0cc', orange: '#fb923c', dots: '#7a8499', dotsBg: '#26314d',
  teal: '#2dd4bf', green: '#4ade80', cyan: '#7dd3fc', boxEmpty: '#334155', rest: '#aab3c5', trail: '#60a5fa',
  red: '#ef4444', yellow: '#facc15',
  // 🗓 오늘 할 일's cards, by tag, and a finished one
  card: {
    급함: { bg: '#1e40af', fg: '#ffffff', chipBg: '#3b82f6', chipFg: '#ffffff' },
    중요: { bg: '#1e3a8a', fg: '#dbeafe', chipBg: '#2563eb', chipFg: '#ffffff' },
    업무: { bg: '#172554', fg: '#bfdbfe', chipBg: '#1e3a8a', chipFg: '#bfdbfe' },
  },
  done: { bg: '#0f172a', fg: '#64748b', chipBg: '#1e293b', chipFg: '#94a3b8' },
  doneBorder: '#1e293b',
}
type Palette = typeof DARK

const LIGHT: Palette = {
  deep: '#1e3a8a', blue: '#2563eb', mid: '#3b5b99', sky: '#1e40af', pale: '#bfdbfe', ice: '#eff6ff', white: '#ffffff',
  navy: '#e8eefb', name: '#0f1b3d', gray: '#4b5563', orange: '#c2410c', dots: '#94a3b8', dotsBg: '#d5deef',
  teal: '#0d9488', green: '#16a34a', cyan: '#0284c7', boxEmpty: '#cbd5e1', rest: '#94a3b8', trail: '#2563eb',
  red: '#dc2626', yellow: '#ca8a04',
  card: {
    급함: { bg: '#dbeafe', fg: '#1e3a8a', chipBg: '#2563eb', chipFg: '#ffffff' },
    중요: { bg: '#e0e7ff', fg: '#1e1b4b', chipBg: '#4f46e5', chipFg: '#ffffff' },
    업무: { bg: '#f1f5f9', fg: '#1e293b', chipBg: '#cbd5e1', chipFg: '#1e293b' },
  },
  done: { bg: '#f8fafc', fg: '#94a3b8', chipBg: '#e2e8f0', chipFg: '#64748b' },
  doneBorder: '#e2e8f0',
}

/** The palette drawn now: every render sets it first with `usePalette`. */
export const C: Palette = { ...DARK }

const settingsAtom = atom({ plugin: 'khangte-desk-mods', key: 'settings' } as const, DEFAULT_SETTINGS as Settings)

/**
 * Sets `C` to the palette ⚙ 모즈 설정's 🎨 색상 picks. Read through the state, so a render
 * that calls it redraws when the choice changes.
 * shortcut: one shared palette object, fine while every surface uses the same scheme; pass it down if they ever differ.
 */
export async function usePalette($: EngineInterface) {
  const s = (await read($, settingsAtom)) as Settings | null
  Object.assign(C, s?.scheme === 'light' ? LIGHT : DARK)
}

/** The two models the buttons switch between, by the id `/model` takes. */
export const MODELS = [
  { id: 'claude-opus-5-5', alias: 'opus', label: 'Opus' },
  { id: 'claude-sonnet-5-5', alias: 'sonnet', label: 'Sonnet' },
] as const

const STATUSES = ['pending', 'in_progress', 'completed'] as const
const asStatus = (s: unknown): PlanItem['status'] => (STATUSES.includes(s as never) ? (s as PlanItem['status']) : 'pending')

/**
 * Follows Claude's own checklist from the calls that keep it: the desktop's task list
 * (`items`, `advance`, `done`/`start`, and `wrap_up` checking everything off) and the CLI's `TodoWrite`.
 * Returns undefined for any other call, so the plan stays as it was.
 */
export const planAfter = (plan: Plan | null, tool: string, args: Record<string, unknown>): Plan | null | undefined => {
  const name = tool.split('__').at(-1)
  if (name === 'TodoWrite' && Array.isArray(args.todos)) {
    return { items: args.todos.map(t => ({ content: String((t as { content?: unknown }).content ?? ''), status: asStatus((t as { status?: unknown }).status) })) }
  }
  if (name === 'wrap_up') return plan && { items: plan.items.map(i => ({ ...i, status: 'completed' })) }
  if (name !== 'update_plan') return undefined
  if (Array.isArray(args.items)) {
    return { items: args.items.map(t => ({ content: String((t as { content?: unknown }).content ?? ''), status: asStatus((t as { status?: unknown }).status) })) }
  }
  if (!plan) return undefined
  let items = plan.items.map(i => ({ ...i }))
  if (args.advance === true) {
    const at = items.findIndex(i => i.status === 'in_progress')
    if (at >= 0) items[at]!.status = 'completed'
    const next = items.findIndex((i, k) => k > at && i.status === 'pending')
    if (next >= 0) items[next]!.status = 'in_progress'
  }
  if (Array.isArray(args.done)) for (const n of args.done) if (typeof n === 'number' && items[n - 1]) items[n - 1]!.status = 'completed'
  if (typeof args.start === 'number' && items[args.start - 1]) {
    items = items.map(i => (i.status === 'in_progress' ? { ...i, status: 'pending' } : i))
    items[args.start - 1]!.status = 'in_progress'
  }
  return { items }
}

/** `3/5`, the share done, and the step under way (or the last one once all are done). */
export const planView = (plan: Plan | null) => {
  if (!plan || plan.items.length === 0) return undefined
  const done = plan.items.filter(i => i.status === 'completed').length
  const now = plan.items.find(i => i.status === 'in_progress') ?? (done === plan.items.length ? undefined : plan.items.find(i => i.status === 'pending'))
  return { done, total: plan.items.length, ratio: done / plan.items.length, now: now?.content }
}

/** The effort buttons: the level `/effort` takes, and the button's word. */
export const EFFORTS = [
  { level: 'low', label: 'low' },
  { level: 'medium', label: 'mid' },
  { level: 'high', label: 'high' },
  { level: 'xhigh', label: 'xhigh' },
  { level: 'max', label: 'max' },
] as const
