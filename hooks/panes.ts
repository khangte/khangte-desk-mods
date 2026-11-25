import type { EngineInterface } from 'claude-code'

/**
 * Opens a pane and brings it to the front. Opening an id that is already open only
 * retitles it, so a pane waiting behind another tab is closed and opened again.
 */
export async function showPane($: EngineInterface, id: string, title: string) {
  const open = await $.ui.panes().catch(() => [])
  if (open.some(p => p.id === id && !p.isShown)) await $.ui.close({ id })
  await $.ui.open({ id, title })
}

/** A label without its leading icon: the terminal draws an emoji 1 or 2 cells wide by font, which shifts the row after it. */
export const iconless = (text: string) => text.replace(/^\p{Extended_Pictographic}️?\s*/u, '')
