import { useMemo, useState } from 'preact/hooks'
import type { Report } from '../../src/report-types.ts'
import { DECK, barPosition } from '../../src/pipeline/deck.ts'
import { compareVs, readVsCode, vsCode, VS_AXES } from '../../src/pipeline/versus.ts'
import { big } from './format.ts'

/** Compare with a friend: swap codes, see where you differ. Nothing leaves the page. */
export function Versus({ r, toast }: { r: Report; toast: (m: string, err?: boolean) => void }) {
  const mine = useMemo(() => vsCode(r.archetype.key, r.archetype.spectra, r.totals.prompts), [r])
  const [input, setInput] = useState('')
  const me = useMemo(() => readVsCode(mine)!, [mine])
  const them = input.trim() ? readVsCode(input) : null
  const res = them ? compareVs(me, them) : null
  const card = (k: string) => DECK.find((d) => d.key === k)!
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`My lore code: ${mine} — what's yours? npx lore-wrapped`)
      toast('Code copied')
    } catch {
      toast('Copy isn’t available here', true)
    }
  }
  return (
    <div class="vs">
      <div class="sub-h">versus a friend</div>
      <p class="note">
        Send a friend your code and paste theirs. It holds your card, your seven dots rounded to quarter steps and your prompt count to the nearest power of two: no names, projects, words or dates.
      </p>
      <div class="vs-row">
        <button class="cmd" onClick={copy} title="Copy your code">
          {mine} <span class="copy">copy</span>
        </button>
        <input class="vs-input" placeholder="Paste a friend’s LORE- code" value={input} onInput={(e) => setInput((e.target as HTMLInputElement).value)} aria-label="A friend’s lore code" spellcheck={false} />
      </div>
      {input.trim() && !them && <p class="note">That isn’t a lore code. Codes look like {mine.slice(0, 7)}…</p>}
      {them && res && (
        <div class="vs-result">
          <p class="vs-head">
            <b>{res.sync}%</b> in sync. You’re {card(me.card).name}; they’re {card(them.card).name}
            {Math.abs(Math.log2((r.totals.prompts + 1) / (them.prompts + 1))) >= 2 ? `, with about ${big(them.prompts)} prompts to your ${big(r.totals.prompts)}` : ''}.
          </p>
          {res.awards.length > 0 && (
            <ul class="vs-awards">
              {res.awards.slice(0, 4).map((a) => (
                <li>
                  <span>{a.you ? 'You' : 'They'}</span> {a.text}
                </li>
              ))}
            </ul>
          )}
          <div class="tw-axes">
            {VS_AXES.map((k) => {
              const s = r.archetype.spectra.find((x) => x.key === k)!
              return (
                <div class="tw-axis">
                  <span>{s.left}</span>
                  <span class="tw-track">
                    <i class="mid" />
                    <i class="them" style={{ left: `${barPosition(them.z[k]) * 100}%` }} title="them" />
                    <i class="you" style={{ left: `${barPosition(me.z[k]) * 100}%` }} title="you" />
                  </span>
                  <span>{s.right}</span>
                </div>
              )
            })}
          </div>
          <div class="tw-key">
            <span>
              <i class="you" /> you
            </span>
            <span>
              <i class="them" /> them
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
