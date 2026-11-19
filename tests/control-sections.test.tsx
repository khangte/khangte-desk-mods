import { expect, test } from 'claude-code/testing'

import { cleanQuick } from '../hooks/band/register'

const PANE = {
  plugin: 'khangte-desk-mods', component: 'Pane', requestId: 'control-center',
  props: { title: '🎛 제어센터', isFocused: true, bodyColumns: 50, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
} as const
const SETTINGS = { ...PANE, requestId: 'mods-settings', props: { ...PANE.props, title: '⚙ 모즈 설정' } } as const
const BAND = {
  plugin: 'khangte-desk-mods', component: 'AbovePrompt', requestId: 'above',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 20 } },
} as const

/** In-memory state and store; `others` stands for another mod's state (today-tasks). */
const wire = (on: any, others: Record<string, unknown> = {}) => {
  const mem = new Map<string, { value: unknown; version: number }>()
  const kept = new Map<string, unknown>()
  on('clock.now', () => ({ value: new Date(2026, 10, 6, 10).getTime() }))
  on('state.get', (_: unknown, e: { plugin: string; key: string }) =>
    // one plugin now: what a test seeds stands until the mod writes its own
    mem.has(e.key) || !(e.key in others)
      ? { value: mem.get(e.key) ?? { value: undefined, version: 0 } }
      : { value: { value: others[e.key], version: 1 } },
  )
  on('state.set', (_: unknown, e: { key: string; value: unknown }) => {
    const version = (mem.get(e.key)?.version ?? 0) + 1
    mem.set(e.key, { value: e.value, version })
    return { value: { isSet: true, version } }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({ value: kept.get(e.key) }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => (kept.set(e.key, e.value), { value: undefined }))
  return { kept }
}

test('request list cleaning: trimmed, no blanks or repeats, at most 8', () => {
  expect(cleanQuick(['  a ', '', 'a', 'b', 3])).toEqual(['a', 'b'])
  expect(cleanQuick(Array.from({ length: 10 }, (_, i) => `q${i}`))).toHaveLength(8)
  expect(cleanQuick(undefined)).toEqual([])
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`🎛 Claude 도구: 🤖 모델 · 📝 다음 요청 메모; ⚡ 빠른 요청 is edited in ⚙ 모즈 설정 (${surface})`, async ($, on) => {
    // a list set earlier carries over until it is edited
    const { kept } = wire(on, { quick: ['/ponytail-audit'] })
    const control = await $.ui.mount({ ...PANE, surface })
    const texts = (await control.findAll({ type: 'Text' })).map(t => t.text)
    const rules = texts.map((t, i) => (/^─{10,}$/.test(t) ? i : -1)).filter(i => i >= 0)
    expect(rules).toHaveLength(1)
    const at = (s: string) => texts.findIndex(t => t.startsWith(s))
    expect(at('이번 작업')).toBe(-1) // it stays above the prompt only
    expect([at('📊 사용량'), at('⚡ 빠른 요청')]).toEqual([-1, -1]) // the band shows usage; requests are set in ⚙
    expect(texts).toContain('🎛 Claude 도구')
    const order = [at('🤖 모델'), at('Model'), rules[0]!, at('📝 다음 요청 메모')]
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((x, y) => x - y)).toEqual(order)
    expect(await control.find({ key: 'memo-input' })).toBeDefined()
    expect(await control.find({ key: 'quick-add' })).toBeUndefined()
    await control.unmount()

    const pane = () => $.ui.mount({ ...SETTINGS, surface })
    let ui = await pane()
    const set = (await ui.findAll({ type: 'Text' })).map(t => t.text)
    expect(set).toContain('여기 적은 요청이 입력창 위 ⚡ 단추가 돼요. 누르면 입력창에 채워지고, 보내는 건 직접 해야 돼요.')
    expect((await ui.find({ key: 'quick-add' }))?.props.placeholder).toBe('새 요청을 적고 Enter (예: 이번 수정건 재검토해)')
    expect(set).toContain('1. /ponytail-audit')

    // editing here takes the list over and keeps it in this mod's store
    await ui.input({ key: 'quick-add', text: '  방금 고친 것 검토해 줘  ' })
    expect(kept.get('quick')).toEqual(['/ponytail-audit', '방금 고친 것 검토해 줘'])
    await ui.input({ key: 'quick-add', text: '/ponytail-audit' }) // no repeats
    expect(kept.get('quick')).toEqual(['/ponytail-audit', '방금 고친 것 검토해 줘'])
    await ui.unmount()

    ui = await pane()
    await ui.press({ key: 'quick-up-1' })
    expect(kept.get('quick')).toEqual(['방금 고친 것 검토해 줘', '/ponytail-audit'])
    await ui.unmount()
    ui = await pane()
    await ui.press({ key: 'quick-del-0' })
    expect(kept.get('quick')).toEqual(['/ponytail-audit'])
    await ui.unmount()

    // the band's 다음 할 일 buttons follow the list kept here
    const bar = await $.ui.mount({ ...BAND, surface })
    expect((await bar.findAll({ type: 'Button' })).map(b => b.text).filter(t => t.startsWith('▶'))).toEqual(['▶ /ponytail-audit'])
    await bar.unmount()
  })
}
