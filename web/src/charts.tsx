import type { ComponentChildren } from 'preact'
import { useMemo, useState } from 'preact/hooks'
import { big, fmtDate, hourLabel, n, WEEKDAYS } from './format.ts'

// ───────────────────────── tooltip

export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ComponentChildren } | null>(null)
  const show = (e: MouseEvent, content: ComponentChildren) => {
    const r = (e.currentTarget as Element).getBoundingClientRect()
    setTip({ x: r.left + r.width / 2, y: r.top, content })
  }
  const node = tip ? (
    <div class="tooltip" style={{ left: `${tip.x}px`, top: `${tip.y}px` }} role="tooltip">
      {tip.content}
    </div>
  ) : null
  return { show, hide: () => setTip(null), node }
}

// ───────────────────────── sequential heat scale

const HEAT = ['var(--heat-0)', 'var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)', 'var(--heat-5)']

/** Quantile thresholds over non-zero values, so a few huge days don't wash out the rest. */
export function heatScale(values: number[]): (v: number) => string {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  const q = (p: number) => nz[Math.min(nz.length - 1, Math.floor(nz.length * p))] ?? 0
  const t = [q(0.2), q(0.45), q(0.7), q(0.9)]
  return (v: number) => (v <= 0 ? HEAT[0] : v <= t[0] ? HEAT[1] : v <= t[1] ? HEAT[2] : v <= t[2] ? HEAT[3] : v <= t[3] ? HEAT[4] : HEAT[5])
}

export function HeatLegend() {
  return (
    <span class="heat-legend" aria-hidden="true">
      less
      {HEAT.map((c) => (
        <i style={{ background: c }} />
      ))}
      more
    </span>
  )
}

// ───────────────────────── calendar

const dk = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Prompts per day. Hatched cells: days Claude's own stats saw, whose transcripts are gone. */
export function Calendar({ data, from, to, ghost = {} }: { data: Record<string, number>; from: number; to: number; ghost?: Record<string, number> }) {
  const tip = useTip()
  const ghostKeys = Object.keys(ghost).sort()
  const start0 = Math.min(from, ghostKeys.length ? new Date(`${ghostKeys[0]}T12:00:00`).getTime() : from)
  const { weeks, months, color } = useMemo(() => {
    const start = new Date(start0)
    start.setHours(12, 0, 0, 0)
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7))
    const end = new Date(to)
    end.setHours(12, 0, 0, 0)
    const weeks: { key: string; v: number; g: number; out: boolean }[][] = []
    const months: { x: number; label: string }[] = []
    let cur = new Date(start)
    let lastMonth = -1
    while (cur <= end) {
      const week: { key: string; v: number; g: number; out: boolean }[] = []
      for (let d = 0; d < 7; d++) {
        const key = dk(cur)
        week.push({ key, v: data[key] || 0, g: ghost[key] || 0, out: cur.getTime() > end.getTime() || cur.getTime() < start0 - 86400000 })
        if (d === 0 && cur.getMonth() !== lastMonth) {
          months.push({ x: weeks.length, label: cur.toLocaleString('en-US', { month: 'short' }) })
          lastMonth = cur.getMonth()
        }
        cur = new Date(cur.getTime() + 86400000)
      }
      weeks.push(week)
    }
    return { weeks, months, color: heatScale(Object.values(data)) }
  }, [data, from, to, ghost])
  const cell = 12
  const gap = 3
  const left = 30
  const top = 18
  const w = left + weeks.length * (cell + gap)
  const h = top + 7 * (cell + gap)
  return (
    <div class="chart">
      <div class="chart-scroll">
        <svg viewBox={`0 0 ${w} ${h}`} style={{ minWidth: `${Math.min(w, 760)}px` }} role="img" aria-label="Prompts per day">
          <defs>
            <pattern id="hatch" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="4" height="4" fill="var(--heat-0)" />
              <line x1="0" y1="0" x2="0" y2="4" stroke="var(--ink-4)" stroke-width="1.6" />
            </pattern>
          </defs>
          {months.map((m, i) => (i > 0 && m.x - months[i - 1].x < 3 ? null : <text x={left + m.x * (cell + gap)} y={11}>{m.label}</text>))}
          {[0, 2, 4].map((d) => (
            <text x={0} y={top + d * (cell + gap) + cell - 2}>
              {WEEKDAYS[d]}
            </text>
          ))}
          {weeks.map((wk, wi) =>
            wk.map((c, di) =>
              c.out ? null : (
                <rect
                  x={left + wi * (cell + gap)}
                  y={top + di * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2.5}
                  fill={c.v ? color(c.v) : c.g ? 'url(#hatch)' : 'var(--heat-0)'}
                  onMouseEnter={(e) =>
                    tip.show(
                      e,
                      <>
                        <div class="t-title">{fmtDate(c.key, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
                        <div>{c.v ? `${n(c.v)} prompt${c.v === 1 ? '' : 's'}` : c.g ? `${n(c.g)} Claude messages · transcript deleted` : 'no activity'}</div>
                      </>,
                    )
                  }
                  onMouseLeave={tip.hide}
                />
              ),
            ),
          )}
        </svg>
      </div>
      {tip.node}
    </div>
  )
}

/** A bar with its data end rounded (4px) and its base square, as an SVG path. */
function bar(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0
  return `M${x},${y + h}V${y + r}${r ? `Q${x},${y} ${x + r},${y}` : ''}H${x + w - r}${r ? `Q${x + w},${y} ${x + w},${y + r}` : ''}V${y + h}Z`
}

// ───────────────────────── Codex weekly limit

export function LimitWeeks({ weeks }: { weeks: { week: string; used: number }[] }) {
  const tip = useTip()
  const W = 760
  const H = 150
  const left = 34
  const plotH = H - 30
  const bw = (W - left) / Math.max(1, weeks.length)
  const barW = Math.max(4, Math.min(22, bw * 0.62))
  const y100 = 8
  return (
    <div class="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Peak Codex weekly limit used, by week">
        <line class="grid-line" x1={left} x2={W} y1={8 + plotH / 2} y2={8 + plotH / 2} />
        <line x1={left} x2={W} y1={y100} y2={y100} stroke="var(--bad)" stroke-dasharray="4 4" />
        <text x={left - 6} y={y100 + 3} text-anchor="end">
          100%
        </text>
        <text x={left - 6} y={8 + plotH / 2 + 3} text-anchor="end">
          50%
        </text>
        <line class="axis-line" x1={left} x2={W} y1={8 + plotH} y2={8 + plotH} />
        {weeks.map((w, i) => {
          const h = (Math.min(100, w.used) / 100) * plotH
          const x = left + i * bw + (bw - barW) / 2
          return (
            <g>
              <path d={bar(x, 8 + plotH - h, barW, Math.max(h, 1), true)} fill={w.used >= 100 ? 'var(--bad)' : w.used >= 80 ? 'var(--accent)' : 'var(--codex)'} />
              {(weeks.length <= 16 || i % 3 === 0) && (
                <text x={x + barW / 2} y={H - 4} text-anchor="middle">
                  {fmtDate(w.week, { month: 'short', day: 'numeric' })}
                </text>
              )}
              <rect class="hit" x={left + i * bw} y={0} width={bw} height={H} onMouseEnter={(e) => tip.show(e, <div>Week of {fmtDate(w.week)}: peaked at {w.used}%</div>)} onMouseLeave={tip.hide} />
            </g>
          )
        })}
      </svg>
      {tip.node}
    </div>
  )
}

// ───────────────────────── weekday × hour

export function RhythmGrid({ grid }: { grid: number[][] }) {
  const tip = useTip()
  const color = useMemo(() => heatScale(grid.flat()), [grid])
  const cell = 22
  const gap = 3
  const left = 34
  const W = left + 24 * (cell + gap)
  const H = 7 * (cell + gap) + 20
  return (
    <div class="chart">
      <div class="chart-scroll">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ minWidth: '560px' }} role="img" aria-label="Prompts by weekday and hour">
          {WEEKDAYS.map((d, i) => (
            <text x={0} y={i * (cell + gap) + cell / 2 + 4}>
              {d}
            </text>
          ))}
          {[0, 6, 12, 18, 23].map((h) => (
            <text x={left + h * (cell + gap) + cell / 2} y={H - 2} text-anchor="middle">
              {hourLabel(h)}
            </text>
          ))}
          {grid.map((row, d) =>
            row.map((v, h) => (
              <rect
                x={left + h * (cell + gap)}
                y={d * (cell + gap)}
                width={cell}
                height={cell}
                rx={3}
                fill={color(v)}
                onMouseEnter={(e) => tip.show(e, <div>{`${WEEKDAYS[d]} ${hourLabel(h)} · ${n(v)} prompts`}</div>)}
                onMouseLeave={tip.hide}
              />
            )),
          )}
        </svg>
      </div>
      {tip.node}
    </div>
  )
}

