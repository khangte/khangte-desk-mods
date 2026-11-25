import { iconless, showPane } from '../panes'
import { PANE as TASKS_PANE, TITLE as TASKS_TITLE } from '../tasks/register'
// a plugin gets one hook per event: the other parts' session.start, tool.call and turn.complete run from here
import { spinnerToolCall, spinnerTurnComplete } from '../spinner/register'
import { tasksSessionStart } from '../tasks/register'
import { clock as pomoClock, freshPomo, remaining } from '../tasks/pomodoro'
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, SessionUsage } from 'claude-code'

import type { Hours, Settings, Sys, Task, TodoTask, Usage } from '../../types'
import { dayOf, listFor, thinBar, todayProgress } from '../tasks/tasks'

import { BANDS, DEFAULT_SETTINGS, FEATURES, normalize, shift, toggle, visible } from './layout'
import { DEFAULT_HOURS, leaveView, parseHours } from './leave'
import { C, EFFORTS, MODELS, planAfter, planView, usePalette } from './control'
import { maskText } from './shield'

const usage = atom({ plugin: 'khangte-desk-mods', key: 'usage' } as const, null)
const sys = atom({ plugin: 'khangte-desk-mods', key: 'sys' } as const, null)
// Owned by today-tasks (/todo); read here for the box gauge and the next-step chips.
const todoTasks = atom({ plugin: 'khangte-desk-mods', key: 'tasks' } as const, [])
// Also 🗓's: the timer the 할 일 row shows while it runs.
const pomo = atom({ plugin: 'khangte-desk-mods', key: 'pomo' } as const, freshPomo(''))
// The ready-made requests, edited in ⚙ 모즈 설정: one ⚡ button each. null: never set here.
const quick = atom({ plugin: 'khangte-desk-mods', key: 'quick' } as const, null)
const MAX_QUICK = 8
const frame = atom({ plugin: 'khangte-desk-mods', key: 'frame' } as const, 0)
const hours = atom({ plugin: 'khangte-desk-mods', key: 'hours' } as const, DEFAULT_HOURS)
const tick = atom({ plugin: 'khangte-desk-mods', key: 'tick' } as const, 0)
const settings = atom({ plugin: 'khangte-desk-mods', key: 'settings' } as const, DEFAULT_SETTINGS)
const isShielded = atom({ plugin: 'khangte-desk-mods', key: 'isShielded' } as const, true) // starts on, every session
const PANE = 'mods-settings'
const SCHEMES = [
  { id: 'dark', label: '어둡게' },
  { id: 'light', label: '밝게' },
] as const
const STORE_KEY = 'mods-settings'
const plan = atom({ plugin: 'khangte-desk-mods', key: 'plan' } as const, null)
const effort = atom({ plugin: 'khangte-desk-mods', key: 'effort' } as const, '')
const model = atom({ plugin: 'khangte-desk-mods', key: 'model' } as const, '')
const memo = atom({ plugin: 'khangte-desk-mods', key: 'memo' } as const, '')
const memoReady = atom({ plugin: 'khangte-desk-mods', key: 'memoReady' } as const, false)
const memoBlink = atom({ plugin: 'khangte-desk-mods', key: 'memoBlink' } as const, 0)
const MEMO = 'next-memo'
const MEMO_TITLE = '📝 다음 요청 메모'
const CONTROL = 'control-center'
const CONTROL_TITLE = '🎛 Claude 도구'

const ROW_PX = 22 // px a band row takes on desktop: its 18px pictures plus a little air
const STRUT = `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="${ROW_PX}"/>`
const HEIGHT = 18 // px: the dog (9 dots of 2px) exactly; no band picture is taller than a line
const PX_PER_CELL = 8 // shortcut: assumes ~8px per cell at the desktop's mono footnote size; measure if bars look off
const MIN_BAR = 3
const FIELD_WIDTH = 22 // cells: a label, `09:00` or `180`, and the field's own frame

type Cell = { name: string; icon?: string; color: string; pct?: number; reset?: string; hasReset: boolean; extra?: string; isLowBad?: boolean } // icon: drawn for the name off the terminal; the name stays the key and alt

/** Cells every row's label takes, padded: the bands' contents start in one column. */
export const LABEL = 10
/** Cells the band needs besides the bars: its label, names, brackets, %, separators. */
const FIXED = LABEL + 1 + 3 * (1 + 2 + 1 + 4) + 'SESSION'.length + 'WEEK'.length + 'CONTEXT'.length + 2 * 3
const RESETS = 2 * 7

/** Shrinks the bars first, then drops the ↻ times, so the band stays one row. */
export const fit = (columns: number, maxBar: number) => {
  const withReset = Math.floor((columns - FIXED - RESETS) / 3)
  if (withReset >= MIN_BAR) return { bar: Math.min(withReset, maxBar), showReset: true }
  return { bar: Math.max(1, Math.min(Math.floor((columns - FIXED) / 3), MIN_BAR)), showReset: false }
}

