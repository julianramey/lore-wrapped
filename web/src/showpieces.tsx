// The top of the report: the reveal, then the pictures of your history. Each one is a
// single idea drawn properly; the bulk tables live further down.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { Example, Report } from '../../src/report-types.ts'
import { api, type Ranks } from './api.ts'
import { Mark } from './brand.tsx'
import { availableCards, CARD_LABELS, cardImage, multiple, signature } from './cards.ts'
import { HeatLegend, heatScale, useTip } from './charts.tsx'
import { deckCardEl } from './deckcard.ts'
import { ACCEPTED, payEstimate, SHARE, TASK_PRICE } from '../../src/pipeline/payout.ts'
import { monthlyReminder } from './reminder.ts'
import { Versus } from './versus.tsx'
import { animateFigure, figure } from './icons/render.ts'
import { PALETTES } from './palettes.ts'
import { SOURCES, sourceLabel, type SourceName } from '../../src/sources/registry.ts'
import { prettyModel } from '../../src/pipeline/modelName.ts'
import { Quote, useEvidence } from './evidence.tsx'
import { big, fmtDate, fmtMonth, money, n, pct, plural, shortMonth, SOURCE_LABEL, sourceVar, WEEKDAYS } from './format.ts'

/** How close a twin is, in words: the similarity behind it is a reading of reputations, not a calibrated score. */
const fit = (match: number) => (match >= 80 ? 'close match' : match >= 55 ? 'good match' : 'loose match')

type Share = (card?: string) => void
const DAY = 86_400_000
const noon = (k: string) => new Date(`${k}T12:00:00`).getTime()
const dk = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ───────────────────────── 00 the reveal

const seenKey = (r: Report) => `lore.revealed.${r.generatedAt}`
function seen(r: Report) {
  try {
    return localStorage.getItem(seenKey(r)) === '1'
  } catch {
    return false
  }
}

