/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { TURKISH_SOURCE_SHA256, parseProgramNotes } from './programNotes'
import { ProgramRules } from './ProgramRules'

const REPO = path.resolve(import.meta.dirname, '../../../..')
const SOURCE = readFileSync(path.join(REPO, 'programs/advanced-natural-12w/package/program-notes.md'), 'utf-8')
const TURKISH = readFileSync(path.join(import.meta.dirname, 'program-notes.tr.md'), 'utf-8')

const HEADINGS = [
  'Program Hakkında',
  'Haftalık Program',
  'Uygulama Kuralları',
  'İlerleme Kuralları',
  'Plato / İlerleme Durması',
  'Kalibrasyon',
  'Hafta 1–11',
  'Deload (P1)',
  'Hafta 12 (P2)',
  'Isınma',
  'Haftalık Hacim',
  'Egzersiz Değişim Matrisi',
]

/** The raw text of each "## " section (the part before the first heading is "About"). */
function sections(text: string): string[] {
  return text.split(/^## .*$/m)
}

function numbers(text: string): string[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).sort()
}

function jsonOf(section: string): unknown {
  const match = /```json\n([\s\S]*?)\n```/.exec(section)
  if (!match?.[1]) throw new Error('no JSON block')
  return JSON.parse(match[1]) as unknown
}

describe('Program rules in Turkish', () => {
  it('is a translation of exactly the imported program notes', () => {
    expect(createHash('sha256').update(SOURCE, 'utf8').digest('hex')).toBe(TURKISH_SOURCE_SHA256)
  })

  it('shows every heading in Turkish', () => {
    render(<ProgramRules notes={SOURCE} notesSha256={TURKISH_SOURCE_SHA256} />)
    const rules = screen.getByTestId('program-rules')
    expect(rules).toHaveAttribute('lang', 'tr')
    expect(within(rules).getAllByRole('button').map((button) => button.textContent)).toEqual(HEADINGS)
  })

  it('shows every value in Turkish: no source key, no English yes/no', () => {
    render(<ProgramRules notes={SOURCE} notesSha256={TURKISH_SOURCE_SHA256} />)
    const text = screen.getByTestId('program-rules').textContent ?? ''
    // The only snake_case left is the source file's own name.
    expect(text.replace('locked_workout_program.json', '')).not.toMatch(/\b[a-z]+_[a-z_]+\b/)
    expect(text).not.toMatch(/\b(yes|no|Duration days|Weekly schedule|work sets|rest)\b/)
    expect(text).toContain('evet')
    expect(text).toContain('hayır')
  })

  it('keeps every number of every section', () => {
    const source = sections(SOURCE)
    const turkish = sections(TURKISH)
    expect(turkish).toHaveLength(source.length)
    source.forEach((section, index) => {
      expect(numbers(turkish[index] ?? ''), `section ${index}`).toEqual(numbers(section))
    })
  })

  it('keeps every JSON structure: same shape, same numbers, same booleans', () => {
    const source = sections(SOURCE).slice(2) // About and Weekly schedule are text
    const turkish = sections(TURKISH).slice(2)
    const shape = (value: unknown): unknown => {
      if (Array.isArray(value)) return value.map(shape)
      if (value !== null && typeof value === 'object') return Object.values(value).map(shape)
      return typeof value === 'string' ? 'text' : value
    }
    source.forEach((section, index) => {
      const english = jsonOf(section)
      const translated = jsonOf(turkish[index] ?? '')
      // The deload set mapping is written "4 set →": "2 set" (integer keys would reorder).
      if (index === 5) return
      expect(shape(translated), `section ${index + 2}`).toEqual(shape(english))
    })
  })

  it('never translates an exercise name', () => {
    const english = jsonOf(sections(SOURCE)[11] ?? '') as Record<string, unknown>
    const turkish = jsonOf(sections(TURKISH)[11] ?? '') as Record<string, unknown>
    const exercises = (value: Record<string, unknown>) =>
      Object.entries(value).filter(([, item]) => Array.isArray(item))
    expect(exercises(turkish)).toEqual(exercises(english))
    for (const marker of ['Smith Flat Bench Press', 'Smith High-Bar Squat', 'Neutral-Grip Lat Pulldown']) {
      expect(sections(TURKISH)[8]).toContain(`"Egzersiz": "${marker}"`)
    }
    expect(sections(TURKISH)[11]).toContain('45° Back Extension')
    for (const name of ['Upper A', 'Lower A', 'Upper B', 'Lower B']) {
      expect(sections(TURKISH)[1]).toContain(name)
    }
  })

  it('keeps the source tokens RIR, P7′ and the e1RM formula verbatim', () => {
    expect(TURKISH).toContain('Yama P7′')
    expect(TURKISH).toContain('load * (1 + (reps + RIR) / 30)')
    expect(TURKISH).toContain('81a7d4bca38bb4a581d146abfc4c6b83b239e281ea4896f37addcd6a76d7b24e')
    expect(TURKISH).toContain('FINAL_PATCHED_LOCKED, DECISION_GRADE_PASS_WITH_CAVEAT')
  })

  it('shows another program’s notes as imported', () => {
    const other = '# Other\n\n## Weekly schedule\n\n- Monday: Push'
    render(<ProgramRules notes={other} notesSha256={'c'.repeat(64)} />)
    expect(screen.getByRole('button', { name: 'Weekly schedule' })).toBeInTheDocument()
    expect(parseProgramNotes(other).map((section) => section.title)).toEqual(['Weekly schedule'])
  })
})
