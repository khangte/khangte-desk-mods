import type { Pomo, Settings } from '../../types'
import { DEFAULT_SETTINGS } from '../band/layout'
import { clock, freshPomo, remaining } from '../tasks/pomodoro'
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

// Owned by usage-band's settings panel; read here only for the spinner's on/off switch (its only one).
const settings = atom({ plugin: 'khangte-desk-mods', key: 'settings' } as const, DEFAULT_SETTINGS as Settings)
// Owned by today-tasks; read here only to show its countdown.
const pomo = atom({ plugin: 'khangte-desk-mods', key: 'pomo' } as const, freshPomo(''))
const turn = atom({ plugin: 'khangte-desk-mods', key: 'turn' } as const, { sec: 0, tools: 0, base: 0 })

export const PHRASES = [
  '완벽보다 완료',
  '작은 한 걸음도 진도',
  '오늘 끝낸 한 줄이 내일의 여유',
  '시작이 절반, 나머지는 꾸준함',
  '느려도 멈추지 않으면 도착',
  '어제보다 한 줄 더',
  '막히면 쪼개고, 쪼개면 풀린다',
  '지금 하는 일이 쌓여 실력이 된다',
  '하나씩 지우다 보면 끝이 보인다',
  '오늘의 수고가 내일의 든든함',
] as const

/** A new phrase every 3 seconds, cycling through all ten, so none repeats back to back. */
export const phraseAt = (base: number, sec: number) => PHRASES[(base + Math.floor(sec / 3)) % PHRASES.length]!

/** ` · 🍅 24:59` while the tomato timer runs or is paused; nothing when it is stopped or absent. */
export const pomoSuffix = (p: { status: string; endsAt: number; leftMs: number } | null | undefined, now: number) => {
  if (!p || (p.status !== 'running' && p.status !== 'paused')) return ''
  return ` · 🍅 ${clock(remaining(p as Pomo, now))}` // today-tasks' own clock: both show the same second
}

export const line = (t: { sec: number; tools: number; base: number }) =>
  `${phraseAt(t.base, t.sec)} · 도구 ${t.tools}번` // seconds still drive the rotation, but are not shown

let timer: { cancel: () => void } | undefined

/** Switched off in ⚙ 모즈 설정: nothing to show, so nothing is counted either. */
async function isOff($: EngineInterface) {
  return ((await read($, settings)) as Settings | null)?.enabled?.spinner === false
}

export const register: Register = on => {
  let startedAt = 0
  let lastBase = -1

  on('turn.start', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result // main loop only

    timer?.cancel()
    timer = undefined
    if (await isOff($)) return result
    startedAt = await $.clock.now()
    // A new base never equals the last turn's, so the first phrase differs from the last one shown.
    lastBase = (lastBase + 1 + (startedAt % (PHRASES.length - 1)) + PHRASES.length) % PHRASES.length
    const base = lastBase
    await update($, turn, () => ({ sec: 0, tools: 0, base }))

    timer = $.clock.every(1000, async () => {
      const sec = Math.floor(((await $.clock.now()) - startedAt) / 1000)
      await update($, turn, t => ({ ...t, sec }))
    })
    return result
  })



  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (await isOff($)) return next(e)
    const t = await read($, turn)
    // The line replaces the engine's word; its own elapsed time and tokens stay beside it.
    const tomato = pomoSuffix(await read($, pomo), await $.clock.now())
    return next({ ...e, props: { ...e.props, word: line(t) + tomato, message: null, suffix: '' } })
  })
}

/** Counts the turn's tool calls. Run from the band's hook of the same event: a plugin gets one hook per event */
export async function spinnerToolCall($: EngineInterface, e: any, next: (e: any) => any) {
  if (!(await isOff($))) await update($, turn, t => ({ ...t, tools: t.tools + 1 }))
  return next(e)
}

/** Stops the spinner's clock. Run from the band's hook of the same event: a plugin gets one hook per event */
export async function spinnerTurnComplete($: EngineInterface, e: any, next: (e: any) => any) {
  if (e.agentId !== undefined) return next(e) // a subagent ending leaves the main turn's clock running
  timer?.cancel()
  timer = undefined
  return next(e)
}