// ───────────────────────── horizontal bars

export function HBars({ rows, max }: { rows: { label: string; value: number; color?: string; display?: string; title?: string }[]; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value))
  return (
    <div class="hbars">
      {rows.map((r, i) => (
        <div class="hbar" title={r.title}>
          <span class="label-t">{r.label}</span>
          <span class="val">{r.display ?? n(r.value)}</span>
          <span class="bar">
            <span style={{ width: `${Math.max(1, (r.value / m) * 100)}%`, background: r.color || 'var(--ink)', animationDelay: `${i * 40}ms` }} />
          </span>
        </div>
      ))}
    </div>
  )
}

/** Fresh input, cached input and output tokens per model, on one shared scale. */
export function TokenBars({ rows }: { rows: { model: string; input: number; cached: number; output: number; total: number }[] }) {
  const tip = useTip()
  const max = Math.max(1, ...rows.map((r) => r.total))
  return (
    <div>
      <div class="legend">
        <span>
          <i class="sw" style={{ background: 'var(--ink)' }} />
          fresh input
        </span>
        <span>
          <i class="sw" style={{ background: 'var(--ink-4)' }} />
          cached input
        </span>
        <span>
          <i class="sw" style={{ background: 'var(--accent)' }} />
          output
        </span>
      </div>
      <div class="hbars">
        {rows.map((r) => (
          <div class="hbar">
            <span class="label-t">{r.model}</span>
            <span class="val">{big(r.total)}</span>
            <span
              class="bar"
              style={{ display: 'flex', gap: '1px', background: 'none' }}
              onMouseEnter={(e) => tip.show(e as any, <div>{`${r.model}: ${big(r.input)} fresh · ${big(r.cached)} cached · ${big(r.output)} out`}</div>)}
              onMouseLeave={tip.hide}
            >
              <span style={{ width: `${(r.input / max) * 100}%`, background: 'var(--ink)', borderRadius: 0 }} />
              <span style={{ width: `${(r.cached / max) * 100}%`, background: 'var(--ink-4)', borderRadius: 0 }} />
              <span style={{ width: `${Math.max(0.4, (r.output / max) * 100)}%`, background: 'var(--accent)' }} />
            </span>
          </div>
        ))}
      </div>
      {tip.node}
    </div>
  )
}
