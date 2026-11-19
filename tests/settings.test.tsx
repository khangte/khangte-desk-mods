import { expect, test } from 'claude-code/testing'

import { BANDS, DEFAULT_SETTINGS, normalize, shift, toggle, visible } from '../hooks/band/layout'

const PANE = {
  plugin: 'khangte-desk-mods', component: 'Pane', requestId: 'mods-settings',
  props: { title: '⚙ 모즈 설정', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const BAND = {
  plugin: 'khangte-desk-mods', component: 'AbovePrompt', requestId: 'above',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 } },
} as const
const NOW = new Date(2026, 10, 5, 12, 0, 0).getTime()
const DEFAULT_ORDER = ['leave', 'todo', 'usage', 'sys', 'plan', 'chips']

test('layout: defaults all on in one column, saved order kept, bad or old values fall back, new ids join at the end', () => {
  expect(Object.values(DEFAULT_SETTINGS.enabled).every(Boolean)).toBe(true)
  expect(DEFAULT_SETTINGS.order).toEqual(DEFAULT_ORDER)
  expect(Object.keys(DEFAULT_SETTINGS.enabled)).toEqual([...DEFAULT_ORDER, 'spinner', 'shield', 'tasks', 'control'])

  const saved = normalize({ version: 4, enabled: { sys: false, leave: 'no', dog: false }, order: ['chips', 'chips', 'nope', 7, 'dog', 'sys'] })
  expect(saved.enabled.sys).toBe(false)
  expect(saved.enabled.leave).toBe(true)
  expect('dog' in saved.enabled).toBe(false) // the retired dog band is forgotten
  // duplicates and unknown ids dropped; a band the file never had (a new mod) joins beside its registry neighbour
  expect(saved.order).toEqual(['leave', 'todo', 'usage', 'chips', 'sys', 'plan'])
  // a band the saved order lacks joins below its registry neighbour; the rest keeps its order
  expect(normalize({ version: 4, order: ['chips', 'leave', 'usage', 'sys', 'plan'] }).order)
    .toEqual(['chips', 'leave', 'todo', 'usage', 'sys', 'plan'])
  // an order saved while 모자이크 was a band row: the new default order, its switch kept
  const v3 = normalize({ version: 3, enabled: { shield: false }, order: ['todo', 'leave', 'usage', 'sys', 'shield', 'chips', 'plan'] })
  expect(v3.order).toEqual(DEFAULT_ORDER)
  expect(v3.enabled.shield).toBe(false)
  expect(normalize(null)).toEqual(DEFAULT_SETTINGS)

  // the 3x3 layout saved before: its cells give way to the default order, its switches stay
  const old = normalize({ version: 2, enabled: { sys: false }, cell: { chips: 0, dog: 3 } })
  expect(old.order).toEqual(DEFAULT_ORDER)
  expect(old.enabled.sys).toBe(false)
  expect(BANDS.length).toBe(6)
})

test('layout: shift moves one place, stays put at the ends; visible skips switched-off bands', () => {
  expect(shift(DEFAULT_SETTINGS, 'todo', -1).order.slice(0, 2)).toEqual(['todo', 'leave'])
  expect(shift(DEFAULT_SETTINGS, 'leave', -1)).toBe(DEFAULT_SETTINGS) // already on top
  expect(shift(DEFAULT_SETTINGS, 'chips', 1)).toBe(DEFAULT_SETTINGS) // already at the bottom
  expect(shift(DEFAULT_SETTINGS, 'usage', 1).order).toEqual(['leave', 'todo', 'sys', 'usage', 'plan', 'chips'])
  expect(visible(toggle(DEFAULT_SETTINGS, 'sys'))).toEqual(['leave', 'todo', 'usage', 'plan', 'chips'])
})

