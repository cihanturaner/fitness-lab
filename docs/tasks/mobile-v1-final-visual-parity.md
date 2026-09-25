# Mobile V1 — final visual parity (task ledger)

Branch `claude/mobile-v1-final-visual-parity`, started from `claude/sweet-mendel-xic1f2` @
`11c1e09` (Mobile V1 RC). Visual/product polish only: no domain, data, program or routing
change. Durable context for this task; not a spec.

## Inputs inspected

- Canonical references (3 attached screenshots of a third-party app: Home/Lifting ×3 states,
  Nutrition ×2, Profile). Used for composition, density and proportions only — no brand,
  palette, artwork, avatar, social or fake stats copied.
- Current physical-iPhone screenshots (Training week 1, Thu 1 Oct Upper B, 2 shots).
- Browser renders of the RC (`11c1e09`) at 430×932 and 375×667, every state listed under
  "Visual QA" (Metro web + Playwright Chromium, fixed clock, scratch browser storage).

## Before-gap audit (RC vs reference, 430-pt phone)

| # | Item | Reference | RC (before) |
| --- | --- | --- | --- |
| 1 | Top header | one 44-pt row: identity left, two small factual badges right | 23-pt date title + separate week line, 52 pt |
| 2 | Primary title | ~18 pt semibold, not a heading | 23 pt bold heading |
| 3 | Date strip | ~40 pt, plain numbers, filled pill for today | ~40 pt pill + 5-pt mark (close) |
| 4 | Strip → hero | ~14 pt | ~12 pt (close) |
| 5 | Hero width | full width minus ~16-pt gutter | 20-pt gutter (close) |
| 6 | Hero height | ~62 % of first screen, mostly figure | similar height but ~40 % of it is metadata/space |
| 7 | Hero padding | ~20 pt | 20 pt |
| 8 | Title hierarchy | one capitals name, nothing competing | name + filled status pill + meta + sets line |
| 9 | Anatomy height | ~250 pt | ~230 pt |
| 10 | Anatomy width | the pair spans ~75 % of the card | ~45 % (narrow, skinny figures) |
| 11 | Front/back spacing | figures almost touching (~12 pt) | 20 pt + narrow figures → wide gaps |
| 12 | Anatomy position | visual centre of the card | centre, but floats in white |
| 13 | Focus labels | chips / quiet text under the figure | quiet line (ok) |
| 14 | CTA height | ~50 pt | 50 pt |
| 15 | CTA to card bottom | ~20 pt | 20 pt |
| 16 | Hero → next section | ~24 pt | ~26 pt |
| 17 | Progress cards | two compact cards reach the first screen | four taller cards; macros card dense |
| 18 | Training week nav | n/a; in RC a heavy white pill with 44-pt filled buttons | dominates |
| 19 | Day selector | light numbers, one filled pill | 62-pt capsules + weekday letters (heavy) |
| 20 | Sessions list | n/a (reference lists are light rows) | card rows with filled date tiles |
| 21 | Bottom nav height | ~62 pt | 68 pt |
| 22 | Selected tab | soft rounded capsule | same |
| 23 | Plus button | ≈ bar height circle | 68 pt circle |
| 24 | Bottom safe-area offset | bar sits on the home-indicator band | same |
| 25 | Typography | small titles, big numbers, heavy only for the workout | many 20–23-pt bold headings |
| 26 | Whitespace rhythm | dense top, generous figure | empty space around a small figure |

Anatomy: the RC figure reads as a segmented diagram — narrow shoulders, white 1.3-pt
dividers between every plate, flat trunk.

## Intended changes

1. Anatomy: redraw the original artwork with athletic proportions (broad deltoids, V-taper,
   narrower waist, fuller limbs), soft tone-on-tone plate edges instead of white dividers,
   figures closer together; size driven by the card width.
2. Home: compact header row (date + factual week badge + gear); hero = name, quiet status,
   one meta line, large figure, focus, CTA; progress/up-next only once a session has sets.
3. Training: compact header, light week navigator, lighter day selector, hero shared with
   Home, lighter Sessions rows, quiet rest/pre-block lines.
4. Shared: tab bar 64 pt, plus button 64 pt; StatCard density.
5. Empty states: composed cards (icon, title, one line, CTA where one exists).

## Checkpoints / commits

(filled in as work lands)

## Visual QA

(filled in at the end)

## Physical iPhone — left for the user

(filled in at the end)
