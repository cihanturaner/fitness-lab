import turkishNotes from './program-notes.tr.md?raw'

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

export function parseProgramNotes(text: string, aboutTitle = 'About'): NotesSection[] {
  const sections: NotesSection[] = [{ title: aboutTitle, blocks: [] }]
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

/**
 * sha256 of the program notes the Turkish text (program-notes.tr.md) was translated from:
 * programs/advanced-natural-12w/package/program-notes.md. The Turkish rendering is shown only
 * for exactly those notes; any other program's notes are shown as imported.
 */
export const TURKISH_SOURCE_SHA256 = '2080af04d4402b93f81b4bc484d141f81f134752c87673df2445e4a028dd2683'

/** True when the Turkish translation belongs to exactly these notes. */
export function hasTurkishRules(notesSha256: string | null): boolean {
  return notesSha256 === TURKISH_SOURCE_SHA256
}

/** The locked program's name in Turkish: the title of the Turkish notes. */
export function turkishProgramName(): string {
  const title = turkishNotes.split('\n').find((line) => line.startsWith('# '))
  return title ? title.slice(2).trim() : ''
}
