import type { EngineInterface, InputProps } from 'claude-code'

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

/**
 * A pane's text field. The terminal draws it with no frame, so there it reads `label [field]`:
 * the brackets mark where to type, `[` on its first line and `]` on its last. Elsewhere it is drawn as it is.
 */
export const field = (r: { Box: any; Text: any; Input: any }, isTerminal: boolean, { label, ...props }: InputProps) => {
  if (!isTerminal) return <r.Input key={props.key} label={label} {...props} />
  const { Box, Text } = r
  return (
    <Box key={`${props.key}-frame`} flexDirection="row" flexGrow={1}>
      {label ? <Text>{`${label} `}</Text> : null}
      <Box alignSelf="flex-start"><Text weight="bold">[</Text></Box>
      <Box flexGrow={1}><r.Input key={props.key} {...props} /></Box>
      <Box alignSelf="flex-end"><Text weight="bold">]</Text></Box>
    </Box>
  )
}
