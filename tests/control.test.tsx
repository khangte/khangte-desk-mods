import { expect, test } from 'claude-code/testing'

import { EFFORTS, planAfter, planView } from '../hooks/band/control'

const UP = 'mcp__ccd_turn__update_plan'
const PLAN_ITEMS = [
  { content: '자료 읽기', status: 'in_progress' },
  { content: '초안 쓰기', status: 'pending' },
  { content: '검토', status: 'pending' },
  { content: '정리', status: 'pending' },
]
const PANE = {
  plugin: 'khangte-desk-mods', component: 'Pane', requestId: 'control-center',
  props: { title: '🎛 제어센터', isFocused: false, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const BAND = {
  plugin: 'khangte-desk-mods', component: 'AbovePrompt', requestId: 'above',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 } },
} as const

test('checklist: follows the desktop task list, wrap_up, and the CLI TodoWrite; ignores other tools', () => {
  let p = planAfter(null, UP, { items: PLAN_ITEMS, scope: 'first_task' })!
  expect(planView(p)).toEqual({ done: 0, total: 4, ratio: 0, now: '자료 읽기' })
  p = planAfter(p, UP, { advance: true })!
  expect(planView(p)).toMatchObject({ done: 1, now: '초안 쓰기' })
  p = planAfter(p, UP, { done: [2], start: 4 })!
  expect(planView(p)).toMatchObject({ done: 2, now: '정리' })
  expect(planAfter(p, 'Bash', { command: 'ls' })).toBeUndefined()
  p = planAfter(p, 'mcp__ccd_turn__wrap_up', { recap: '...' })!
  expect(planView(p)).toEqual({ done: 4, total: 4, ratio: 1, now: undefined })
  const cli = planAfter(null, 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] })
  expect(planView(cli ?? null)).toMatchObject({ done: 1, total: 2, now: 'b' })
  expect(planView(null)).toBeUndefined()
})

