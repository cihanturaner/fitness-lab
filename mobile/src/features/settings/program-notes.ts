/**
 * The program notes as readable sections — the web app's parser, ported unchanged. The
 * notes are Markdown whose sections hold the source's rules as JSON blocks; they are shown
 * as labelled lists, verbatim in content, never re-interpreted. Nothing here is executable:
 * progression, deload, calibration and the week-12 benchmark stay the lifter's decisions.
 */
export type NotesBlock = { kind: 'json'; value: unknown } | { kind: 'text'; lines: string[] };
export type NotesSection = { title: string; blocks: NotesBlock[] };

export function parseProgramNotes(text: string, aboutTitle = 'About'): NotesSection[] {
  const sections: NotesSection[] = [{ title: aboutTitle, blocks: [] }];
  let json: string[] | null = null;
  let lines: string[] = [];
  const current = () => sections[sections.length - 1];
  const flush = () => {
    if (lines.length > 0) current().blocks.push({ kind: 'text', lines });
    lines = [];
  };
  for (const raw of text.split('\n')) {
    if (json !== null) {
      if (raw.trim() === '```') {
        try {
          current().blocks.push({ kind: 'json', value: JSON.parse(json.join('\n')) as unknown });
        } catch {
          current().blocks.push({ kind: 'text', lines: json });
        }
        json = null;
      } else {
        json.push(raw);
      }
      continue;
    }
    if (raw.startsWith('```')) {
      flush();
      json = [];
    } else if (raw.startsWith('## ')) {
      flush();
      sections.push({ title: raw.slice(3).trim(), blocks: [] });
    } else if (raw.startsWith('# ')) {
      continue;
    } else if (raw.trim() !== '') {
      lines.push(raw.replace(/^- /, '').replace(/`/g, ''));
    }
  }
  flush();
  return sections.filter((section) => section.blocks.length > 0);
}

/** The program's name in Turkish: the title of the Turkish notes. */
export function turkishProgramName(notes: string): string {
  const title = notes.split('\n').find((line) => line.startsWith('# '));
  return title ? title.slice(2).trim() : '';
}

/** A JSON key as a label: underscores to spaces, first letter capital (as the web shows it). */
export function ruleLabel(key: string): string {
  const text = key.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
