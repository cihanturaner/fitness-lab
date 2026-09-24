import { createContext, useContext, useId, useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import turkishNotes from './program-notes.tr.md?raw'
import { hasTurkishRules, parseProgramNotes } from './programNotes'

const Words = createContext({ yes: 'yes', no: 'no' })

function label(key: string): string {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function BooleanWord({ value }: { value: boolean }) {
  const words = useContext(Words)
  return value ? words.yes : words.no
}

function Value({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="text-faint">—</span>
  if (typeof value === 'boolean') return <BooleanWord value={value} />
  if (typeof value !== 'object') return String(value)
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return <span>{value.map((item) => String(item)).join(', ')}</span>
    }
    return (
      <ul className="flex flex-col gap-2">
        {value.map((item, index) => (
          <li key={index} className="border-l border-border pl-3">
            <Value value={item} />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <dl className="grid grid-cols-[minmax(10rem,14rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5">
      {Object.entries(value as Record<string, unknown>).map(([key, item]) => (
        <div key={key} className="contents">
          <dt className="text-muted-foreground">{label(key)}</dt>
          <dd className="min-w-0">
            <Value value={item} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** One rule section: a button that opens its body with a short height-and-fade motion. */
function RuleSection({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const body = useId()
  return (
    <div className="px-5 py-1 text-[13px] leading-5">
      <h4>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={body}
          className="press flex w-full items-center gap-2 rounded-lg py-2.5 text-left font-semibold hover:text-emerald-800"
          onClick={() => setOpen((value) => !value)}
        >
          <ChevronRight
            className={`size-4 text-emerald-700 transition-transform duration-200 ease-[var(--ease-out)] ${open ? 'rotate-90' : ''}`}
            aria-hidden
          />
          {title}
        </button>
      </h4>
      {/* Closed content stays in the document (searchable, readable) but out of the tab order. */}
      <div id={body} className="accordion-body" data-open={open} inert={!open}>
        <div>
          <div className="flex flex-col gap-3 pt-1 pb-3 pl-6">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function ProgramRules({ notes, notesSha256 }: { notes: string; notesSha256: string | null }) {
  const turkish = hasTurkishRules(notesSha256)
  const sections = turkish ? parseProgramNotes(turkishNotes, 'Program Hakkında') : parseProgramNotes(notes)
  return (
    <Words.Provider value={turkish ? { yes: 'evet', no: 'hayır' } : { yes: 'yes', no: 'no' }}>
      <div
        lang={turkish ? 'tr' : undefined}
        data-testid="program-rules"
        className="flex flex-col divide-y divide-border overflow-hidden rounded-[12px] bg-sunken/60 shadow-[inset_0_0_0_1px_var(--border)]"
      >
        {sections.map((section) => (
          <RuleSection key={section.title} title={section.title}>
            {section.blocks.map((block, index) =>
              block.kind === 'json' ? (
                <Value key={index} value={block.value} />
              ) : (
                <ul key={index} className="flex flex-col gap-1">
                  {block.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ),
            )}
          </RuleSection>
        ))}
      </div>
    </Words.Provider>
  )
}