export const left = (iso: string | undefined, now: number) => {
  const ms = iso === undefined ? NaN : Date.parse(iso) - now
  if (Number.isNaN(ms)) return '–'
  const m = Math.max(0, Math.floor(ms / 60000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  return d > 0 ? `${d}d${h}h` : `${h}h${String(m % 60).padStart(2, '0')}`
}

export const toUsage = (u: SessionUsage): Usage => {
  const win = (kind: string) => u.rateLimits.find(r => r.kind === kind)
  return {
    session: win('five_hour')?.percentUsed,
    sessionReset: win('five_hour')?.resetsAt,
    week: win('seven_day')?.percentUsed,
    weekReset: win('seven_day')?.resetsAt,
    context: u.context.percent,
  }
}

const barSvg = (width: number, pct: number | undefined, color: string) => {
  const fill = pct === undefined ? 0 : Math.round((width * Math.min(100, Math.max(0, pct))) / 100)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">` +
    `<defs><pattern id="d" width="4" height="4" patternUnits="userSpaceOnUse">` +
    `<rect width="4" height="4" fill="${C.dotsBg}"/><circle cx="2" cy="2" r="0.9" fill="${C.dots}"/></pattern></defs>` +
    `<rect x="0" y="4" width="${width}" height="10" fill="url(#d)"/>` +
    `<rect x="0" y="4" width="${fill}" height="10" fill="${color}"/></svg>`
  )
}

/** Opens 🗓 오늘 할 일 from the band's button. */
async function openTasks($: EngineInterface) {
  await showPane($, TASKS_PANE, TASKS_TITLE) // the same plugin's pane: opened directly, no /todo
}

/** Trimmed, no blanks or repeats, at most MAX_QUICK. */
export const cleanQuick = (raw: unknown): string[] =>
  Array.isArray(raw)
    ? raw
        .filter((q): q is string => typeof q === 'string')
        .map(q => q.trim())
        .filter((q, i, all) => q !== '' && all.indexOf(q) === i)
        .slice(0, MAX_QUICK)
    : []

async function quickNow($: EngineInterface) {
  return (await read($, quick)) ?? []
}

// Read from the store, not this window's copy: every open window shares it (see saveSettings).
async function saveQuick($: EngineInterface, fn: (list: string[]) => string[]) {
  const stored = await $.store.get('quick')
  const out = cleanQuick(fn(Array.isArray(stored) ? cleanQuick(stored) : await quickNow($))) // never stored yet: this window's list
  await $.store.set('quick', out) // kept by the host across conversations
  await update($, quick, () => out)
}

/** Changes the settings as the store holds them, so a window open since morning cannot undo another's change. */
async function saveSettings($: EngineInterface, fn: (s: Settings) => Settings) {
  const out = normalize(fn(normalize(await $.store.get(STORE_KEY))))
  await $.store.set(STORE_KEY, out) // kept across conversations by the host
  await update($, settings, () => out)
}

// What is being typed. A field's value is redrawn from these, never from a write made a keystroke ago:
// writing the state on every key redrew the pane mid-typing and dropped letters.
let memoDraft: string | null = null
let quickDraft = ''
let quickAdds = 0 // a new key per add: the host keeps typed text over a redraw whose value is unchanged ('' to '')
const hoursDraft: { start?: string; end?: string } = {}
let typingIn: string | undefined // the field holding the keyboard, while one does

/** The memo as it stands: the draft being typed, else the saved one. */
async function memoText($: EngineInterface) {
  return memoDraft ?? (await read($, memo))
}

async function saveMemo($: EngineInterface, text: string) {
  memoDraft = text
  await update($, memo, () => text)
  await $.store.set('memo', text)
  if (text.trim() === '') await update($, memoReady, () => false)
}

/** Puts the note in the prompt box (never sends it); the note is then used up. */
async function fillMemo($: EngineInterface) {
  const text = await memoText($)
  if (text.trim() === '') return
  const r = await $.prompt.fill({ text })
  if (!r.isFilled) {
    $.ui.toast('지금은 입력창에 채울 수 없어요. 대화 상자가 열려 있으면 닫고 다시 눌러 주세요.')
    return
  }
  await saveMemo($, '')
  await update($, memoReady, () => false)
}

/** /workhours and ⚙ 모즈 설정's field both come here. */
async function saveHours($: EngineInterface, h: Hours) {
  await $.store.set('workhours', `${h.start} ${h.end}`) // kept across sessions by the host
  await update($, hours, () => h)
}

async function refresh($: EngineInterface) {
  const u = await $.session.usage()
  await update($, usage, () => toUsage(u))
}

// Read-only local query, nothing leaves the machine. shortcut: Windows PowerShell/CIM only (WSL reaches it via interop), add a branch for macOS/native Linux if needed.
const PS =
  '$o=Get-CimInstance Win32_OperatingSystem;$b=Get-CimInstance Win32_Battery|Select-Object -First 1;' +
  '[pscustomobject]@{cpu=(Get-CimInstance Win32_Processor|Measure-Object LoadPercentage -Average).Average;' +
  'total=$o.TotalVisibleMemorySize;free=$o.FreePhysicalMemory;bat=$b.EstimatedChargeRemaining}|ConvertTo-Json -Compress'

export const parseSys = (out: string): Sys => {
  try {
    const j = JSON.parse(out) as Record<string, unknown>
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
    const total = n(j.total)
    const free = n(j.free)
    const hasMem = total !== undefined && total > 0 && free !== undefined
    const gb = (kb: number) => Math.round((kb / 1048576) * 10) / 10
    return {
      cpu: n(j.cpu),
      ram: hasMem ? Math.round(((total - free) / total) * 100) : undefined,
      ramUsedGb: hasMem ? gb(total - free) : undefined,
      ramTotalGb: hasMem ? Math.round(total / 1048576) : undefined,
      battery: n(j.bat),
    }
  } catch {
    return {}
  }
}

// The dog, exactly as drawn by the user's pixel map; a dot is transparent, a pixel is 2px.
const DOG = [
  '........BBBBB..',
  '.......BBBBBBB.',
  '......DBKBBBKBD',
  '......DBBBLLBBD',
  'B.....DBBLKLBBD',
  'BB.BBBDBBLLLBD.',
  '.BBBBBBBBBBBB..',
  '.BB.BB..BB.BB..',
  '.DD.DD..DD.DD..',
]
const DOG_COLORS: Record<string, string> = { B: '#B07A42', D: '#6E4123', K: '#1B1B1B', L: '#E2C08E' }
const BOX_H = 10 // px: a slim gauge, well under a text line
const DOG_W = 30

/** Only the two leg rows move: the whole pair of rows slides one dot on the second frame. */
export const dogSvg = (x: number, width: number, step: 0 | 1, trail = C.trail) => {
  const rects = DOG.map((row, r) => {
    const line = r >= 7 && step === 1 ? '.' + row.slice(0, -1) : row
    return [...line.matchAll(/B+|D+|K+|L+/g)]
      .map(m => `<rect x="${x + m.index * 2}" y="${r * 2}" width="${m[0].length * 2}" height="2" fill="${DOG_COLORS[m[0][0]!]}"/>`)
      .join('')
  }).join('')
  const reached = Math.min(width, x + DOG_W / 2)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${HEIGHT}" viewBox="0 0 ${width} ${HEIGHT}">` +
    `<rect x="0" y="16" width="${width}" height="2" fill="${C.rest}"/>` +
    `<rect x="0" y="16" width="${reached}" height="2" fill="${trail}"/>${rects}</svg>`
  )
}