/** An in-memory $.state and $.store for a test. */
const wire = (on: any, seed: Record<string, unknown> = {}) => {
  const mem = new Map<string, { value: unknown; version: number }>()
  const kept = new Map<string, unknown>(Object.entries(seed))
  on('clock.now', () => ({ value: NOW }))
  on('state.get', (_: unknown, e: { key: string }) => ({ value: mem.get(e.key) ?? { value: undefined, version: 0 } }))
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    const version = (mem.get(e.key)?.version ?? 0) + 1
    mem.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: undefined }))
  return { mem, kept }
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`panel: switches and ▲▼ apply at once and are saved; no reset button (${surface})`, async ($, on) => {
    const { kept } = wire(on)
    const saved = () => kept.get('mods-settings') as { enabled: Record<string, boolean>; order: string[] }
    // the host redraws on every state write; a fresh mount stands for that redraw here
    const panel = () => $.ui.mount({ ...PANE, surface })

    let ui = await panel()
    expect(await ui.findAll({ type: 'Button', text: /^켜짐$/ })).toHaveLength(10) // six bands, 모자이크, the spinner, the tasks pane and the control centre (no memo switch)
    expect(await ui.find({ key: 'cell-0' })).toBeUndefined() // no 3x3 board any more
    const names = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(names.some(t => t.endsWith('⚡ 원터치 요청 버튼'))).toBe(true) // the names match the panes and buttons
    expect(names).toContain('🗓 오늘 할 일 단추')
    expect(names).toContain('🎛 Claude 도구 단추')
    // two groups: what a switch does is in its heading
    const at = (t: string) => names.indexOf(t)
    expect(at('기능')).toBeLessThan(at('💬 동기부여 스피너'))
    expect(at('💬 동기부여 스피너')).toBeLessThan(at('🙈 모자이크 (이메일·전화번호)'))
    expect(at('🙈 모자이크 (이메일·전화번호)')).toBeLessThan(at('단추 줄'))
    expect(at('단추 줄')).toBeLessThan(at('🗓 오늘 할 일 단추'))
    expect(names).not.toContain('그 밖의 모드')
    expect(names.some(t => /다음 할 일 단추 \(|오늘의 작업 \(/.test(t))).toBe(false)
    await ui.press({ key: 'sw-sys' })
    expect(saved().enabled.sys).toBe(false)
    await ui.unmount()

    ui = await panel()
    await ui.press({ key: 'up-chips' })
    expect(saved().order).toEqual(['leave', 'todo', 'usage', 'sys', 'chips', 'plan'])
    await ui.unmount()

    ui = await panel()
    await ui.press({ key: 'down-leave' })
    expect(saved().order.slice(0, 3)).toEqual(['todo', 'leave', 'usage'])
    await ui.press({ key: 'sw-spinner' })
    expect(saved().enabled.spinner).toBe(false)
    await ui.unmount()

    ui = await panel()
    expect((await ui.find({ type: 'Text', text: /^1\./ }))?.text).toBe('1. ☑ 오늘 할 일 게이지 (/todo)') // 🏃 moved down a place
    expect(await ui.find({ key: 'reset' })).toBeUndefined() // 처음 배치로 되돌리기 is gone
    expect((await ui.findAll({ type: 'Button' })).map(b => b.text)).not.toContain('처음 배치로 되돌리기')
    await ui.unmount()
  })

  test(`bar: one column in the saved order, a switched-off band gone, ⚙ beside the last (${surface})`, async ($, on) => {
    wire(on, { 'mods-settings': { version: 4, enabled: { sys: false }, order: ['chips', 'leave', 'usage', 'sys'] } })
    on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'x' } }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
    on('fs.exists', () => ({ value: true }))
    on('fs.read', () => ({ value: '- [ ] a\n- [x] b' }))
    await $.session.start({ cwd: '/', surface, isInteractive: true }) // loads the saved settings

    const ui = await $.ui.mount({ ...BAND, surface })
    const all = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    const at = (re: RegExp) => all.findIndex(t => re.test(t))
    expect(at(/CPU/)).toBe(-1) // the computer row is off
    expect(at(/다음 할 일/)).toBeLessThan(at(/퇴근/))
    expect(at(/퇴근/)).toBeLessThan(at(/SESSION/))
    const buttons = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    expect(buttons.at(-5)).toBe('toggle-spinner') // the bottom row: 💬 스피너 switch…
    expect(buttons.at(-4)).toBe('toggle-shield') // …모자이크 switch…
    expect(buttons.at(-3)).toBe('open-tasks') // …📋 오늘의 작업
    expect(buttons.at(-2)).toBe('open-control') // …🎛 제어센터
    expect(buttons).not.toContain('open-memo') // the 📝 메모 button is gone
    expect(buttons.at(-1)).toBe('open-settings') // …and ⚙, bottom right
    await ui.unmount()
  })
}

test('two windows: a switch here keeps the colour another window chose since this one started', async ($, on) => {
  const { kept } = wire(on)
  await $.ui.mount({ ...PANE, surface: 'desktop' }).then(ui => ui.unmount()) // this window has drawn its settings
  kept.set('mods-settings', { ...DEFAULT_SETTINGS, scheme: 'light' }) // another window picked 밝게
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'sw-spinner' })
  await ui.unmount()
  const saved = kept.get('mods-settings') as { scheme: string; enabled: Record<string, boolean> }
  expect(saved.scheme).toBe('light')
  expect(saved.enabled.spinner).toBe(false)
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`⚙ field: work hours are set here, a bad time changes nothing; no name or minute fields (${surface})`, async ($, on) => {
    const { mem, kept } = wire(on)
    const toasts: string[] = []
    on('ui.toast', (_: unknown, e: { text: string }) => (toasts.push(e.text), { value: undefined }))
    let ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'hours-start' }))?.props.value).toBe('09:00')
    expect((await ui.find({ key: 'hours-end' }))?.props.value).toBe('18:00')
    await ui.input({ key: 'hours-end', text: '08:00' }) // the end before the start
    expect(kept.get('workhours')).toBeUndefined()
    await ui.input({ key: 'hours-start', text: '8:30' }) // one field alone: the end stays
    expect(kept.get('workhours')).toBe('08:30 18:00')
    await ui.input({ key: 'hours-end', text: '17:30' })
    expect(kept.get('workhours')).toBe('08:30 17:30')
    expect(mem.get('hours')?.value).toEqual({ start: '08:30', end: '17:30' })
    expect(toasts).toEqual(['예: 09:00 (24시간제, 퇴근이 출근보다 늦게)', '출근 08:30 · 퇴근 18:00', '출근 08:30 · 퇴근 17:30'])
    for (const key of ['name-input', 'pomo-focus', 'pomo-rest']) expect(await ui.find({ key })).toBeUndefined()
    await ui.unmount()
    ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ key: 'hours-start' }))?.props.value).toBe('08:30')
    expect((await ui.find({ key: 'hours-end' }))?.props.value).toBe('17:30')
    await ui.unmount()
  })
}