test('effort buttons', () => {
  expect(EFFORTS.map(f => [f.label, f.level])).toEqual([['low', 'low'], ['mid', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']])
})

/** In-memory state and store. */
const wire = (on: any, seed: Record<string, unknown> = {}) => {
  const mem = new Map<string, { value: unknown; version: number }>(
    Object.entries(seed).map(([k, v]) => [k, { value: v, version: 1 }]),
  )
  const kept = new Map<string, unknown>()
  on('clock.now', () => ({ value: Date.parse('2026-11-06T01:00:00Z') }))
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

const SEED = {
  usage: { context: 33, session: 43, sessionReset: '2026-11-06T02:49:00Z', week: 14, weekReset: '2026-11-11T06:00:00Z' },
  model: 'claude-opus-5-5',
}

for (const surface of ['desktop', 'terminal'] as const) {
  test(`control centre: no usage rings (the band has them), a Model row and an Effort row (${surface})`, async ($, on) => {
    const { mem, kept } = wire(on, SEED)
    const ran: string[] = []
    const filled: string[] = []
    on('command.run', (_: unknown, e: { command: string; args: string }) =>
      e.command === 'model' || e.command === 'effort' ? (ran.push(e.args), { text: `Set ${e.command} to ${e.args}` }) : { text: '' },
    )
    on('prompt.fill', (_: unknown, e: { text: string }) => (filled.push(e.text), { isFilled: true, cursor: e.text.length }))
    on('tool.call', () => ({ result: {} }))
    const opened: string[] = []
    on('ui.open', (_: unknown, e: { id: string }) => (opened.push(e.id), { value: { isPlaced: true } }))

    // Claude makes a checklist and moves one step on
    await $.tool.call({ tool: UP, items: PLAN_ITEMS, scope: 'first_task' })
    await $.tool.call({ tool: UP, advance: true })
    expect(mem.get('plan')?.value).toMatchObject({ items: [{ status: 'completed' }, { status: 'in_progress' }, {}, {}] })


    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    for (const label of ['컨텍스트', '5시간 한도', '주간 한도']) expect(texts).not.toContain(label)
    expect(texts).not.toContain('이번 작업') // the checklist bar is above the prompt only
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(texts.join('')).not.toMatch(/\$|원|USD|cost/i) // no money anywhere
    expect(await ui.find({ type: 'Link' })).toBeUndefined() // no music link any more
    expect(texts.join('')).not.toContain('control-music')
    expect(texts).not.toContain('대화 기억')
    // Model on one line, Effort on the next
    expect(texts).toContain('Model ')
    expect(texts).toContain('Effort')
    expect(texts.indexOf('Model ')).toBeLessThan(texts.indexOf('Effort'))
    const keys = (await ui.findAll({ type: 'Button' })).map(b => b.key)
    expect(keys).toEqual(expect.arrayContaining(['effort-low', 'effort-medium', 'effort-high']))
    expect(keys.indexOf('model-claude-sonnet-5-5')).toBeLessThan(keys.indexOf('effort-low'))
    expect((await ui.find({ key: 'effort-medium' }))?.text).toBe('mid')
    await ui.press({ key: 'effort-high' })
    expect(ran).toEqual(['high']) // /effort high, run straight away
    ran.length = 0

    expect((await ui.find({ key: 'model-claude-opus-5-5' }))?.props.variant).toBe('primary') // the current one
    await ui.press({ key: 'model-claude-sonnet-5-5' })
    expect(ran).toEqual(['sonnet']) // /model sonnet, switched directly, nothing typed
    expect(filled).toEqual([])
    await ui.unmount()
    const again = await $.ui.mount({ ...PANE, surface }) // the chosen ones are lit
    expect((await again.find({ key: 'model-claude-sonnet-5-5' }))?.props.variant).toBe('primary')
    expect((await again.find({ key: 'effort-high' }))?.props.variant).toBe('primary')
    await again.unmount()

    // the bar's 🎛 button opens it
    const bar = await $.ui.mount({ ...BAND, surface })
    await bar.press({ key: 'open-control' })
    expect(opened).toEqual(['control-center'])
    await bar.unmount()
  })
}

test('a command that fails after running fills nothing into the prompt box', async ($, on) => {
  wire(on, SEED)
  const filled: string[] = []
  on('command.run', () => {
    throw new Error('refused')
  })
  on('prompt.fill', (_: unknown, e: { text: string }) => (filled.push(e.text), { isFilled: true, cursor: e.text.length }))
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'model-claude-sonnet-5-5' })
  await ui.press({ key: 'effort-low' })
  expect(filled).toEqual([])
  await ui.unmount()
})

test("the session's effort lights its button from the first request; a subagent's does not", async ($, on) => {
  wire(on, SEED)
  on('turn.step', async function* (_: unknown, e: { turnId: string; index: number }) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  // a stream runs as it is read: read each one to its end
  for (const input of [
    { turnId: 't1', index: 0, model: 'claude-opus-5-5', effort: 'xhigh', messageCount: 1 },
    { turnId: 't2', index: 0, model: 'claude-haiku-5-5', effort: 'low', messageCount: 1, agentId: 'a1' },
  ] as const) for await (const _ of $.turn.step(input));
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ key: 'effort-xhigh' }))?.props.variant).toBe('primary')
  expect((await ui.find({ key: 'effort-low' }))?.props.variant).toBe('secondary')
  await ui.unmount()
})

test("a subagent's checklist leaves the work at hand's bar alone", async ($, on) => {
  const { mem } = wire(on, SEED)
  on('tool.call', () => ({ result: {} }))
  await $.tool.call({ tool: UP, items: PLAN_ITEMS, scope: 'first_task' })
  await $.tool.call({ tool: 'TodoWrite', todos: [{ content: '하위 작업', status: 'in_progress' }], agentId: 'a1' })
  expect(mem.get('plan')?.value).toMatchObject({ items: [{ content: '자료 읽기' }, {}, {}, {}] })
})

test('a bare /effort only asks: the lit button stays; /effort low moves it', async ($, on) => {
  wire(on, { ...SEED, effort: 'high' })
  on('command.run', () => ({ text: '' }))
  const lit = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const keys = (await ui.findAll({ type: 'Button' })).filter(b => b.props.variant === 'primary').map(b => b.key)
    await ui.unmount()
    return keys.filter(k => k?.startsWith('effort-'))
  }
  await $.command.run({ command: 'effort', args: '', origin: { kind: 'user' } })
  expect(await lit()).toEqual(['effort-high'])
  await $.command.run({ command: 'effort', args: 'low', origin: { kind: 'user' } })
  expect(await lit()).toEqual(['effort-low'])
})
