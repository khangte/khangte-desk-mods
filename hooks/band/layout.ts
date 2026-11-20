import type { Settings } from '../../types'

/**
 * The one registry of what can be switched and ordered. A new mod's band is one more entry here:
 * the panel's switches, the order list and the saved settings all follow this list.
 * Listed in the default top-to-bottom order above the prompt.
 */
export const BANDS = [
  { id: 'leave', name: '퇴근 카운터 (걷는 강아지)', icon: '🏃' },
  { id: 'todo', name: '오늘 할 일 게이지 (/todo)', icon: '☑' },
  { id: 'usage', name: 'Claude 사용량', icon: '⏱' },
  { id: 'sys', name: '컴퓨터 상태', icon: '🖥' },
  { id: 'plan', name: '작업 진행률', icon: '📋' },
  { id: 'chips', name: '원터치 요청 버튼', icon: '⚡' },
] as const

/** Switch-only items: they draw no band, so they have no place in the order. */
export const FEATURES = [
  // 기능: switches what it does
  { id: 'spinner', name: '동기부여 스피너', icon: '💬', group: 'feature' },
  { id: 'shield', name: '모자이크 (이메일·전화번호)', icon: '🙈', group: 'feature' }, // its button sits in the bottom row too
  // 버튼 줄: switches the pane's button in the bottom row (and the pane)
  { id: 'tasks', name: '오늘 할 일', icon: '🗓', group: 'button' },
  { id: 'control', name: 'Claude 도구', icon: '🎛', group: 'button' },
] as const

export type BandId = (typeof BANDS)[number]['id']

/** Bumped when the layout model changes: an order saved under an older one is dropped, switches kept. */
export const LAYOUT_VERSION = 4

const IDS: readonly string[] = BANDS.map(b => b.id)

export const DEFAULT_SETTINGS: Settings = {
  version: LAYOUT_VERSION,
  enabled: Object.fromEntries([...BANDS, ...FEATURES].map(i => [i.id, true])),
  order: [...IDS],
  scheme: 'dark',
}

/** What was saved, kept only where valid; a band missing from it (a newly added mod) joins at the end. */
export const normalize = (raw: unknown): Settings => {
  const r = (raw ?? {}) as { version?: unknown; enabled?: Record<string, unknown>; order?: unknown; scheme?: unknown }
  const enabled = { ...DEFAULT_SETTINGS.enabled }
  for (const id of Object.keys(enabled)) if (typeof r.enabled?.[id] === 'boolean') enabled[id] = r.enabled[id] as boolean
  const saved: unknown[] = r.version === LAYOUT_VERSION && Array.isArray(r.order) ? r.order : []
  const known = saved.filter((id, i): id is string => typeof id === 'string' && IDS.includes(id) && saved.indexOf(id) === i)
  const order = [...known]
  IDS.forEach((id, i) => {
    if (order.includes(id)) return
    const before = IDS.slice(0, i).reverse().find(p => order.includes(p)) // its nearest registry neighbour above
    order.splice(before === undefined ? 0 : order.indexOf(before) + 1, 0, id)
  })
  const scheme = r.scheme === 'light' ? 'light' : 'dark'
  return { version: LAYOUT_VERSION, enabled, order, scheme }
}

export const toggle = (s: Settings, id: string): Settings => ({ ...s, enabled: { ...s.enabled, [id]: !s.enabled[id] } })

/** Moves a band one place up (-1) or down (+1); at either end it stays. */
export const shift = (s: Settings, id: string, by: -1 | 1): Settings => {
  const order = [...s.order]
  const i = order.indexOf(id)
  const j = i + by
  if (i < 0 || j < 0 || j >= order.length) return s
  ;[order[i], order[j]] = [order[j]!, order[i]!]
  return { ...s, order }
}

/** The bands drawn, top to bottom: the order, switched-off ones left out. */
export const visible = (s: Settings): BandId[] =>
  s.order.filter((id): id is BandId => IDS.includes(id) && s.enabled[id] !== false)