/** Today's /todo list as the bands read it: the 🗓 pane's own rules, so the band and the pane never disagree. */
export const todayTodo = (tasks: readonly TodoTask[] | null | undefined, nowMs: number) => {
  const list = (tasks ?? []) as readonly Task[] // the same saved list; only day, due, done and title are read
  const today = dayOf(nowMs)
  const { done, total } = todayProgress(list, today)
  return { done, total, open: listFor(list, '오늘', today).map(t => t.title) }
}

/** Cells a text takes in the mono font: Hangul, CJK and emoji take two. */
export const cellWidth = (text: string) =>
  [...text].reduce((n, ch) => n + (/[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\ufe30-\ufe4f\uff00-\uff60\u{1f300}-\u{1faff}\u2600-\u27bf]/u.test(ch) ? 2 : 1), 0)

/** The box gauge: `total` boxes in `width` px, the first `done` filled; thin, rounded, a small gap between. */
export const boxGaugeSvg = (done: number, total: number, width: number) => {
  const gap = total > 12 ? 2 : 4
  const w = Math.max(2, (width - gap * (total - 1)) / total)
  const rects = Array.from({ length: total }, (_, i) =>
    `<rect x="${(i * (w + gap)).toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${BOX_H}" rx="2" fill="${i < done ? C.teal : C.boxEmpty}"/>`,
  ).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${BOX_H}" viewBox="0 0 ${width} ${BOX_H}">${rects}</svg>`
}

/** The terminal's gauge: one run of blocks per task in `cells` cells, a space between. */
export const boxGaugeText = (done: number, total: number, cells: number) => {
  const each = Math.max(1, Math.floor((cells - (total - 1)) / total))
  return Array.from({ length: total }, (_, i) => ({ isDone: i < done, text: '█'.repeat(each) }))
}

const MAX_CHIP = 25

/** One button per ready-made request, in the order set in the pane; pressing it fills the box with the text as written. */
export const chips = (list: readonly string[] | null | undefined = []) =>
  (list ?? [])
    .filter(q => typeof q === 'string' && q.trim() !== '')
    .map(q => {
      const s = `▶ ${q.trim()}`
      return { text: s.length <= MAX_CHIP ? s : `${s.slice(0, MAX_CHIP - 1)}…`, prompt: q.trim() }
    })

let isWalking = false // set while drawing: the workday is under way

let isPolling = false
// Failures in a row: past MAX_SYS_FAILURES only every SYS_BACKOFF-th poll tries (about once a minute), so a machine
// with no PowerShell (macOS, Linux, WSL without interop) spawns little, and a busy one that timed out comes back.
let sysFailures = 0
let sysSkipped = 0
const MAX_SYS_FAILURES = 3
const SYS_BACKOFF = 4
async function pollSys($: EngineInterface) {
  if (isPolling) return
  if (sysFailures >= MAX_SYS_FAILURES && ++sysSkipped % SYS_BACKOFF !== 0) return
  if (normalize(await read($, settings)).enabled.sys === false) return // no PowerShell spawned for a hidden row
  isPolling = true
  try {
    // '.exe' so WSL finds it through Windows interop; plain Windows resolves it the same.
    const r = await $.process.run(['powershell.exe', '-NoProfile', '-Command', PS], { timeoutMs: 15_000 }) // a busy PC takes 4-5s just to start PowerShell and ask CIM; longer than the period, isPolling skips the overlap
    const s = parseSys(r.exitCode === 0 ? r.stdout : '')
    sysFailures = Object.values(s).some(v => v !== undefined) ? 0 : sysFailures + 1
    await update($, sys, () => s)
  } catch {
    sysFailures++
    await update($, sys, () => ({}))
  } finally {
    isPolling = false
  }
}

