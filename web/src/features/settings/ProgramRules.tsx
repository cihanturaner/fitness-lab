import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { parseProgramNotes } from './programNotes'

function label(key: string): string {
  const text = key.replace(/_/g, ' ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function Value({ value }: { value: unknown }): ReactNode {
  if (value === null) return <span className="text-faint">—</span>
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
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

export function ProgramRules({ notes }: { notes: string }) {
  const sections = parseProgramNotes(notes)
  return (
    <div className="flex flex-col divide-y divide-border rounded-[10px] border border-border bg-card">
      {sections.map((section) => (
        <details key={section.title} className="group px-5 py-3 text-[13px] leading-5">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium [&::-webkit-details-marker]:hidden">
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            {section.title}
          </summary>
          <div className="mt-3 flex flex-col gap-3 pb-1 pl-5">
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
          </div>
        </details>
      ))}
    </div>
  )
}
