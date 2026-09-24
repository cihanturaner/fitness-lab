/**
 * The program notes (generated from the locked artifact) as readable sections. The notes are
 * Markdown whose sections hold the source's rules as JSON blocks; they are shown as labelled
 * lists, verbatim in content, never re-interpreted. Nothing here is executable: progression,
 * deload, calibration and the week-12 benchmark stay the lifter's decisions.
 */
export type NotesBlock = { kind: 'json'; value: unknown } | { kind: 'text'; lines: string[] }
export interface NotesSection {
  title: string
  blocks: NotesBlock[]
}

export function parseProgramNotes(text: string): NotesSection[] {
  const sections: NotesSection[] = [{ title: 'About', blocks: [] }]
  let json: string[] | null = null
  let lines: string[] = []
  const current = () => sections[sections.length - 1] as NotesSection
  const flush = () => {
    if (lines.length > 0) current().blocks.push({ kind: 'text', lines })
    lines = []
  }
  for (const raw of text.split('\n')) {
    if (json !== null) {
      if (raw.trim() === '```') {
        try {
          current().blocks.push({ kind: 'json', value: JSON.parse(json.join('\n')) as unknown })
        } catch {
          current().blocks.push({ kind: 'text', lines: json })
        }
        json = null
      } else {
        json.push(raw)
      }
      continue
    }
    if (raw.startsWith('```')) {
      flush()
      json = []
    } else if (raw.startsWith('## ')) {
      flush()
      sections.push({ title: raw.slice(3).trim(), blocks: [] })
    } else if (raw.startsWith('# ')) {
      continue
    } else if (raw.trim() !== '') {
      lines.push(raw.replace(/^- /, '').replace(/`/g, ''))
    }
  }
  flush()
  return sections.filter((section) => section.blocks.length > 0)
}
