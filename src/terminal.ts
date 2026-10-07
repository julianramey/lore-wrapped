// Terminal presentation. Every interactive run opens on one live pane: the lore mark as a ring
// of bars that breathes with the bytes being read, then shuffles while your card is dealt. A
// worker thread draws it straight to the terminal, so it stays smooth while the main thread is
// busy with the analysis. Pipes, CI, NO_COLOR and --no-anim get plain text.

import fs from 'node:fs'
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads'
import { markBraille } from '../web/src/mark.ts'

/** The pane's worker has no terminal of its own; the main thread tells it there is one. */
export const tty = isMainThread ? !!process.stdout.isTTY && !process.env.CI : !!workerData?.pane
const color = tty && !process.env.NO_COLOR
const truecolor = /truecolor|24bit/i.test(process.env.COLORTERM || '')

function fg(hex: string) {
  if (!color) return (s: string) => s
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  if (truecolor) return (s: string) => `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m`
  const c = 16 + 36 * Math.round((r / 255) * 5) + 6 * Math.round((g / 255) * 5) + Math.round((b / 255) * 5)
  return (s: string) => `\x1b[38;5;${c}m${s}\x1b[39m`
}
export const paint = {
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s),
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s),
  accent: fg('#ff6a2b'),
}

// ───────────────────────── the mark, in braille

function markRows(t: number, energy: number): string[] {
  return markBraille(t, energy).map((row) => row.map(([ch, hot]) => (hot ? paint.accent(ch) : ch)).join(''))
}

/** Text beside the mark, one entry per row (8 rows). */
function block(side: string[], t = 0, energy = 0): string[] {
  if (!color) return side.filter((s, i) => s || (i > 0 && side[i - 1])).map((s) => `  ${s}`)
  const mark = markRows(t, energy)
  return mark.map((m, i) => `  ${m}   ${side[i] || ''}`)
}

// ───────────────────────── the live pane

const fmtGB = (b: number) => `${(b / 1e9).toFixed(1)} GB`
const n = (x: number) => Math.round(x).toLocaleString('en-US')

export interface Pane {
  update(done: number, total: number, bytesDone: number, bytesTotal: number): void
  /** The scan is done: the pane shuffles while the report is built. */
  deal(): void
  /** Finishes the bar, clears the pane, and resolves once the terminal is clear. */
  stop(): Promise<void>
}
const none: Pane = { update() {}, deal() {}, stop: async () => {} }
let active: Pane = none

/** Starts the pane at once, drawn by a worker thread (`workerUrl` is lore's worker). */
export function livePane(version: string, workerUrl: URL): Pane {
  if (!tty || !color) return none
  const w = new Worker(workerUrl, { workerData: { pane: version } })
  w.unref()
  const restore = () => process.stdout.write('\x1b[?25h')
  process.once('exit', restore)
  let stopped: Promise<void> | null = null
  active = {
    update: (done, total, bytesDone, bytesTotal) => w.postMessage({ done, total, bytesDone, bytesTotal }),
    deal: () => w.postMessage({ deal: true }),
    stop: () =>
      (stopped ??= new Promise<void>((resolve) => {
        const done = () => {
          active = none
          process.off('exit', restore)
          void w.terminate()
          resolve()
        }
        w.once('message', done)
        w.once('error', done)
        w.postMessage({ stop: true })
      })),
  }
  return active
}

/** Stops whatever pane is up, so an error prints on a clean terminal. */
export const stopPane = () => active.stop()

/** The worker side: a frame every 50 ms, the bar easing toward the truth, until it's told to stop. */
export function runPane(version: string) {
  let state = { done: 0, total: 0, bytesDone: 0, bytesTotal: 0 }
  let dealing = false
  let stopping = false
  let shown = 0
  let energy = 0
  let drawn = 0
  const t0 = Date.now()
  parentPort!.on('message', (m) => {
    if (m.stop) stopping = true
    else if (m.deal) dealing = true
    else state = m
  })
  const frame = () => {
    const t = (Date.now() - t0) / 1000
    const target = dealing || stopping ? 1 : state.bytesTotal ? state.bytesDone / state.bytesTotal : 0
    // never faster than 0.8 s end to end, so even a cached run reads as a fill, not a flash
    const k = stopping ? 0.5 : 0.22
    const next = Math.min(target, t / 0.8, shown + (target - shown) * k + (target > shown ? (stopping ? 0.03 : 0.003) : 0))
    const speed = Math.max(0, next - shown) / 0.05
    shown = Math.max(shown, next)
    energy = energy * 0.85 + (dealing && !stopping ? 0.5 + 0.3 * Math.sin(t * 5) : Math.min(1, speed)) * 0.15
    const width = 30
    const filled = Math.round(shown * width)
    const bar = paint.accent('━'.repeat(filled)) + paint.dim('─'.repeat(width - filled))
    const lines = block(
      [
        `${paint.bold('lore')} ${paint.dim(`v${version}`)}`,
        paint.dim(dealing ? `dealing your card${'.'.repeat(1 + (Math.floor(t * 3) % 3))}` : 'reading your agent history, locally'),
        '',
        `${bar} ${String(Math.round(shown * 100)).padStart(3)}%`,
        paint.dim(state.total ? `${n(shown * state.total)} of ${n(state.total)} files · ${fmtGB(shown * state.bytesTotal)} of ${fmtGB(state.bytesTotal)}` : 'looking for your agents…'),
        '',
        paint.dim('nothing leaves this machine'),
        '',
      ],
      t,
      energy,
    )
    let out = drawn ? `\x1b[${drawn}A` : '\x1b[?25l'
    for (const l of lines) out += `\x1b[2K${l}\n`
    if (stopping && shown >= 0.999) {
      clearInterval(timer)
      fs.writeSync(1, `${out}\x1b[${lines.length}A\x1b[J\x1b[?25h`)
      parentPort!.postMessage('cleared')
      return
    }
    fs.writeSync(1, out)
    drawn = lines.length
  }
  const timer = setInterval(frame, 50)
  frame()
}

/** The still block a run ends on: the mark, and what lore found. */
export function finalBlock(side: string[]): string {
  return block(side).join('\n')
}