export function Reveal({ r, onShare }: { r: Report; onShare: Share }) {
  const a = r.archetype
  const front = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(() => seen(r))
  const [instant] = useState(() => seen(r))
  useEffect(() => {
    if (!front.current) return
    const sig = signature(r)
    front.current.replaceChildren(deckCardEl({ key: a.key, numeral: a.numeral, name: a.name, tagline: a.tagline, code: a.codeLegend, callout: [sig.label, sig.value] }))
  }, [r])
  const flip = () => {
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    setOpen(true)
    try {
      localStorage.setItem(seenKey(r), '1')
    } catch {
      /* per-viewer nicety only */
    }
  }
  const others = a.matches.filter((m) => m.key !== a.key && m.score > 0).slice(0, 2)
  return (
    <section class={`band reveal-band ${open ? 'open' : ''} ${instant ? 'instant' : ''}`} style={{ '--card-accent': (PALETTES[a.key] || PALETTES.editor).accent } as any}>
      <div class="rv-grid">
        <div class="rv-stage">
          <button class="rv-flip" onClick={flip} aria-label={open ? a.name : 'Reveal your card'} disabled={open}>
            <span class="rv-inner">
              <span class="rv-face rv-back">
                <span class="rv-back-top">
                  <span>the lore deck</span>
                  <span>№ ?</span>
                </span>
                <span class="rv-back-mark">
                  <Mark size={120} />
                </span>
                <span class="rv-back-hint">{open ? '' : 'tap to turn it over'}</span>
              </span>
              <span class="rv-face rv-front" ref={front} />
            </span>
          </button>
        </div>
        <div class="rv-copy">
          <span class="label">
            <b>●</b> since {shortMonth(Math.min(...Object.values(r.coverage.firstUse).filter((x): x is number => x != null), r.coverage.from))} · {big(r.totals.prompts)} prompts on record · {plural(r.totals.threads, 'conversation')}
          </span>
          {!open ? (
            <div class="rv-wait">
              <h1>
                Your card is <em>ready.</em>
              </h1>
              <p class="dek">
                lore read {big(r.totals.prompts)} prompts across {n(r.totals.activeDays)} days and dealt you one card from a deck of fourteen. Turn it over.
              </p>
              <button class="btn primary" onClick={flip}>
                Reveal my card
              </button>
            </div>
          ) : (
            <div class="rv-said">
              <p class="rv-kicker">Your card is</p>
              <h1>{a.name}.</h1>
              <p class="rv-tag">{a.tagline}</p>
              {a.twin && (
                <a class="rv-twin-line" href="#twin">
                  <Figurine k={a.twin.key} size={44} />
                  <span>
                    works most like <b>{a.twin.name}</b>
                  </span>
                  <i>{fit(a.twin.match)} ↓</i>
                </a>
              )}
              <p class="rv-lore">{a.lore}</p>
              <div class="rv-code" aria-label={`Your code, ${a.code}`}>
                {a.codeLegend.map((l, i) => {
                  const sp = a.spectra[i]
                  return (
                    <div class="rv-letter">
                      <span class={`rv-chip ${i === 0 ? 'on' : ''}`}>{l.letter}</span>
                      <div class="rv-slider">
                        <div class="rv-sl-head">
                          <b>{l.word}</b>
                          <i>{l.axis.toLowerCase()}</i>
                        </div>
                        <Slider s={sp} />
                        <small>
                          {sp.metric} · {sp.typical}
                        </small>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div class="rv-tell">
                <div>
                  <b>the tell</b>
                  {a.signs}
                </div>
                <div>
                  <b>natural enemy</b>
                  {a.enemy}
                </div>
              </div>
              <div class="actions">
                <button class="btn primary" onClick={() => onShare('type')}>
                  Share your card
                </button>
                <a class="btn" href="#cards">
                  All your cards ↓
                </a>
              </div>
              <p class="note">
                Why this card: {a.measured}
                {others.length ? ` Also close: ${others.map((m) => `${m.name} (${m.score}%)`).join(', ')}.` : ''}
                {r.totals.prompts < 300 ? ` An early read from ${n(r.totals.prompts)} prompts: with this little history every trait is pulled toward typical, and your card firms up as you go.` : ''}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

/** A builder's figurine: still, or turning slowly while it's on screen. */
export function Figurine({ k, size, live }: { k: string; size: number; live?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1))
    if (live) return animateFigure(c, k, px)
    let alive = true
    figure(k, px, size < 100).then((img) => {
      if (!alive) return
      c.width = c.height = px
      c.getContext('2d')!.drawImage(img, 0, 0)
    })
    return () => {
      alive = false
    }
  }, [k, size, live])
  return <canvas ref={ref} class="figurine" style={{ width: `${size}px`, height: `${size}px` }} aria-hidden="true" />
}

// ───────────────────────── 01 your tech twin

export function TwinBand({ r }: { r: Report }) {
  const t = r.archetype.twin
  if (!t) return null
  return (
    <section class="band twin-band" id="twin" style={{ '--card-accent': (PALETTES[r.archetype.key] || PALETTES.editor).accent } as any}>
      <span class="label">
        <b>●</b> your tech twin
      </span>
      <div class="tw-grid">
        <div class="tw-stage">
          <Figurine k={t.key} size={340} live />
          <span class="tw-match">
            <b>{fit(t.match)}</b>
          </span>
        </div>
        <div class="tw-copy">
          <p class="rv-kicker">You work most like</p>
          <h2>{t.name}.</h2>
          <p class="tw-known">
            <span class="tw-by">By reputation:</span> {t.known}
          </p>
          {t.why && <p class="tw-why">{t.why}</p>}
          <div class="tw-axes">
            {t.axes.map((x) => (
              <div class="tw-axis">
                <span class={x.you < 0.5 ? 'on' : ''}>{x.left}</span>
                <span class="tw-track">
                  <i class="mid" />
                  <i class="them" style={{ left: `${x.them * 100}%` }} title={t.name} />
                  <i class="you" style={{ left: `${x.you * 100}%` }} title="you" />
                </span>
                <span class={x.you >= 0.5 ? 'on' : ''}>{x.right}</span>
              </div>
            ))}
            <div class="tw-key">
              <span>
                <i class="you" /> you
              </span>
              <span>
                <i class="them" /> {t.name.split(' ')[0]}
              </span>
            </div>
          </div>
          {t.also.length > 0 && (
            <div class="tw-also">
              <span class="rv-kicker">also close</span>
              {t.also.map((o) => (
                <span class="tw-alt">
                  <Figurine k={o.key} size={64} />
                  <b>{o.name}</b>
                  <i>{fit(o.match)}</i>
                </span>
              ))}
            </div>
          )}
          <p class="note">
            A playful read, not a measurement: your seven traits against our reading of each person’s public reputation, with sources in lore’s code. Not affiliated with, endorsed by, or measured from anyone shown. The figurines are toys inspired by a public look, not portraits.
          </p>
        </div>
      </div>
    </section>
  )
}

/** A spectrum as a bar: the two poles, typical in the middle, you as the dot. */
export function Slider({ s }: { s: Report['archetype']['spectra'][number] }) {
  return (
    <div class="slider" title={`${s.metric} (${s.typical}). ${Math.abs(s.z).toFixed(1)} standard deviations toward ${s.z >= 0 ? s.right : s.left}.`}>
      <span class={s.z < 0 ? 'pole on' : 'pole'}>{s.left}</span>
      <span class="track">
        <i class="mid" />
        <i class="fill" style={{ left: `${Math.min(50, s.value * 100)}%`, width: `${Math.abs(s.value - 0.5) * 100}%` }} />
        <i class="dot" style={{ left: `${s.value * 100}%` }} />
      </span>
      <span class={s.z >= 0 ? 'pole on' : 'pole'}>{s.right}</span>
    </div>
  )
}

// ───────────────────────── 02 the year

type Tool = 'all' | SourceName

const PIN_KEYS = new Set(['origin', 'ghost', 'latest', 'marathon', 'quiet', 'switch', 'second'])

/** A few words for a pin, from the lore entry's own title. */
function pinLabel(e: Report['lore'][number]): string {
  const kind = e.key.split('-')[0]
  if (kind === 'origin') return `${e.title.replace(/^How | started$/g, '')} begins`
  if (kind === 'ghost') return `last seen: ${e.title.replace('The last thing you said to ', '')}`
  if (kind === 'switch') return `→ ${e.title.split(' takes over')[0]}`
  if (kind === 'latest') return e.title.split(',')[0]
  if (kind === 'marathon') return e.title.replace(' without a break', ' straight')
  if (kind === 'quiet') return `${e.title.split(' ')[0]} days quiet`
  if (kind === 'second') return e.title.split(',')[0]
  return e.kicker.toLowerCase()
}

export function YearBand({ r }: { r: Report }) {
  const tip = useTip()
  const open = useEvidence()
  const [tool, setTool] = useState<Tool>('all')
  const used = SOURCES.map((s, i) => ({ ...s, i })).filter((s) => r.bySource.find((b) => b.source === s.key)?.prompts)
  const both = used.length > 1
  const days = useMemo(() => {
    const out: Record<string, number> = {}
    for (const [k, v] of Object.entries(r.calendarBySource)) out[k] = tool === 'all' ? v.reduce((a, b) => a + b, 0) : v[used.find((u) => u.key === tool)?.i ?? 0]
    return out
  }, [r, tool])
  const color = useMemo(() => heatScale(Object.values(r.calendar)), [r])
  const start = useMemo(() => {
    const d = new Date(r.coverage.from)
    d.setHours(12, 0, 0, 0)
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.getTime()
  }, [r])
  const weeks = Math.ceil((r.coverage.to - start) / (7 * DAY)) + 1
  const cell = 13
  const gap = 3
  const left = 30
  const top = 84
  const W = left + weeks * (cell + gap)
  const H = top + 7 * (cell + gap) + 4
  const col = (t: number) => Math.floor((t - start) / (7 * DAY))
  // pins: lore moments placed on the week they happened, staggered so labels don't collide
  const pins = useMemo(() => {
    const list = r.lore.filter((e) => PIN_KEYS.has(e.key.split('-')[0]) && e.at >= r.coverage.from - DAY).slice(0, 10)
    const placed: { x: number; row: number; e: (typeof list)[number] }[] = []
    for (const e of [...list].sort((a, b) => a.at - b.at)) {
      const x = left + col(e.at) * (cell + gap) + cell / 2
      let row = 0
      while (placed.some((p) => p.row === row && x - p.x < 150)) row++
      if (row < 3) placed.push({ x, row, e })
    }
    return placed
  }, [r, start])
  const monthTicks = useMemo(() => {
    const out: { x: number; label: string }[] = []
    let last = -1
    for (let w = 0; w < weeks; w++) {
      const d = new Date(start + w * 7 * DAY)
      if (d.getMonth() !== last) {
        out.push({ x: left + w * (cell + gap), label: d.toLocaleString('en-US', { month: 'short' }) + (d.getMonth() === 0 || !out.length ? ` ’${String(d.getFullYear()).slice(2)}` : '') })
        last = d.getMonth()
      }
    }
    return out
  }, [start, weeks])
  const quiet = r.lore.find((e) => e.key === 'quiet')
  return (
    <section class="band sp" id="year">
      <span class="label">
        <b>02</b> the year
      </span>
      <div class="sp-head">
        <h2>
          {n(r.totals.activeDays)} days with agents on record. <em>{r.streak.days} in a row, once.</em>
        </h2>
        <p>
          Every square is a day; the darker, the more you prompted. The pins are moments from your lore. Your biggest day was {fmtDate(r.busiestDay.date, { month: 'long', day: 'numeric' })}: {n(r.busiestDay.prompts)} prompts{r.busiestDay.projects[0] ? `, mostly ${r.busiestDay.projects[0]}` : ''}.
        </p>
      </div>
      {both && (
        <div class="seg" role="tablist" aria-label="Tool">
          {(['all', ...used.map((u) => u.key)] as Tool[]).map((t) => (
            <button class={tool === t ? 'on' : ''} onClick={() => setTool(t)} role="tab" aria-selected={tool === t}>
              {t === 'all' ? (used.length === 2 ? 'Both tools' : 'All tools') : sourceLabel(t)}
            </button>
          ))}
        </div>
      )}
      <div class="year-graph chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: `${Math.min(W, 820)}px` }} role="img" aria-label="Prompts per day across your history">
          {pins.map((p) => (
            <g class="pin" onClick={() => p.e.example && open(p.e.example.ref)}>
              <line x1={p.x} x2={p.x} y1={14 + p.row * 18} y2={top - 4} />
              <circle cx={p.x} cy={14 + p.row * 18} r={3.2} />
              <text x={p.x + 7} y={18 + p.row * 18}>
                <title>{`${p.e.title}: ${p.e.body}`}</title>
                {pinLabel(p.e)}
              </text>
            </g>
          ))}
          {monthTicks.map((m, i) => (i > 0 && m.x - monthTicks[i - 1].x < 30 ? null : <text class="axis" x={m.x} y={top - 8}>{m.label}</text>))}
          {[0, 2, 4].map((d) => (
            <text class="axis" x={0} y={top + d * (cell + gap) + cell - 2}>
              {WEEKDAYS[d]}
            </text>
          ))}
          {Array.from({ length: weeks * 7 }, (_, i) => {
            const t = start + i * DAY
            if (t > r.coverage.to + DAY / 2 || t < r.coverage.from - DAY) return null
            const key = dk(t)
            const v = days[key] || 0
            const split = r.calendarBySource[key]
            return (
              <rect
                x={left + Math.floor(i / 7) * (cell + gap)}
                y={top + (i % 7) * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                fill={v ? color(v) : 'var(--heat-0)'}
                onMouseEnter={(e) =>
                  tip.show(
                    e,
                    <>
                      <div class="t-title">{fmtDate(key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                      <div>{split ? `${n(split.reduce((a, b) => a + b, 0))} prompts${used.length > 1 ? ` · ${used.map((u) => `${u.label} ${n(split[u.i] || 0)}`).join(' · ')}` : ''}` : 'no prompts'}</div>
                    </>,
                  )
                }
                onMouseLeave={tip.hide}
              />
            )
          })}
        </svg>
      </div>
      <div class="chart-caption">
        <span>prompts per day, local time · tap a pin to read it</span>
        <HeatLegend />
      </div>
      {r.coverage.gap && (
        <p class="note">
          You’ve used Claude Code since {fmtDate(r.coverage.gap.from)} (first launched on this machine), but its prompts before {fmtDate(r.coverage.gap.to)} weren’t kept anywhere lore can read, so those weeks aren’t on the calendar.
        </p>
      )}
      <div class="sp-stats">
        <div>
          <b>{n(r.totals.activeDays)}</b>
          <span>active days of {n(r.totals.spanDays)}</span>
        </div>
        <div>
          <b>{r.streak.days}</b>
          <span>
            days in a row, {fmtDate(r.streak.from, { month: 'short', day: 'numeric' })} – {fmtDate(r.streak.to, { month: 'short', day: 'numeric' })}
          </span>
        </div>
        <div>
          <b>{n(r.busiestDay.prompts)}</b>
          <span>prompts on your biggest day</span>
        </div>
        {quiet && (
          <div>
            <b>{quiet.title.split(' ')[0]}</b>
            <span>days, your longest break</span>
          </div>
        )}
      </div>
      <Retention r={r} />
      {tip.node}
    </section>
  )
}

/** Claude Code deletes transcripts after 30 days; say what lore recovered, and offer to stop it. */
function Retention({ r }: { r: Report }) {
  const ret = r.deep.retention
  const c = r.coverage.sources.find((s) => s.source === 'claude-code')
  const [state, setState] = useState<'idle' | 'busy' | 'done' | string>(ret?.configured ? 'done' : 'idle')
  if (!ret || !c?.found) return null
  if (ret.configured && state !== 'done') return null
  const keep = async () => {
    setState('busy')
    try {
      await api.keepHistory()
      setState('done')
    } catch (e: any) {
      setState(e.message || String(e))
    }
  }
  return (
    <div class="retention">
      <div>
        <b>Claude Code deletes transcripts after {ret.retentionDays} days.</b>{' '}
        {c.recoveredThreads
          ? `lore rebuilt ${n(c.recoveredThreads)} deleted sessions (${n(c.recoveredPrompts || 0)} prompts) from Claude’s prompt history, which it never cleans up. Their replies, tools and diffs are gone; their tokens still count, from Claude’s own stats.`
          : 'Older sessions are gone from disk.'}
      </div>
      {state === 'done' ? (
        <span class="ret-done">✓ keeping a year from now on</span>
      ) : (
        <button class="btn small" onClick={keep} disabled={state === 'busy'} title="Sets cleanupPeriodDays to 365 in ~/.claude/settings.json; everything else in that file stays.">
          {state === 'busy' ? 'Saving…' : 'Keep a year from now on'}
        </button>
      )}
      {state !== 'idle' && state !== 'busy' && state !== 'done' && <span class="ret-err">{state}</span>}
    </div>
  )
}

// ───────────────────────── the records

export function RecordsBand({ r }: { r: Report }) {
  const open = useEvidence()
  const rec = r.records
  const w = r.deep.work
  const hm = (min: number) => `${Math.floor(min / 60)}h ${String(Math.round(min % 60)).padStart(2, '0')}m`
  const latest = r.lore.find((e) => e.key === 'latest')
  const file = w.topFiles[0]
  const proj = r.projects[0]
  const thread = r.deepest[0]
  const x = r.extras
  const tiles: { v: string; k: string; d: string; ex?: Example; wide?: boolean }[] = [
    { v: `${r.streak.days} days`, k: 'longest streak', d: `${fmtDate(r.streak.from, { month: 'short', day: 'numeric', year: 'numeric' })} – ${fmtDate(r.streak.to, { month: 'short', day: 'numeric' })}, not a day off` },
    ...(rec.longestSession ? [{ v: hm(rec.longestSession.minutes), k: 'longest session', d: `${n(rec.longestSession.prompts)} prompts on ${fmtDate(rec.longestSession.from, { month: 'short', day: 'numeric', year: 'numeric' })}, never 45 minutes apart, mostly ${rec.longestSession.project}`, ex: rec.longestSession.example }] : []),
    { v: `${n(rec.sessionHours)}h`, k: 'at it, in sessions', d: `across ${n(rec.sessions)} sessions; a gap over 45 minutes ends one, so idle time isn’t counted` },
    ...(w.timedTurns ? [{ v: `${n(w.agentHours)}h`, k: 'agents worked on their own', d: 'from the harness’s own turn timings, on record' }] : []),
    ...(w.longestTurn ? [{ v: `${(w.longestTurn.min / 60).toFixed(1)}h`, k: 'longest solo run', d: `one prompt, then an agent worked alone, in ${w.longestTurn.project}` }] : []),
    { v: n(r.busiestDay.prompts), k: 'prompts in one day', d: `${fmtDate(r.busiestDay.date, { month: 'long', day: 'numeric', year: 'numeric' })}${r.busiestDay.projects[0] ? `, mostly ${r.busiestDay.projects[0]}` : ''}` },
    ...(proj ? [{ v: proj.name, k: 'favorite project', d: `${n(proj.prompts)} prompts over ${n(proj.activeDays)} days`, ex: proj.firstAsk }] : []),
    ...(file ? [{ v: file.file.split(/[\\/]/).pop() || file.file, k: 'most-edited file', d: `changed in ${n(file.turns)} separate agent turns, in ${file.project}` }] : []),
    ...(thread ? [{ v: `${n(thread.prompts)}`, k: 'prompts in one conversation', d: `“${thread.title || thread.project}”, over ${thread.days} days` }] : []),
    ...(latest ? [{ v: latest.title.split(',')[0], k: 'latest night', d: latest.body, ex: latest.example }] : []),
    ...(x?.priciest ? [{ v: money(x.priciest.usd), k: 'your most expensive prompt', d: `${plural(x.priciest.words, 'word')}${x.priciest.model ? ` to ${prettyModel(x.priciest.model)}` : ''}, priced at API rates`, ex: x.priciest.example }] : []),
    ...(x?.bestValue ? [{ v: `${n(x.bestValue.lines)} lines`, k: 'your best-value prompt', d: `from ${plural(x.bestValue.words, 'word')}: “${x.bestValue.example.text}”`, ex: x.bestValue.example }] : []),
    ...(x?.parallel ? [{ v: String(x.parallel.peak), k: 'agents at once', d: `turns running at the same moment, ${fmtDate(x.parallel.at, { month: 'short', day: 'numeric', year: 'numeric' })}` }] : []),
  ]
  const rb = rec.rockBottom
  return (
    <section class="band sp" id="records">
      <span class="label">
        <b>03</b> the records
      </span>
      <div class="sp-head">
        <h2>
          Personal bests. <em>And one personal worst.</em>
        </h2>
        <p>Counted {r.bySource.filter((s) => s.prompts > 0).length > 1 ? 'across every agent ' : ''}from every prompt on record. Anything with a quote opens where it happened.</p>
      </div>
      <div class="records">
        {rb && (
          <div class="rec rock">
            <span class="rec-k">rock bottom</span>
            <span class="rec-v">{fmtDate(rb.date, { month: 'long', day: 'numeric', year: 'numeric' })}</span>
            <span class="rec-d">
              {plural(rb.swears, 'prompt')} with a swear, {n(rb.caps)} in all caps, {plural(rb.steers, 'redirect')}, out of {n(rb.prompts)} that day.
            </span>
            {rb.example && (
              <button class="rec-q" onClick={() => open(rb.example!.ref)}>
                “{rb.example.text}” <i>in context →</i>
              </button>
            )}
          </div>
        )}
        {tiles.map((t) => (
          <div class="rec">
            <span class="rec-k">{t.k}</span>
            <span class="rec-v">{t.v}</span>
            <span class="rec-d">{t.d}</span>
            {t.ex && (
              <button class="rec-link" onClick={() => open(t.ex!.ref)}>
                in context →
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

// ───────────────────────── 03 the branches

/** Categorical slots in fixed order (validated palette); lanes are also labeled by name. */
const LANES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948']

export function BranchesBand({ r }: { r: Report }) {
  const tip = useTip()
  const open = useEvidence()
  const projects = r.projects.filter((p) => p.prompts >= 20).slice(0, 8)
  if (projects.length < 2) return null
  const from = r.coverage.from
  const to = r.coverage.to
  const L = 150
  const R = 1000
  const x = (t: number) => L + ((t - from) / Math.max(DAY, to - from)) * (R - L - 70)
  const lane = (i: number) => 74 + i * 46
  const H = lane(projects.length - 1) + 40
  const maxWeek = Math.max(1, ...projects.flatMap((p) => Object.values(p.weeks)))
  const months: { x: number; label: string }[] = []
  for (let d = new Date(from); d.getTime() <= to; d.setMonth(d.getMonth() + 1)) {
    const m = new Date(d.getFullYear(), d.getMonth(), 1).getTime()
    if (m >= from) months.push({ x: x(m), label: new Date(m).toLocaleString('en-US', { month: 'short' }) })
  }
  const dormant = (p: (typeof projects)[number]) => to - p.last > 21 * DAY
  return (
    <section class="band sp" id="branches">
      <span class="label">
        <b>04</b> the branches
      </span>
      <div class="sp-head">
        <h2>
          {projects.length} projects branched off you. <em>{projects.filter((p) => !dormant(p)).length} are still open.</em>
        </h2>
        <p>Each line is a project, from its first prompt to its last. Dots are weeks you worked on it, sized by prompts. Hover a name for how it started.</p>
      </div>
      <div class="branch-graph chart-scroll">
        <svg viewBox={`0 0 ${R} ${H}`} style={{ minWidth: '760px' }} role="img" aria-label="Projects over time, drawn as branches">
          {months.map((m) => (
            <g class="tick">
              <line x1={m.x} x2={m.x} y1={30} y2={H - 10} />
              <text x={m.x + 4} y={22}>
                {m.label}
              </text>
            </g>
          ))}
          <line class="trunk" x1={x(from)} x2={x(to)} y1={44} y2={44} />
          <circle class="trunk-dot" cx={x(to)} cy={44} r={5} />
          <text class="trunk-label" x={L - 12} y={48} text-anchor="end">
            you
          </text>
          {projects.map((p, i) => {
            const c = LANES[i]
            const y = lane(i)
            const x0 = x(p.first)
            const x1 = Math.max(x0 + 8, x(p.last))
            return (
              <g style={{ '--lane': c } as any}>
                <path class="branch" d={`M${Math.max(x(from), x0 - 18)},44 C${Math.max(x(from) + 10, x0 - 4)},44 ${x0 - 10},${y} ${x0 + 6},${y} L${x1},${y}`} />
                <text
                  class="lane-name"
                  x={L - 12}
                  y={y + 4}
                  text-anchor="end"
                  onMouseEnter={(e) =>
                    p.firstAsk &&
                    tip.show(
                      e,
                      <>
                        <div class="t-title">
                          {p.name} · first prompt, {fmtDate(p.first)}
                        </div>
                        <div>“{p.firstAsk.text}”</div>
                      </>,
                    )
                  }
                  onMouseLeave={tip.hide}
                  onClick={() => p.firstAsk && open(p.firstAsk.ref)}
                >
                  {p.name}
                </text>
                {Object.entries(p.weeks).map(([w, cnt]) => (
                  <circle
                    class="commit"
                    cx={Math.min(x1, Math.max(x0, x(noon(w) + 3 * DAY)))}
                    cy={y}
                    r={2.2 + Math.sqrt(cnt / maxWeek) * 8}
                    onMouseEnter={(e) =>
                      tip.show(
                        e,
                        <>
                          <div class="t-title">
                            {p.name} · week of {fmtDate(w, { month: 'short', day: 'numeric' })}
                          </div>
                          <div>{plural(cnt, 'prompt')}</div>
                        </>,
                      )
                    }
                    onMouseLeave={tip.hide}
                  />
                ))}
                {dormant(p) ? (
                  <g
                    class="end"
                    onMouseEnter={(e) =>
                      p.lastWords &&
                      tip.show(
                        e,
                        <>
                          <div class="t-title">last words to {p.name}</div>
                          <div>“{p.lastWords.text}”</div>
                        </>,
                      )
                    }
                    onMouseLeave={tip.hide}
                    onClick={() => p.lastWords && open(p.lastWords.ref)}
                  >
                    <rect x={x1 + 8} y={y - 4} width={8} height={8} rx={1.5} />
                    <text x={x1 + 22} y={y + 4}>
                      {fmtDate(p.last, { month: 'short', day: 'numeric' })}
                    </text>
                  </g>
                ) : (
                  <g class="head">
                    <rect x={x1 + 8} y={y - 9} width={42} height={18} rx={9} />
                    <text x={x1 + 29} y={y + 4} text-anchor="middle">
                      HEAD
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>
      <div class="chart-caption">
        <span>top projects by prompts · ■ dormant 3+ weeks (hover for your last words) · HEAD still active</span>
      </div>
      {tip.node}
    </section>
  )
}

// ───────────────────────── your models

export function ModelsBand({ r }: { r: Report }) {
  const ms = r.favoriteModels
  if (!ms.length) return null
  const top = ms[0]
  const podium = [ms[1], ms[0], ms[2]].filter(Boolean)
  const rest = ms.slice(3)
  const color = (m: (typeof ms)[number]) => sourceVar(m.source)
  const span = (m: (typeof ms)[number]) => (m.first ? `${fmtDate(m.first, { month: 'short', year: 'numeric' })}${fmtDate(m.first, { month: 'short', year: 'numeric' }) !== fmtDate(m.last, { month: 'short', year: 'numeric' }) ? ` – ${fmtDate(m.last, { month: 'short', year: 'numeric' })}` : ''}` : 'before Claude kept daily stats')
  const facts: [string, string][] = [
    [top.usd != null ? money(top.usd) : 'n/a', 'API-equivalent'],
    [top.prompts ? n(top.prompts) : '—', 'prompts it answered*'],
    [top.agentHours >= 1 ? `${n(top.agentHours)}h` : '—', 'working on its own*'],
    [top.linesAdded ? `+${big(top.linesAdded)}` : '—', 'lines it wrote*'],
    [top.steerRate != null ? pct(top.steerRate) : '—', 'of follow-ups redirected it*'],
    [top.topProject || '—', 'where you used it most*'],
  ]
  return (
    <section class="band sp" id="models">
      <span class="label">
        <b>05</b> your models
      </span>
      <div class="sp-head">
        <h2>
          {top.label} did the most work for you. <em>{pct(top.share)} of every token.</em>
        </h2>
        <p>
          Ranked by tokens processed, the one measure complete for every tool. {r.bySource.find((s) => s.source === 'claude-code')?.prompts ? 'Dates come from Claude’s daily stats and the transcripts on disk; starred' : 'Starred'} numbers come from transcripts alone
          {r.deep.retention?.transcriptSince ? `, which for Claude Code start ${fmtDate(r.deep.retention.transcriptSince)}` : ''}.
        </p>
      </div>
      <div class="podium">
        {podium.map((m) => {
          const place = ms.indexOf(m) + 1
          return (
            <div class={`pod p${place}`} style={{ '--m': color(m) } as any}>
              <div class="pod-card">
                <span class="pod-src">
                  <i />
                  {SOURCE_LABEL[m.source]}
                </span>
                <span class="pod-name">{m.label}</span>
                <span class="pod-share">{pct(m.share)}</span>
                <span class="pod-meta">
                  {big(m.tokens)} tokens{m.usd != null ? ` · ${money(m.usd)}` : ''}
                </span>
                <span class="pod-meta">{span(m)}</span>
              </div>
              <div class="pod-block">
                <b>{place}</b>
              </div>
            </div>
          )
        })}
      </div>
      <div class="pod-facts">
        <span class="pod-facts-k">{top.label}, up close</span>
        {facts.map(([v, k]) => (
          <div>
            <b>{v}</b>
            <span>{k}</span>
          </div>
        ))}
      </div>
      {rest.length > 0 && (
        <ol class="runners" start={4}>
          {rest.map((m, i) => (
            <li style={{ '--m': color(m) } as any}>
              <span class="rn">{i + 4}</span>
              <div class="rb">
                <div class="rt">
                  <b>{m.label}</b>
                  <span>{pct(m.share)}</span>
                </div>
                <span class="rbar">
                  <i style={{ width: `${(m.share / top.share) * 100}%` }} />
                </span>
                <span class="rmeta">
                  {big(m.tokens)} tokens{m.usd != null ? ` · ${money(m.usd)}` : ''} · {span(m)}
                  {m.steerRate != null ? ` · redirected ${pct(m.steerRate)}*` : ''}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// ───────────────────────── 04 the bill

const mondayOf = (key: string) => {
  const d = new Date(`${key}T12:00:00`)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return dk(d.getTime())
}

/**
 * Weekly prompts (complete on record) or weekly API-equivalent spend. Claude only recorded
 * daily tokens from a point on; its spend before then is spread across weeks by your Claude
 * prompts and drawn hatched, as an estimate.
 */
function WeekChart({ r }: { r: Report }) {
  const tip = useTip()
  const [mode, setMode] = useState<'spend' | 'prompts'>('spend')
  const sp = r.spend
  // the tools in this history, in the registry's fixed order
  const tools = SOURCES.map((s, i) => ({ ...s, i })).filter((s) => r.bySource.find((b) => b.source === s.key)?.prompts)
  const weeks = useMemo(() => {
    const by = new Map<string, { usd: number[]; prompts: number[]; est: number }>()
    const get = (k: string) => by.get(k) || (by.set(k, { usd: SOURCES.map(() => 0), prompts: SOURCES.map(() => 0), est: 0 }), by.get(k)!)
    for (const [day, counts] of Object.entries(r.calendarBySource)) {
      const w = get(mondayOf(day))
      counts.forEach((c, i) => (w.prompts[i] += c))
    }
    for (const w of sp.weekly) {
      const g = get(w.week)
      w.by.forEach((u, i) => (g.usd[i] += u))
      g.est += w.est || 0
    }
    // spread the undated Claude spend over weeks before daily stats began, by Claude prompts
    // only between when Claude's stats begin and when its daily counts do
    const from = sp.claudeDailyFrom
    const start = sp.claudeStatsFrom ? mondayOf(sp.claudeStatsFrom) : ''
    if (from && sp.claudeUndatedUsd > 0) {
      const claudeAt = (w: { prompts: number[] }) => w.prompts[0]
      const before = [...by.entries()].filter(([k, w]) => k >= start && k < mondayOf(from) && claudeAt(w) > 0)
      const total = before.reduce((a, [, w]) => a + claudeAt(w), 0)
      for (const [, w] of before) w.est += (sp.claudeUndatedUsd * claudeAt(w)) / total
    }
    return [...by.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, w]) => ({ week, ...w }))
  }, [r])
  // stacked bottom-up: the last tool lowest, Claude on top of the tools, its estimate above it
  const val = (w: (typeof weeks)[number]) => [...[...tools].reverse().map((t) => (mode === 'spend' ? w.usd[t.i] : w.prompts[t.i])), mode === 'spend' ? w.est : 0]
  const max = Math.max(1, ...weeks.map((w) => val(w).reduce((a, b) => a + b, 0)))
  const BW = 640
  const BH = 220
  const bw = BW / Math.max(1, weeks.length)
  const fmtV = (v: number) => (mode === 'spend' ? money(v).replace(/\.\d+$/, '') : n(v))
  return (
    <>
      <div class="wk-head">
        <h3>Per week</h3>
        <div class="seg small" role="tablist">
          <button class={mode === 'spend' ? 'on' : ''} onClick={() => setMode('spend')}>
            API-equivalent
          </button>
          <button class={mode === 'prompts' ? 'on' : ''} onClick={() => setMode('prompts')}>
            Prompts
          </button>
        </div>
      </div>
      <div class="legend">
        {tools.map((t) => (
          <span>
            <i class="sw" style={{ background: sourceVar(t.key) }} />
            {t.label}
          </span>
        ))}
        {mode === 'spend' && sp.claudeEstUsd > 0 && (
          <span>
            <i class="sw est" />
            Claude, estimated
          </span>
        )}
      </div>
      <svg class="week-bars" viewBox={`0 0 ${BW + 44} ${BH + 26}`} role="img" aria-label={mode === 'spend' ? 'API-equivalent spend per week' : 'Prompts per week'}>
        <defs>
          <pattern id="est-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" fill="var(--heat-1)" />
            <line x1="0" y1="0" x2="0" y2="5" stroke="var(--claude)" stroke-width="2" />
          </pattern>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g>
            <line x1={44} x2={BW + 44} y1={BH - f * BH} y2={BH - f * BH} />
            <text x={38} y={BH - f * BH + 4} text-anchor="end">
              {fmtV(max * f)}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const vals = val(w)
          const xx = 44 + i * bw + 0.5
          const ww = Math.max(1.2, bw - 1.5)
          let y = BH
          const seg = (v: number, fill: string) => {
            if (v <= 0) return null
            const h = (v / max) * BH
            y -= h
            return <rect x={xx} y={y} width={ww} height={Math.max(0.5, h - 0.6)} rx={Math.min(1.5, ww / 2)} fill={fill} />
          }
          return (
            <g
              onMouseEnter={(e) =>
                tip.show(
                  e,
                  <>
                    <div class="t-title">week of {fmtDate(w.week, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                    <div>
                      {tools
                        .map((t) => (mode === 'spend' ? `${t.label} ${money(w.usd[t.i])}${t.i === 0 && w.est ? ` + about ${money(w.est)} estimated` : ''}` : `${t.label} ${n(w.prompts[t.i])} prompts`))
                        .join(' · ')}
                    </div>
                  </>,
                )
              }
              onMouseLeave={tip.hide}
            >
              <rect class="hit" x={xx} y={0} width={ww} height={BH} />
              {[...tools].reverse().map((t, k) => seg(vals[k], sourceVar(t.key)))}
              {seg(vals[tools.length], 'url(#est-hatch)')}
            </g>
          )
        })}
        <text x={44} y={BH + 20}>
          {fmtDate(weeks[0]?.week || '', { month: 'short', year: 'numeric' })}
        </text>
        <text x={BW + 44} y={BH + 20} text-anchor="end">
          {fmtDate(weeks[weeks.length - 1]?.week || '', { month: 'short', year: 'numeric' })}
        </text>
      </svg>
      <p class="note">
        {mode === 'spend'
          ? sp.claudeEstUsd > 0
            ? `Hatched: Claude estimates. ${sp.claudeExactFrom ? `Before ${fmtDate(sp.claudeExactFrom)} Claude Code had deleted the transcripts, so those weeks come` : 'Claude Code had deleted every transcript, so all its weeks come'} from its own daily stats, scaled down to one count per reply.${sp.claudeUndatedUsd > 0 && sp.claudeDailyFrom ? ` It kept no daily stats before ${fmtDate(sp.claudeDailyFrom)}, so that ${money(sp.claudeUndatedUsd)} is spread by your Claude prompts.` : ''} Newer models cost more per token, which is part of why recent weeks tower.`
            : 'Each week priced at list API rates.'
          : `Every prompt on record.${r.coverage.gap ? ` Claude Code’s prompts before ${fmtDate(r.coverage.gap.to)} weren’t kept.` : ''}`}
      </p>
      {tip.node}
    </>
  )
}

/** Why Claude Code's own number is bigger: the same replies, counted once per record. */
function Recount({ c }: { c: { counted: number; processed: number } }) {
  const x = c.counted / c.processed
  return (
    <div class="recount">
      <h3>Why Claude Code shows more</h3>
      <div class="rc-row">
        <span class="rc-k">Claude Code’s counter</span>
        <span class="rc-bar">
          <i class="rc-dup" style={{ width: '100%' }} />
        </span>
        <b>{big(c.counted)}</b>
      </div>
      <div class="rc-row">
        <span class="rc-k">each reply once</span>
        <span class="rc-bar">
          <i style={{ width: `${(100 / x).toFixed(1)}%` }} />
        </span>
        <b>{big(c.processed)}</b>
      </div>
      <p class="note">
        Claude Code saves a reply as one record per block (its thinking, its text, each tool call), each carrying the reply’s full token count, and its counter adds every one. The API bills a reply once, so lore counts it once: Claude Code’s figure runs {x.toFixed(1)}× high.
      </p>
    </div>
  )
}

/** Whole dollars to two significant figures, the way people guess: $3,700, $40,000. */
const roughUsd = (x: number) => {
  const p = Math.pow(10, Math.max(0, Math.floor(Math.log10(x)) - 1))
  return Math.round(x / p) * p
}
const GUESS_MIN = 10
const GUESS_MAX = 250_000
const toGuess = (v: number) => roughUsd(GUESS_MIN * Math.pow(GUESS_MAX / GUESS_MIN, v))
const fromGuess = (usd: number) => Math.log(Math.min(GUESS_MAX, Math.max(GUESS_MIN, usd)) / GUESS_MIN) / Math.log(GUESS_MAX / GUESS_MIN)

/** How a guess compares with the real bill, in one plain line. */
function guessVerdict(guess: number, actual: number): string {
  const r = actual / guess
  const x = (k: number) => (k >= 10 ? Math.round(k).toString() : k.toFixed(1))
  if (r >= 0.8 && r <= 1.25) return `You guessed $${n(guess)}. Within ${Math.max(1, Math.round(Math.abs(1 - r) * 100))}%: you know your agents.`
  return r > 1 ? `You guessed $${n(guess)}. It came to ${x(r)}× that.` : `You guessed $${n(guess)}. It came to ${x(1 / r)}× less.`
}

function BillGuess({ start, span, onDone }: { start: number; span: string; onDone: (g: number | null) => void }) {
  const [v, setV] = useState(() => fromGuess(start))
  const g = toGuess(v)
  return (
    <div class="guess">
      <h2>
        Before you look: <em>what did your agents cost?</em>
      </h2>
      <p>Everything you ran {span}, at each provider’s published API price. Drag to your guess.</p>
      <div class="guess-row">
        <input type="range" min={0} max={1000} value={Math.round(v * 1000)} onInput={(e) => setV(Number((e.target as HTMLInputElement).value) / 1000)} aria-label="Your guess, in dollars" aria-valuetext={`$${n(g)}`} />
        <output class="guess-val">${n(g)}</output>
      </div>
      <div class="guess-actions">
        <button class="btn primary" onClick={() => onDone(g)}>
          Show me the bill
        </button>
        <button class="btn ghost" onClick={() => onDone(null)}>
          Skip
        </button>
      </div>
    </div>
  )
}

export function BillBand({ r }: { r: Report }) {
  const sp = r.spend
  const gk = `lore.guess.${r.generatedAt}`
  // undefined: not asked yet · null: skipped · number: the guess
  const [guess, setGuess] = useState<number | null | undefined>(() => {
    try {
      const v = localStorage.getItem(gk)
      return v == null ? undefined : v === 'skip' ? null : Number(v)
    } catch {
      return null
    }
  })
  const answer = (g: number | null) => {
    setGuess(g)
    try {
      localStorage.setItem(gk, g == null ? 'skip' : String(g))
    } catch {
      /* per-viewer nicety only */
    }
  }
  if (!sp || sp.totalUsd < 1) return null
  const allPriced = sp.models.filter((m) => m.usd != null)
  const priced = allPriced.slice(0, 10)
  const rest = allPriced.slice(10)
  const unpriced = sp.models.filter((m) => m.usd == null)
  const usd = (x: number) => (x >= 10 ? `$${n(x)}` : `$${x.toFixed(2)}`)
  const paid = sp.plans.filter((p) => p.paidUsd)
  const lo = paid.reduce((s, p) => s + p.paidUsd![0], 0)
  const hi = paid.reduce((s, p) => s + p.paidUsd![1], 0)
  return (
    <section class="band sp" id="bill">
      <span class="label">
        <b>06</b> the bill
      </span>
      {guess === undefined ? (
        <div class="sp-head">
          <BillGuess start={paid.length ? (lo + hi) / 2 : 1000} span={`${fmtMonth(r.coverage.from)} to ${fmtMonth(r.coverage.to)}`} onDone={answer} />
          <p>
            {paid.length
              ? `For scale: your plans over the same months came to about ${lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`}.`
              : 'Every API reply counted once, subagents included, each model at its own list price.'}
          </p>
        </div>
      ) : (
      <div class="sp-head">
        <h2>
          {paid.length && sp.totalUsd > hi ? (
            <>
              {multiple(sp.totalUsd, lo, hi)} what you paid. <em>{money(sp.totalUsd)} of agents for about {lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`}.</em>
            </>
          ) : (
            <>
              {money(sp.totalUsd)} of agents, <em>{paid.length ? `for about ${lo === hi ? money(lo) : `${money(lo)}–${money(hi)}`}.` : 'at API prices.'}</em>
            </>
          )}
        </h2>
        <p>
          {typeof guess === 'number' && <b class="guess-verdict">{guessVerdict(guess, sp.totalUsd)} </b>}
          What your {big(sp.tokens)} tokens would have cost at each provider’s published API price, each model at its own list price: every API reply counted once, subagents included. Plans are counted over the same months. {pct(sp.cacheShare)} of the tokens were cached context the models re-read, which is why the bill isn’t ten times bigger.
        </p>
      </div>
      )}
      <div class={`bill-grid ${guess === undefined ? 'veiled' : ''}`} aria-hidden={guess === undefined}>
        <div class="receipt-paper" aria-label="Itemized API-equivalent cost">
          <div class="rp-head">
            <b>agents, itemized</b>
            <span>
              {fmtMonth(r.coverage.from)} — {fmtMonth(r.coverage.to)}
            </span>
          </div>
          {priced.map((m) => (
            <div class="rp-row" title={`${big(m.input)} in · ${big(m.cached)} cached · ${big(m.output)} out${m.write ? ` · ${big(m.write)} cache writes` : ''}${m.note ? `\n${m.note}` : ''}`}>
              <span>
                <i style={{ background: sourceVar(m.source) }} />
                {m.model}
                {m.note ? ' †' : ''}
              </span>
              <span class="rp-tok">
                {m.est > m.tokens / 2 ? '≈' : ''}
                {big(m.tokens)}
              </span>
              <span>{usd(m.usd!)}</span>
            </div>
          ))}
          {rest.length > 0 && (
            <div class="rp-row dim" title={rest.map((m) => `${m.model} ${usd(m.usd!)}`).join('\n')}>
              <span>{rest.length} smaller models</span>
              <span class="rp-tok">{big(rest.reduce((a, m) => a + m.tokens, 0))}</span>
              <span>{usd(rest.reduce((a, m) => a + (m.usd || 0), 0))}</span>
            </div>
          )}
          {unpriced.map((m) => (
            <div class="rp-row dim" title={m.note}>
              <span>
                <i style={{ background: 'var(--ink-4)' }} />
                {m.model}
              </span>
              <span class="rp-tok">{big(m.tokens)}</span>
              <span>n/a</span>
            </div>
          ))}
          <div class="rp-rule" />
          <div class="rp-row total">
            <span>API-equivalent</span>
            <span />
            <span>{usd(sp.totalUsd)}</span>
          </div>
          {sp.bySource
            .filter((s) => s.usd > 0)
            .map((s) => (
              <div class="rp-row sub">
                <span>{SOURCE_LABEL[s.source]}</span>
                <span class="rp-tok">{big(s.tokens)}</span>
                <span>{usd(s.usd)}</span>
              </div>
            ))}
          {paid.length > 0 && (
            <>
              <div class="rp-rule" />
              {paid.map((p) => (
                <div class="rp-row sub">
                  <span>
                    {p.label} × {p.months} mo
                  </span>
                  <span />
                  <span>{p.paidUsd![0] === p.paidUsd![1] ? usd(p.paidUsd![0]) : `${usd(p.paidUsd![0])}–${usd(p.paidUsd![1])}`}</span>
                </div>
              ))}
              <div class="rp-row absorbed">
                <span>your plans absorbed</span>
                <span />
                <span>{lo === hi ? usd(sp.totalUsd - lo) : `${usd(sp.totalUsd - hi)}+`}</span>
              </div>
            </>
          )}
          <div class="rp-foot">
            {sp.claudeStatsFrom && r.coverage.firstUse['claude-code'] != null && r.coverage.firstUse['claude-code']! < Date.parse(sp.claudeStatsFrom) - 7 * DAY && (
              <>
                Claude Code’s token stats begin {fmtDate(sp.claudeStatsFrom)}; earlier Claude usage wasn’t recorded, so it isn’t on this bill.
                <br />
              </>
            )}
            {sp.estTokens > 0 && (
              <>
                ≈ mostly estimated: {big(sp.estTokens)} Claude tokens come from Claude Code’s own stats, for days its transcripts were deleted.
                <br />
              </>
            )}
            {priced.some((m) => m.note) && (
              <>
                † {priced.find((m) => m.note)!.model}: {priced.find((m) => m.note)!.note}.
                <br />
              </>
            )}
            list prices as of {sp.asOf} ·{' '}
            <a href={sp.sources.anthropic} target="_blank" rel="noreferrer">
              Anthropic
            </a>{' '}
            ·{' '}
            <a href={sp.sources.openai} target="_blank" rel="noreferrer">
              OpenAI
            </a>
            {sp.bySource.find((b) => b.source === 'gemini' && b.tokens > 0) && (
              <>
                {' '}
                ·{' '}
                <a href={sp.sources.google} target="_blank" rel="noreferrer">
                  Google
                </a>
              </>
            )}{' '}
            · an estimate, not a bill
          </div>
        </div>
        <div class="bill-side">
          <WeekChart r={r} />
          {sp.claudeCounter && <Recount c={sp.claudeCounter} />}
          <h3 style={{ marginTop: '22px' }}>Where the tokens went</h3>
          <div class="token-split" aria-label="Token mix">
            <span style={{ flex: sp.cacheShare }} title="cached input re-read">
              cached {pct(sp.cacheShare)}
            </span>
            <span style={{ flex: 1 - sp.cacheShare }} title="new input and output" />
          </div>
          <p class="note">Cached input is billed at a tenth of the price or less, which is how a heavy month stays in the thousands instead of the tens of thousands.</p>
        </div>
      </div>
    </section>
  )
}

// ───────────────────────── 05 in your words

/** What the agents said back: their catchphrases, by model, and when they last said them. */
function SaidBack({ r, onShare }: { r: Report; onShare: Share }) {
  const e = r.extras
  const max = Math.max(...e.catchphrases.map((c) => c.count))
  const top = e.catchphrases[0]
  return (
    <div class="said">
      <div class="said-head">
        <h3>
          And what they said back. <em>“{top.label}”, {plural(top.count, 'time')}.</em>
        </h3>
        <p class="note">Counted once per reply across {n(e.replies)} agent replies, from the first lines of each.</p>
      </div>
      <div class="said-rows">
        {e.catchphrases.map((c) => {
          const models = Object.entries(c.byModel).filter(([m]) => m !== 'unknown').sort((a, b) => b[1] - a[1])
          return (
            <div class="said-row" title={models.map(([m, k]) => `${prettyModel(m)}: ${n(k)}`).join('\n')}>
              <span class="said-k">“{c.label}”</span>
              <span class="said-bar">
                <i style={{ width: `${(c.count / max) * 100}%` }} />
              </span>
              <b>{n(c.count)}</b>
              <span class="said-m">
                {models[0] ? `mostly ${prettyModel(models[0][0])} · ` : ''}last {fmtMonth(`${c.lastMonth}-15`)}
              </span>
            </div>
          )
        })}
      </div>
      {top.count >= 5 && (
        <button class="btn small" style={{ marginTop: '16px' }} onClick={() => onShare('said')}>
          Share what they said
        </button>
      )}
    </div>
  )
}

export function WordsBand({ r, onShare }: { r: Report; onShare: Share }) {
  const open = useEvidence()
  const qs = r.quotes.slice(0, 12)
  const s = r.deep.swear
  const top = s.words[0]
  const max = Math.max(1, ...s.words.map((w) => w.count))
  return (
    <section class="band sp" id="words">
      <span class="label">
        <b>07</b> in your words
      </span>
      <div class="sp-head">
        <h2>
          Your words, <em>counted.</em>
        </h2>
        <p>Three different things: the whole prompt you sent most often, word for word; the single word you used most (stopwords and project names left out); and the swear you reached for first.</p>
      </div>
      <div class="word-stats">
        {qs[0] && (
          <button class="ws" onClick={() => open(qs[0].example.ref)}>
            <span class="ws-k">most repeated prompt</span>
            <span class="ws-v">“{qs[0].text}”</span>
            <span class="ws-n">×{n(qs[0].count)}, word for word</span>
          </button>
        )}
        {r.topWords[0] && (
          <div class="ws">
            <span class="ws-k">most used word</span>
            <span class="ws-v">“{r.topWords[0].word}”</span>
            <span class="ws-n">×{n(r.topWords[0].count)}</span>
          </div>
        )}
        {top && (
          <div class="ws loud">
            <span class="ws-k">swear of choice</span>
            <span class="ws-v">“{top.word}”</span>
            <span class="ws-n">×{n(top.count)}</span>
          </div>
        )}
      </div>
      {r.topWords.length > 4 && (
        <>
          <div class="sub-h">the words you used most</div>
          <div class="word-cloud">
            {r.topWords.slice(0, 24).map((w) => (
              <span style={{ fontSize: `${13 + 22 * Math.sqrt(w.count / r.topWords[0].count)}px` }} title={`${n(w.count)} times`}>
                {w.word}
                <i>{big(w.count)}</i>
              </span>
            ))}
          </div>
        </>
      )}
      {qs.length > 1 && <div class="sub-h">prompts you sent word for word, again and again</div>}
      {qs.length > 1 && (
        <div class="quote-wall">
          {qs.slice(1).map((q, i) => (
            <button class={`qw ${i < 2 ? 'lg' : ''}`} onClick={() => open(q.example.ref)} title={`first ${fmtDate(q.first)} · last ${fmtDate(q.last)}`}>
              <span class="qw-text">“{q.text}”</span>
              <span class="qw-n">×{n(q.count)}</span>
              <span class="qw-meta">{plural(q.threads, 'conversation')}</span>
            </button>
          ))}
        </div>
      )}
      <div class="jar">
        <div>
          <div class="sub-h">the swear jar</div>
          {top ? (
            <>
              <p class="jar-big">
                You said <em>“{top.word}”</em> to an AI {n(top.count)} times.
              </p>
              <p class="lead" style={{ marginBottom: '20px' }}>
                {n(s.prompts)} prompts with a swear ({s.per100.toFixed(1)} per 100), {n(s.allCaps)} in ALL CAPS. {pct(s.inSteers / Math.max(1, s.prompts))} of them landed in a correction: the agents mostly earned it.
              </p>
              {s.words.slice(0, 6).map((w, i) => (
                <div class="word-row">
                  <span>{w.word}</span>
                  <span class={`bar ${i ? 'dim' : ''}`} style={{ width: `${(w.count / max) * 100}%`, animationDelay: `${i * 60}ms` }} />
                  <span class="n">{n(w.count)}</span>
                </div>
              ))}
              <div class="chips" style={{ marginTop: '16px' }}>
                {s.bySource.map((b) => (
                  <span class="chip">
                    {SOURCE_LABEL[b.source]}
                    <b>{b.per100.toFixed(1)}/100</b>
                  </span>
                ))}
                {s.worstDay && (
                  <span class="chip">
                    worst day · {fmtDate(s.worstDay.date)}
                    <b>{n(s.worstDay.count)}</b>
                  </span>
                )}
                {s.byProject.slice(0, 3).map((b) => (
                  <span class="chip">
                    {b.project}
                    <b>{b.per100.toFixed(1)}/100</b>
                  </span>
                ))}
              </div>
              <button class="btn small" style={{ marginTop: '20px' }} onClick={() => onShare('swear')}>
                Share the swear jar
              </button>
            </>
          ) : (
            <p class="jar-big">Not one swear in {n(r.totals.prompts)} prompts. Not even at Codex.</p>
          )}
        </div>
        <div class="quotes">
          {s.loudest && (
            <>
              <div class="sub-h" style={{ margin: '0 0 2px' }}>
                your loudest message
              </div>
              <Quote ex={s.loudest} loud />
            </>
          )}
          {s.first && (
            <>
              <div class="sub-h" style={{ margin: '14px 0 2px' }}>
                the first one {r.coverage.gap ? 'on record ' : ''}({fmtDate(s.first.at)})
              </div>
              <Quote ex={s.first} />
            </>
          )}
          <p class="note">{r.definitions.swear}</p>
        </div>
      </div>
      {r.extras?.catchphrases.length > 0 && <SaidBack r={r} onShare={onShare} />}
    </section>
  )
}

// ───────────────────────── 06 where you rank

const BENCH = { avg: 13, p90: 30, url: 'https://code.claude.com/docs/en/costs' }

export function RankBand({ r, toast }: { r: Report; toast: (m: string, err?: boolean) => void }) {
  const [ranks, setRanks] = useState<Ranks | null>(null)
  useEffect(() => {
    api
      .ranks()
      .then(setRanks)
      .catch(() => setRanks(null))
  }, [])
  const day = r.spend?.claudePerActiveDay ?? null

  const rows: [string, number, boolean][] = day == null ? [] : [
    ['Enterprise average', BENCH.avg, false],
    ['90% of enterprise devs stay under', BENCH.p90, false],
    ['You, on a median day', day, true],
  ]
  const max = Math.max(...rows.map((x) => x[1]), 1)
  const times = day != null ? day / BENCH.p90 : 0
  return (
    <section class="band sp" id="rank">
      <span class="label">
        <b>08</b> where you rank
      </span>
      <div class="sp-head">
        <h2>{day != null && times >= 1.5 ? <>Your median day: <em>{Math.round(times)}× what 90% of enterprise developers spend.</em></> : day != null ? 'Your day, next to Claude Code at work.' : 'Where you sit.'}</h2>
        <p>Only published numbers here. Anthropic reports what Claude Code costs developers at companies per active day; that’s a benchmark, not a ranking of everyone. Real ranks wait for the lore index, which places you once 25 runs have shared anonymous stats.</p>
      </div>
      {day != null && (
        <div class="bench">
          <div class="bench-head">Claude Code usage per active day, priced at API rates</div>
          {rows.map(([label, v, you]) => (
            <div class={`bench-row ${you ? 'you' : ''}`}>
              <span>{label}</span>
              <span class="bench-bar">
                <i style={{ width: `${Math.max(1.2, (v / max) * 100)}%` }} />
              </span>
              <b>{money(v).replace(/\.\d+$/, '')}</b>
            </div>
          ))}
          <p class="note">
            Anthropic’s figures are for enterprise deployments: about ${BENCH.avg} per developer per active day on average, and under ${BENCH.p90} for 90% of users (
            <a href={BENCH.url} target="_blank" rel="noreferrer">
              source
            </a>
            ). Yours prices your tokens the same way; on a subscription you paid a flat fee instead.
          </p>
        </div>
      )}
      <div class="sub-h">against other lore users</div>
      <div class="rank-rows">
        {(ranks?.rows || []).map((row) => (
          <div class={`rank-row ${row.top == null ? 'locked' : ''}`}>
            <span class="rr-label">{row.label}</span>
            <span class="rr-you">{row.key === 'api_usd' ? `$${big(row.value)}` : big(row.value)}</span>
            <span class="rr-top">{row.top == null ? 'rank unlocks at 25 runs' : row.top <= 0.01 ? 'top 1%' : `top ${Math.max(1, Math.round(row.top * 100))}%`}</span>
          </div>
        ))}
      </div>
      {ranks && !ranks.available && <p class="note">{ranks.runs ? `${n(ranks.runs)} runs in the index so far.` : 'No index connected yet.'} Your numbers are shown; a rank appears once there’s a real distribution to compare against.</p>}
      <Versus r={r} toast={toast} />
    </section>
  )
}

// ───────────────────────── the end: take it with you

/** Getting paid: a loose guess at what the work is worth, and the waitlist. Nothing leaves unless they submit. */
export function PaidBand({ r, toast }: { r: Report; toast: (m: string, err?: boolean) => void }) {
  const est = payEstimate(r.deep.tasks?.redGreen || 0)
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const join = async (e: Event) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api.joinWaitlist(email)
      setDone(true)
    } catch (err: any) {
      toast(err.message, true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section class="band sp paid-band" id="paid">
      <span class="label">
        <b>●</b> getting paid · being built
      </span>
      <div class="sp-head">
        <h2>
          {est ? (
            <>
              Your work might be worth <em>{money(est.low).replace(/\.\d+$/, '')}–{money(est.high).replace(/\.\d+$/, '')}.</em>
            </>
          ) : (
            <>
              Your next task could be worth <em>$200–$2,000.</em>
            </>
          )}
        </h2>
        <p>
          {est
            ? `${plural(est.tasks, 'conversation')} where your agent turned a failing test green on something you actually needed. Labs pay for tasks like that, and lore is building the way to sell yours.`
            : 'No conversation yet where an agent turned a failing test green on real work. That’s the kind labs pay for, and lore is building the way to sell it.'}
        </p>
      </div>
      {done ? (
        <p class="paid-done">✓ You’re on the list. One email when it opens.</p>
      ) : (
        <form class="paid-form" onSubmit={join}>
          <input type="email" required placeholder="you@example.com" value={email} onInput={(e) => setEmail((e.target as HTMLInputElement).value)} aria-label="Your email" />
          <button class="btn" disabled={busy || !email}>
            Join the waitlist
          </button>
        </form>
      )}
      <p class="paid-contact">
        Questions, or want lore for your team? <a href="mailto:inquiries@lore-wrapped.com">inquiries@lore-wrapped.com</a>
      </p>
      <p class="note">
        {est ? `A rough guess, not an offer: it assumes ${pct(ACCEPTED[0])}–${pct(ACCEPTED[1])} of those get accepted, at $${TASK_PRICE[0]}–$${TASK_PRICE[1].toLocaleString('en-US')} each (`: 'Labs pay that per curated coding task ('}
        <a href="https://epoch.ai/gradient-updates/state-of-rl-envs" target="_blank" rel="noreferrer">
          Epoch AI, 2026
        </a>
        {est ? `), with about ${pct(SHARE)} to you. ` : '). '}
        Joining sends only your email to lore’s waitlist, kept apart from your stats. Nothing else leaves.
      </p>
    </section>
  )
}

export function EndBand({ r, onShare }: { r: Report; onShare: Share }) {
  const kinds = useMemo(() => availableCards(r), [r])
  const [imgs, setImgs] = useState<Record<string, string>>({})
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!ref.current) return
    let live = true
    const io = new IntersectionObserver(
      async (es) => {
        if (!es.some((e) => e.isIntersecting)) return
        io.disconnect()
        for (const k of kinds) {
          const img = await cardImage(k, r)
          if (!live) return
          setImgs((m) => ({ ...m, [k]: img.url }))
        }
      },
      { rootMargin: '800px' },
    )
    io.observe(ref.current)
    return () => {
      live = false
      io.disconnect()
    }
  }, [kinds, r])
  const go = () => window.scrollTo({ top: 0 })
  const ics = useMemo(() => URL.createObjectURL(new Blob([monthlyReminder(new Date())], { type: 'text/calendar' })), [])
  return (
    <section class="band end-band" ref={ref}>
      <span class="label">
        <b>●</b> that’s the year
      </span>
      <h2>
        Take it with you. <em>Or keep going.</em>
      </h2>
      <div class="end-cards">
        {kinds.map((k) => (
          <button class="end-card" onClick={() => onShare(k)} aria-label={`Share ${CARD_LABELS[k]}`}>
            {imgs[k] ? <img src={imgs[k]} alt={CARD_LABELS[k]} loading="lazy" decoding="async" /> : <span class="spinner" />}
            <span>{CARD_LABELS[k]}</span>
          </button>
        ))}
      </div>
      <div class="end-links">
        <a class="end-link" href="#data" onClick={go}>
          <span class="el-k">data</span>
          <b>Every number, defined →</b>
          <span>The definitions behind this page, the exact anonymous stats lore would share, and receipts for any model calls.</span>
        </a>
        <a class="end-link" href={ics} download="lore-monthly.ics">
          <span class="el-k">next month</span>
          <b>Remind me on the 1st →</b>
          <span>
            A calendar file for the 1st of every month: <code>npx lore-wrapped@latest</code>. Your calendar keeps it; lore never hears about it.
          </span>
        </a>
      </div>
    </section>
  )
}