/** No main turn running: the next request is a new one. */
let isIdle = true

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await tasksSessionStart($, e, next)
    await refresh($)
    const savedSettings = await $.store.get(STORE_KEY)
    await update($, settings, () => normalize(savedSettings))
    void pollSys($) // after the settings: a switched-off row spawns nothing
    await $.command.register({ name: 'mods-settings', description: '⚙ 모즈 설정 패널 열기' })
    await $.command.register({ name: 'control', description: '🎛 Claude 도구 패널 열기' })
    const savedQuick = await $.store.get('quick')
    if (Array.isArray(savedQuick)) await update($, quick, () => cleanQuick(savedQuick))
    const savedMemo = await $.store.get('memo')
    if (typeof savedMemo === 'string') await update($, memo, () => savedMemo)
    await $.command.register({ name: 'memo', description: '🎛 Claude 도구의 다음 요청 메모 열기' })
    // The fill button pulses while a note waits for its turn.
    $.clock.every(500, async () => {
      if (typingIn === undefined && (await read($, memoReady))) await update($, memoBlink, b => 1 - b) // no pulse while typing
    })
    const current = await $.session.model().catch(() => '')
    await update($, model, () => current)
    const saved = await $.store.get('workhours')
    const parsed = typeof saved === 'string' ? parseHours(saved) : undefined
    if (parsed) await update($, hours, () => parsed)
    await $.command.register({ name: 'workhours', description: '출근·퇴근 시각 바꾸기', argumentHint: '09:00 18:00' })
    $.clock.every(1000, async () => {
      const n = await $.clock.now()
      await update($, tick, () => n)
    })
    // 10s: spawning PowerShell costs CPU itself, and every open session polls on its own
    $.clock.every(10_000, () => {
      void pollSys($)
    })
    // The legs swing only while there is still a way to go.
    $.clock.every(400, () => void (isWalking && update($, frame, f => 1 - f)))
    return result
  })

  // Claude's checklist, followed from the calls that keep it; the call itself goes on unchanged.
  on('tool.call', async ($, e, next) => {
    const now = await read($, plan)
    const after = planAfter(now, e.tool, e as unknown as Record<string, unknown>)
    if (after !== undefined) await update($, plan, () => after)
    return spinnerToolCall($, e, next)
  })

  // A new request starts with no checklist: the bar hides until Claude makes one for it.
  // Slash commands (a /todo typed mid-work) leave it alone.
  on('prompt.submit', async ($, e, next) => {
    // a message sent while Claude works joins that work: the bar stays
    // a slash command (a /todo typed while idle) starts no turn, so it leaves both as they are
    if (isIdle && !e.text.trimStart().startsWith('/')) {
      await update($, plan, () => null)
      isIdle = false
    }
    await update($, memoReady, () => false) // a new turn starts; the note waits for its end
    if (memoDraft !== null && typingIn === 'memo-input') await saveMemo($, memoDraft)
    typingIn = undefined
    return next(e)
  })

  on('ui.focus', { component: 'Pane', requestId: CONTROL }, async ($, e, next) => {
    const result = await next(e)
    const was = typingIn
    typingIn = e.element === 'memo-input' ? e.element : undefined
    if (was === 'memo-input' && typingIn !== 'memo-input' && memoDraft !== null) await saveMemo($, memoDraft)
    return result
  })

  on('command.run', { command: 'memo' }, async $ => {
    await showPane($, CONTROL, CONTROL_TITLE) // the memo lives in the control centre now
    return { text: `${CONTROL_TITLE}의 ${MEMO_TITLE}를 열었어요.` }
  })

  on('command.run', { command: 'control' }, async $ => {
    await showPane($, CONTROL, CONTROL_TITLE)
    return { text: `${CONTROL_TITLE}를 열었어요.` }
  })

  on('ui.render', { component: 'Pane', requestId: CONTROL }, async ($, e) => {
    await usePalette($)
    const r = $.ui.resolve(e)
    const { Box, Button, Text } = r
    const cfg = normalize(await read($, settings))
    if (cfg.enabled.control === false) return <Text dimColor>Claude 도구가 ⚙ 모즈 설정에서 꺼져 있어요.</Text>
    const level = await read($, effort)
    const current = await read($, model)
    const isTerminal = e.surface === 'terminal'
    const ic = (s: string) => (isTerminal ? iconless(s) : s) // icons on desktop only
    const line = isTerminal ? {} : { minHeight: 2 }
    const gap = isTerminal ? 0 : 1
    const note = await memoText($)
    const isReady = (await read($, memoReady)) && note.trim() !== ''
    const isLit = isReady && (await read($, memoBlink)) === 1
    const memoStatus = note.trim() === '' ? '비어 있어요' : isReady ? ic('✨ 답이 끝났어요. 채워 보세요') : `저장됨 · ${note.length}자`
    // A thin rule across the pane between its parts.
    const divider = (key: string) => (
      <Text key={key} color={C.pale} wrap="truncate">{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
    )
    // A press runs /effort or /model as typing it would, so the session's own setting changes and nothing can drift apart.
    const setEffort = async (lv: string) => {
      await update($, effort, () => lv)
      void $.command.run({ command: 'effort', args: lv }).catch(() => undefined) // not awaited: /effort can outlast the press's 10s budget
    }
    const switchTo = async (m: (typeof MODELS)[number]) => {
      await update($, model, () => m.id)
      void $.command.run({ command: 'model', args: m.alias }).catch(() => undefined) // not awaited: /model can outlast the press's 10s budget
    }

    return (
      <Box flexDirection="column" rowGap={gap} paddingX={1} paddingY={1}>
        <Text size="heading" weight="bold" color={C.deep}>{ic(CONTROL_TITLE)}</Text>

        <Box flexDirection="column" rowGap={gap}>
          <Text weight="bold" color={C.deep}>{ic('🤖 모델')}</Text>
          <Box {...line} flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
            <Text weight="bold" color={C.deep} mono>{'Model '}</Text>
            {MODELS.map(m => (
              <Button key={`model-${m.id}`} variant={current.toLowerCase().includes(m.alias) ? 'primary' : 'secondary'} onPress={() => switchTo(m)}>
                {m.label}
              </Button>
            ))}
          </Box>
          <Box {...line} flexDirection="row" alignItems="center" columnGap={1} flexWrap="wrap">
            <Text weight="bold" color={C.deep} mono>{'Effort'}</Text>
            {EFFORTS.map(f => (
              <Button key={`effort-${f.level}`} variant={level === f.level ? 'primary' : 'secondary'} onPress={() => setEffort(f.level)}>
                {f.label}
              </Button>
            ))}
          </Box>
        </Box>

        {divider('cc-line-2')}
        {(
          <Box key="memo" flexDirection="column" rowGap={gap}>
            <Text weight="bold" color={C.deep}>{ic(MEMO_TITLE)}</Text>
            <Text size="footnote" color={C.mid}>Claude가 일하는 동안 다음에 시킬 일을 적어 두세요. 적는 대로 저장돼요.</Text>
            {'Input' in r ? (
              <r.Input
                key="memo-input"
                rows={4}
                value={note}
                placeholder="방금 기획한 기능을 추가해줘"
                submitLabel="저장"
                onInput={v => {
                  memoDraft = v // kept here and in the store, not in the state: no redraw while typing
                  void $.store.set('memo', v)
                }}
                onSubmit={v => void saveMemo($, v)}
              />
            ) : (
              <Text color={C.deep}>{note || '(이 화면에서는 적을 수 없어요)'}</Text>
            )}
            <Box {...line} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={1} flexWrap="wrap">
              <Text size="footnote" color={isReady ? C.blue : C.mid} weight={isReady ? 'bold' : 'regular'}>{memoStatus}</Text>
              <Box flexDirection="row" columnGap={1} alignItems="center">
                <Button key="memo-clear" onPress={() => saveMemo($, '')}>지우기</Button>
                <Button key="memo-fill" variant={isLit ? 'primary' : 'secondary'} onPress={() => fillMemo($)}>
                  {isReady ? ic('✨ 입력창에 채우기') : '입력창에 채우기'}
                </Button>
              </Box>
            </Box>
          </Box>
        )}
      </Box>
    )
  })

  on('command.run', { command: 'mods-settings' }, async $ => {
    await showPane($, PANE, '⚙ 모즈 설정')
    return { text: '⚙ 모즈 설정 패널을 열었어요.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    await usePalette($)
    const r = $.ui.resolve(e)
    const { Box, Button, Text } = r
    const cfg = normalize(await read($, settings))
    const nexts = await quickNow($)
    const wh: Hours = (await read($, hours)) ?? DEFAULT_HOURS
    const change = (fn: (s: Settings) => Settings) => saveSettings($, fn)
    const nameOf = (id: string) => BANDS.find(b => b.id === id)
    const switchOf = (id: string) => {
      const isOn = cfg.enabled[id] !== false
      return (
        <Button key={`sw-${id}`} variant={isOn ? 'primary' : 'secondary'} onPress={() => change(s => toggle(s, id))}>
          {isOn ? '● 켜짐' : '○ 꺼짐'}
        </Button>
      )
    }

    const isTerminal = e.surface === 'terminal'
    const ic = (s: string) => (isTerminal ? iconless(s) : s) // icons on desktop only
    // Desktop buttons stand taller than a line: each row gets two lines and a gap, so rows never touch.
    const line = isTerminal ? {} : { minHeight: 2 }
    const gap = isTerminal ? 0 : 1
    const item = (id: string, title: string, isOn: boolean, controls: RenderChildren) => (
      <Box key={`it-${id}`} {...line} flexDirection="row" alignItems="center" justifyContent="space-between" columnGap={2}>
        <Text dimColor={!isOn} wrap="truncate">{title}</Text>
        <Box flexDirection="row" alignItems="center" columnGap={1} flexShrink={0}>
          {controls}
        </Box>
      </Box>
    )

    const divider = (key: string) => (
      <Text key={key} color={C.pale} wrap="truncate">{'─'.repeat(Math.max(10, e.props.bodyColumns - 2))}</Text>
    )

    return (
      <Box flexDirection="column" rowGap={gap} paddingX={1}>
        <Text weight="bold">입력창 위 밴드</Text>
        <Text dimColor>위에서 아래로 그려지는 순서예요. ▲▼로 옮기고, 오른쪽 버튼으로 켜고 끕니다.</Text>
        <Box flexDirection="column" rowGap={gap}>
          {cfg.order.map((id, i) => {
            const band = nameOf(id)
            const isOn = cfg.enabled[id] !== false
            // no (설명): long names push the ▲▼ about; the icon only off the terminal
            return item(id, `${i + 1}. ${ic(`${band?.icon ?? ''} ${(band?.name ?? id).replace(/ \(.*\)$/, '')}`)}`, isOn, [
              <Button key={`up-${id}`} dimColor={i === 0} onPress={() => change(s => shift(s, id, -1))}>▲</Button>,
              <Button key={`down-${id}`} dimColor={i === cfg.order.length - 1} onPress={() => change(s => shift(s, id, 1))}>▼</Button>,
              switchOf(id),
            ])
          })}
        </Box>
        {divider('set-line-0')}
        <Text weight="bold">{ic('🎨 색상')}</Text>
        <Text dimColor>어두운 화면이면 어둡게, 흰 화면이면 밝게를 고르세요.</Text>
        <Box {...line} flexDirection="row" alignItems="center" columnGap={1}>
          {SCHEMES.map(sc => (
            <Button key={`scheme-${sc.id}`} variant={cfg.scheme === sc.id ? 'primary' : 'secondary'} onPress={() => change(s => ({ ...s, scheme: sc.id }))}>
              {sc.label}
            </Button>
          ))}
        </Box>
        {'Input' in r ? (
          [
            divider('set-line-h'),
            <Text key="hours-title" weight="bold">{ic('⏰ 근무 시간')}</Text>,
            <Box key="hours-fields" flexDirection="row" columnGap={2} alignItems="center" flexWrap="wrap">
              {(['start', 'end'] as const).map(k => (
                <Box key={`hours-${k}-box`} width={FIELD_WIDTH} flexShrink={0}>
                  <r.Input
                    key={`hours-${k}`}
                    label={k === 'start' ? '출근' : '퇴근'}
                    placeholder={k === 'start' ? '09:00' : '18:00'}
                    submitLabel="적용"
                    value={hoursDraft[k] ?? wh[k]}
                    onInput={v => {
                      hoursDraft[k] = v
                    }}
                    onSubmit={async v => {
                      delete hoursDraft[k]
                      // one field at a time: the other keeps its saved time, read now and not from this drawing
                      const cur: Hours = (await read($, hours)) ?? DEFAULT_HOURS
                      const h = parseHours(k === 'start' ? `${v.trim()} ${cur.end}` : `${cur.start} ${v.trim()}`)
                      if (!h) return $.ui.toast('예: 09:00 (24시간제, 퇴근이 출근보다 늦게)')
                      await saveHours($, h)
                      $.ui.toast(`출근 ${h.start} · 퇴근 ${h.end}`)
                    }}
                  />
                </Box>
              ))}
            </Box>,
          ]
        ) : (
          <Text dimColor>근무 시간은 /workhours로 바꿀 수 있어요.</Text>
        )}
        {divider('set-line-q')}
        <Text weight="bold">{ic('⚡ 원터치 요청 버튼')}</Text>
        <Text dimColor>여기 적은 요청이 입력창 위 ⚡ 버튼이 돼요. 누르면 입력창에 채워지고, 보내는 건 직접 해야 돼요.</Text>
        {nexts.length === 0 ? (
          <Text dimColor>아직 없어요.</Text>
        ) : (
          <Box flexDirection="column">
            {nexts.map((q, i) =>
              item(`quick-${i}`, `${i + 1}. ${q}`, true, [
                <Button key={`quick-up-${i}`} onPress={() => saveQuick($, l => (i === 0 ? l : [...l.slice(0, i - 1), l[i]!, l[i - 1]!, ...l.slice(i + 1)]))}>▲</Button>,
                <Button key={`quick-del-${i}`} onPress={() => saveQuick($, l => l.filter((_, k) => k !== i))}>✕</Button>,
              ]),
            )}
          </Box>
        )}
        {'Input' in r && nexts.length < MAX_QUICK ? (
          <r.Input
            key={`quick-add-${quickAdds}`}
            placeholder="다음 진행해"
            submitLabel="추가"
            value={quickDraft}
            onInput={v => {
              quickDraft = v // kept here, not in the state: no redraw while typing
            }}
            onSubmit={v => {
              quickDraft = ''
              quickAdds += 1
              void saveQuick($, l => [...l, v])
            }}
          />
        ) : null}
        {divider('set-line-1')}
        <Text weight="bold">기능</Text>
        <Text dimColor>끄면 그 기능이 멈춰요.</Text>
        <Box flexDirection="column" rowGap={gap}>
          {FEATURES.filter(it => it.group === 'feature').map(it => item(it.id, ic(`${it.icon} ${it.name}`), cfg.enabled[it.id] !== false, [switchOf(it.id)]))}
        </Box>
        {divider('set-line-2')}
        <Text weight="bold">버튼 줄</Text>
        <Text dimColor>입력창 위 맨 아래 줄에 버튼을 보일지 정해요. 모자이크는 그 버튼으로 켜고 끄고, 숨기면 꺼져요. ⚙ 모즈 설정 버튼은 늘 있어요.</Text>
        <Box flexDirection="column" rowGap={gap}>
          {FEATURES.filter(it => it.group === 'button').map(it => item(it.id, ic(`${it.icon} ${it.name} 버튼`), cfg.enabled[it.id] !== false, [switchOf(it.id)]))}
        </Box>
      </Box>
    )
  })

  on('command.run', { command: 'workhours' }, async ($, e) => {
    const h = e.args.trim() === '' ? await read($, hours) : parseHours(e.args)
    if (!h) return { text: '사용법: /workhours 09:00 18:30 (출근 퇴근, 24시간제, 퇴근이 출근보다 늦게)' }
    await saveHours($, h)
    return { text: `출근 ${h.start} · 퇴근 ${h.end}` }
  })

  // the session's own effort, read from each main request: the lit button is right from the first answer on
  // turn.step streams: the hook is a generator that passes the stream on untouched
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && typeof e.effort === 'string' && (await read($, effort)) !== e.effort) {
      const level = e.effort
      await update($, effort, () => level)
    }
    return yield* next(e)
  })

  // an /effort typed by hand moves the lit button too
  on('command.run', { command: 'effort' }, async ($, e, next) => {
    if (e.origin.kind !== 'plugin') await update($, effort, () => e.args.trim())
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await spinnerTurnComplete($, e, next)
    if (e.agentId === undefined) isIdle = true
    const m = await $.session.model().catch(() => '')
    await update($, model, () => m) // a /model typed by hand shows on the buttons too
    // the main answer is in (not a subagent's): the note's turn
    if (e.agentId === undefined && (await memoText($)).trim() !== '') await update($, memoReady, () => true)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const cfg = normalize(await read($, settings))
    const isOn = (await read($, isShielded)) !== false
    // Only what is drawn changes: the stored reply, ctrl+o's copy and every file stay as they are.
    if (cfg.enabled.shield === false || !isOn) return next(e)
    return next({ ...e, props: { ...e.props, text: maskText(e.props.text) } })
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    await usePalette($)

    const u = (await read($, usage)) ?? {}
    const s = (await read($, sys)) ?? {}
    const t = todayTodo(await read($, todoTasks), await $.clock.now())
    const wh: Hours = (await read($, hours)) ?? DEFAULT_HOURS
    const cfg = normalize(await read($, settings))
    await read($, tick) // redraw every second
    const step = (await read($, frame)) === 1 ? 1 : 0
    const now = await $.clock.now()
    const isTerminal = e.surface === 'terminal'
    const { bar, showReset } = fit(e.props.bodyColumns, isTerminal ? 20 : 120 / PX_PER_CELL)
    const cells: Cell[] = [
      { name: 'CONTEXT', color: C.cyan, pct: u.context, hasReset: false },
      { name: 'SESSION', color: C.teal, pct: u.session, reset: u.sessionReset, hasReset: true },
      { name: 'WEEK', color: C.green, pct: u.week, reset: u.weekReset, hasReset: true },
    ]
    const r = $.ui.resolve(e)
    const { Box, Button, Text } = r
    // Every band opens with its bold label padded to LABEL cells, no icon: an emoji's width differs by terminal and shifts the row.
    // gap: the row's own columnGap after the tag, taken off the padding so every row's body starts at the same column
    const tag = (name: string, gap = 0) => (
      <Text mono size="footnote" weight="bold" color={C.mid} wrap="truncate">{name + ' '.repeat(Math.max(1 - gap, LABEL - gap - cellWidth(name)))}</Text>
    )

    const drawBar = (c: Cell, color: string) => {
      if (e.surface === 'terminal' || !('Svg' in r)) {
        const f = c.pct === undefined ? 0 : Math.round((bar * Math.min(100, c.pct)) / 100)
        return (
          <Text wrap="truncate">
            <Text color={color}>{'█'.repeat(f)}</Text>
            <Text color={C.dots}>{'░'.repeat(bar - f)}</Text>
          </Text>
        )
      }
      const Svg = r.Svg
      const px = Math.round(bar * PX_PER_CELL)
      return <Svg source={barSvg(px, c.pct, color)} alt={`${c.name} ${c.pct ?? '–'}%`} width={px} height={HEIGHT} />
    }

    const row = (label: string, cells: Cell[], key: string) => (
      <Box key={key} flexDirection="row" flexWrap="nowrap" alignItems="center" overflow="hidden" backgroundColor={C.navy} paddingX={1}>
        {tag(label)}
        {cells.map((c, i) => {
          // the battery warns when low, the rest when high
          const color = (c.isLowBad ? (c.pct ?? 100) < 20 : (c.pct ?? 0) > 80) ? C.orange : c.color
          const pct = c.pct === undefined ? '–' : `${Math.round(c.pct)}%`
          return (
            <Box key={c.name} flexDirection="row" flexWrap="nowrap" alignItems="center" flexShrink={0}>
              {i > 0 ? <Text mono size="footnote" color={C.gray} wrap="truncate">{' │ '}</Text> : null}
              {/* a bare figure needs its name too: no bar, no bracket */}
              <Text mono size="footnote" weight="bold" color={C.name} wrap="truncate">{`${e.surface === 'terminal' ? c.name : (c.icon ?? c.name)} [`}</Text>
              {drawBar(c, color)}
              <Text mono size="footnote" weight="bold" color={C.name} wrap="truncate">{']'}</Text>
              <Text mono tabular size="footnote" color={C.gray} wrap="truncate">
                {` ${pct}`}
                {c.hasReset && showReset ? ` ↻${left(c.reset, now)}` : ''}
                {c.extra ? ` ${c.extra}` : ''}
              </Text>
            </Box>
          )
        })}
      </Box>
    )

    const ram = s.ramUsedGb === undefined ? '–' : `${s.ramUsedGb.toFixed(1)}/${s.ramTotalGb}GB`
    const sysCells: Cell[] = [
      { name: 'CPU', color: C.teal, pct: s.cpu, hasReset: false },
      { name: 'RAM', color: C.green, pct: s.ram, hasReset: false, extra: ram },
      { name: 'BAT', icon: '🔋', color: C.cyan, pct: s.battery, hasReset: false, isLowBad: true },
    ]

    const leave = leaveView(now, wh)
    const cols = e.props.bodyColumns

    const isMasked = (await read($, isShielded)) !== false
    const work = planView(await read($, plan))
    const boxes = t // one box per task of today's /todo list, filled per done one
    const nextChips = chips(await quickNow($)) // hidden until requests are set in ⚙ 모즈 설정
    const memoWaiting = (await read($, memoReady)) && (await read($, memo)).trim() !== ''
    const memoLit = memoWaiting && (await read($, memoBlink)) === 1
    // Desktop buttons stand taller than a line of text: rows that hold them get two lines, so nothing overlaps.
    const buttonRow = isTerminal ? {} : { minHeight: 2, rowGap: 1 }
    const isUrgent = leave.kind === 'soon' || leave.kind === 'tidy'
    const trackPx = Math.max(60, Math.min(240, (cols - 44) * PX_PER_CELL))
    const trackChars = Math.max(8, Math.min(cols - 44, 30))
    const isTextOnly = e.surface === 'terminal' || !('Svg' in r)
    const dayRatio = leave.meter ? leave.meter.pct / 100 : leave.kind === 'cheer' || leave.kind === 'over' ? 1 : 0
    const hasTrack = leave.kind !== 'rest'
    const list = visible(cfg)
    isWalking = leave.meter !== undefined && list.includes('leave') // a hidden dog needs no 400ms redraws
    const trail = isUrgent ? C.orange : C.trail
    const track = () => {
      if (e.surface === 'terminal' || !('Svg' in r)) {
        const n = trackChars
        const pos = Math.round((n - 2) * dayRatio)
        return (
          <Text mono wrap="truncate">
            {'🏠'}
            <Text color={trail}>{'─'.repeat(pos)}</Text>
            {'🐕'}
            <Text color={C.rest}>{'─'.repeat(n - 2 - pos)}</Text>
            {'🚩'}
          </Text>
        )
      }
      const width = trackPx
      const x = Math.round((width - DOG_W) * dayRatio)
      return (
        <Box flexDirection="row" alignItems="center">
          <Text mono size="footnote">{'🏠'}</Text>
          <r.Svg
            source={dogSvg(x, width, isWalking ? step : 0, trail)}
            alt={`퇴근까지 ${Math.round(dayRatio * 100)}%`}
            width={width}
            height={HEIGHT}
          />
          <Text mono size="footnote">{'🚩'}</Text>
        </Box>
      )
    }
    const leaveTextOf = leave.meter ? `${leave.meter.clock} 남음 · ${leave.meter.pct}%` : leave.text
    const leaveCells = LABEL + 4 + (isTextOnly ? trackChars : trackPx / PX_PER_CELL) + cellWidth(leaveTextOf)
    const countText = `${boxes.done}/${boxes.total}`
    // a running or paused 🍅 shows at the row's end, so the time left needs no pane
    const tp = (await read($, pomo)) ?? freshPomo('') // a value never written reads as nothing in tests
    const pomoText = tp.status === 'idle' ? '' : `${tp.mode === 'rest' ? '☕' : '🍅'} ${pomoClock(remaining(tp, now))}${tp.status === 'paused' ? ' ⏸' : ''}`
    // same length as the 퇴근 row: its tag, 🏠 track 🚩 and time, less this row's tag and count
    const gaugeCells = Math.max(boxes.total * 2, Math.round(leaveCells - LABEL - cellWidth(countText) - (pomoText ? cellWidth(pomoText) + 3 : 0)))
    const leaveBody =
      leave.kind === 'cheer' ? (
        <Text size="title" weight="bold" color={C.orange} wrap="truncate">{leave.text}</Text>
      ) : leave.meter ? (
        <Text mono tabular size="footnote" wrap="truncate">
          <Text color={isUrgent ? C.orange : C.gray}>{`${leave.meter.clock} 남음 · ${leave.meter.pct}%`}</Text>
          {leave.kind === 'tidy' ? <Text color={C.orange}>{'  정리할 시간이에요 🧹'}</Text> : ''}
        </Text>
      ) : (
        <Text mono size="footnote" color={C.gray} wrap="truncate">{leave.text}</Text>
      )

    const workWidth = Math.max(80, Math.min(240, (e.props.bodyColumns - 40) * PX_PER_CELL))
    const workFill = work ? Math.round(work.ratio * 20) : 0
    const nodes = {
      // Hidden (nothing drawn) while there is no checklist for the request at hand.
      // One box per task of today's /todo list, filled as each is done; the boxes share the row's width.
      todo:
        boxes.total > 0 || pomoText ? (
          <Box key="todo" flexDirection="row" alignItems="center" columnGap={1} backgroundColor={C.navy} paddingX={1}>
            {tag('할 일', 1)}
            {boxes.total === 0 ? null : isTextOnly ? (
              <Text mono wrap="truncate">
                {boxGaugeText(boxes.done, boxes.total, gaugeCells).map((b, i) => (
                  <Text key={`box-${i}`} color={b.isDone ? C.teal : C.boxEmpty}>{(i > 0 ? ' ' : '') + b.text}</Text>
                ))}
              </Text>
            ) : (
              <r.Svg
                source={boxGaugeSvg(boxes.done, boxes.total, gaugeCells * PX_PER_CELL)}
                alt={`오늘 할 일 ${boxes.done}/${boxes.total}`}
                width={gaugeCells * PX_PER_CELL}
                height={BOX_H}
              />
            )}
            {boxes.total === 0 ? null : <Text mono tabular size="footnote" weight="bold" color={C.name}>{countText}</Text>}
            {pomoText ? <Text mono tabular size="footnote" color={tp.mode === 'rest' ? C.green : C.orange}>{`· ${pomoText}`}</Text> : null}
          </Box>
        ) : null,
      plan: work ? (
        <Box key="plan" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} backgroundColor={C.navy} paddingX={1}>
          {tag('이번 작업', 1)}
          {isTerminal || !('Svg' in r) ? (
            <Text mono wrap="truncate">
              <Text color={C.teal}>{'▰'.repeat(workFill)}</Text>
              <Text color={C.dots}>{'▱'.repeat(20 - workFill)}</Text>
            </Text>
          ) : (
            <r.Svg source={thinBar(work.ratio, workWidth, C.pale, C.blue)} alt={`이번 작업 ${work.done}/${work.total}`} width={workWidth} height={10} />
          )}
          <Text mono tabular size="footnote" color={C.gray} wrap="truncate">
            {`${work.done}/${work.total} · ${work.now ? `${work.now} 중` : '완료 ✓'}`}
          </Text>
        </Box>
      ) : null,
      chips: nextChips.length === 0 ? null : (
        <Box key="next" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} rowGap={isTerminal ? 0 : 1} backgroundColor={C.navy} paddingX={1}>
          {tag('요청', 1)}
          {nextChips.map((c, i) => (
            <Button
              key={`go${i}`}
              variant="secondary"
              onPress={() => void $.prompt.fill({ text: c.prompt })}
            >
              {c.text}
            </Button>
          ))}
        </Box>
      ),
      usage: row('사용량', cells, 'usage'),
      // hidden until something was read: no row of dashes where PowerShell is missing
      sys: Object.values(s).some(v => v !== undefined) ? row('컴퓨터', sysCells, 'sys') : null,
      leave: (
        <Box key="leave" flexDirection="row" flexWrap="wrap" alignItems="center" columnGap={1} backgroundColor={C.navy} paddingX={1}>
          {tag('퇴근', 1)}
          {hasTrack ? track() : null}
          {leaveBody}
        </Box>
      ),
    }

    // The ⚙ button keeps the bottom-right corner, below every band.
    const gear = (
      <Box key="gear" flexDirection="row" alignItems="center" columnGap={1} paddingX={1} flexWrap="wrap" justifyContent="flex-end">
        {/* the one switch for 모자이크 (the ⚙ one only shows it): 🙈 hiding and lit, 👁 showing; no 켜짐/꺼짐 words, so the row stays short */}
        {cfg.enabled.shield === false ? null : [
          <Button key="toggle-shield" variant={isMasked ? 'primary' : 'secondary'} onPress={() => update($, isShielded, v => v === false)}>
            {isMasked ? '🙈 모자이크' : '👁 모자이크'}
          </Button>,
          // a rule between what switches here and what opens a panel
          <Text key="rule" color={C.dots}>│</Text>,
        ]}
        {cfg.enabled.tasks === false ? null : (
          <Button key="open-tasks" onPress={() => openTasks($)}>
            🗓 오늘 할 일
          </Button>
        )}
        {cfg.enabled.control === false ? null : (
          <Button key="open-control" onPress={() => showPane($, CONTROL, CONTROL_TITLE)}>
            🎛 Claude 도구
          </Button>
        )}
        <Button key="open-settings" onPress={() => showPane($, PANE, '⚙ 모즈 설정')}>
          ⚙ 모즈 설정
        </Button>
      </Box>
    )

    return (
      <Box flexDirection="column" paddingLeft={1} backgroundColor={C.navy}>
        {list.map(id =>
          nodes[id] === null ? null : (
            // one line per band, held a touch taller than its 18px pictures by an invisible strut so rows breathe evenly
            <Box key={`slot-${id}`} flexDirection="row" alignItems="center" backgroundColor={C.navy}>
              {isTerminal || !('Svg' in r) ? null : <r.Svg source={STRUT} alt=" " width={1} height={ROW_PX} />}
              <Box flexDirection="column" flexGrow={1}>
                {nodes[id]}
              </Box>
            </Box>
          ),
        )}
        {/* unpainted: 요청's buttons stand taller than their one line, and their foot shows through this row's empty top (the band's navy is behind) */}
        <Box key="gear-row" {...buttonRow} flexDirection="row" alignItems="center" justifyContent="flex-end">
          {gear}
        </Box>
      </Box>
    )
  })
}
