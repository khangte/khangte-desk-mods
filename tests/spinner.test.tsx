import { expect, mock, test } from 'claude-code/testing'

import { PHRASES, line, phraseAt, pomoSuffix } from '../hooks/spinner/register'

const SPINNER = {
  plugin: 'khangte-desk-mods', component: 'Spinner', requestId: 's1',
  props: { word: 'Sauteing', message: null, suffix: '…', mode: 'thinking' },
} as const

test('ten distinct phrases, rotating every 3s, never the same twice in a row', () => {
  expect(new Set(PHRASES).size).toBe(10)
  for (const base of [0, 4, 9]) {
    let prev = ''
    for (let sec = 0; sec <= 90; sec++) {
      const p = phraseAt(base, sec)
      if (sec % 3 !== 0) expect(p).toBe(phraseAt(base, sec - 1)) // holds for 3 seconds
      else if (sec > 0) expect(p).not.toBe(prev)
      prev = p
    }
  }
  expect(line({ sec: 12, tools: 3, base: 0 })).toBe(`${phraseAt(0, 12)} · 도구 3번`)
  expect(line({ sec: 12, tools: 3, base: 0 })).not.toMatch(/초/) // no seconds on the line
})

for (const surface of ['desktop', 'terminal'] as const) {
  test(`spinner shows phrase, tool count and seconds, and never a rest toast (${surface})`, async ($, on) => {
    let state = { sec: 0, tools: 0, base: 0 }
    const toasts: string[] = []
    const clock = mock.clock(on, { now: 1_000_000 })
    // only the spinner's own value is kept; the band's turn.complete reads and writes other keys
    on('state.get', (_, e) => ({ value: e.key === 'turn' ? { value: state, version: 1 } : { value: undefined, version: 0 } }))
    on('state.set', (_, e) => (e.key === 'turn' && (state = e.value as typeof state), { value: { isSet: true, version: 1 } }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: {} }))
    on('ui.toast', (_, e) => (toasts.push(String(e.text)), { value: undefined }))
    on('turn.complete', (_: unknown, e: { answer: string }) => ({ text: e.answer }))
    on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1 }, rateLimits: [] } }))
    on('session.model', () => ({ value: 'claude-opus-5-5' }))
    on('ui.render', ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>{String(e.props.word) + String(e.props.suffix)}</Text>
    })

    await $.turn.start({ text: 'hi', turnId: 't1' })
    for (let i = 0; i < 3; i++) await $.tool.call({ tool: 'Bash', command: 'ls' })
    // a subagent finishing mid-turn must not stop the main turn's clock
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer', agentId: 'a1' })
    await clock.advance(12_000)
    let ui = await $.ui.mount({ ...SPINNER, surface })
    const text = (await ui.find({ type: 'Text' }))?.text
    expect(text).toBe(line(state)) // suffix dropped, so no stray ellipsis
    expect(text).toContain('도구 3번')
    expect(text).not.toMatch(/[0-9]+초/)
    await ui.unmount()
    expect(toasts).toEqual([])

    await clock.advance(60_000) // a long turn asks for no break
    expect(toasts).toEqual([])
  })
}

test('switched off in the settings panel, the engine spinner shows unchanged', async ($, on) => {
  on('state.get', (_, e) => ({
    value: { value: e.key === 'settings' ? { enabled: { spinner: false }, order: [] } : { sec: 5, tools: 2, base: 0 }, version: 1 },
  }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{String(e.props.word)}</Text>
  })
  const ui = await $.ui.mount({ ...SPINNER, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('Sauteing')
  await ui.unmount()
})

test('the tomato timer rides at the end of the line while it runs or is paused', () => {
  expect(pomoSuffix({ status: 'running', endsAt: 1_500_000, leftMs: 0 }, 1_500_000 - 1_499_000)).toBe(' · 🍅 24:59')
  expect(pomoSuffix({ status: 'paused', endsAt: 0, leftMs: 60_000 }, 0)).toBe(' · 🍅 01:00')
  expect(pomoSuffix({ status: 'idle', endsAt: 0, leftMs: 1_500_000 }, 0)).toBe('')
  expect(pomoSuffix(null, 0)).toBe('')
})

test('switched off, a turn starts no clock and counts no tools', async ($, on) => {
  const writes: string[] = []
  const clock = mock.clock(on, { now: 1_000_000 })
  on('state.get', (_, e) => ({ value: e.key === 'settings' ? { value: { enabled: { spinner: false }, order: [] }, version: 1 } : { value: undefined, version: 0 } }))
  on('state.set', (_, e) => (writes.push(e.key), { value: { isSet: true, version: 1 } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', () => ({ result: {} }))
  await $.turn.start({ text: 'hi', turnId: 't1' })
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(5_000)
  expect(writes).not.toContain('turn')
})
