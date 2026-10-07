import type { ComponentChildren } from 'preact'
import { useEffect, useMemo, useState } from 'preact/hooks'
import type { Report } from '../../src/report-types.ts'
import { prettyModel } from '../../src/pipeline/modelName.ts'
import { SOURCE_KEYS } from '../../src/sources/registry.ts'
import type { Budget, Narrative, Provider, ProviderId, Receipt } from './api.ts'
import { HBars, HeatLegend, LimitWeeks, RhythmGrid, TokenBars } from './charts.tsx'
import { Quote, useEvidence } from './evidence.tsx'
import { big, dur, fmtDate, fmtMonth, hourLabel, money, n, oneIn, pct, plural, secs, SOURCE_LABEL, sourceVar } from './format.ts'
import { availableCards, CARD_LABELS, cardImage, type CardKind } from './cards.ts'
import { BillBand, BranchesBand, EndBand, ModelsBand, PaidBand, RankBand, RecordsBand, Reveal, Slider, TwinBand, WordsBand, YearBand } from './showpieces.tsx'

interface Props {
  report: Report
  narrative: Narrative | null
  providers: Provider[]
  budget: Budget
  receipts: Receipt[]
  onNarrate: (p: ProviderId, tone?: 'recap' | 'roast') => Promise<void>
  onShare: (card?: string) => void
  toast: (m: string, err?: boolean) => void
}

const SECTIONS = [
  ['spectra', 'Seven spectra'],
  ['work', 'What agents did'],
  ['steering', 'Steering'],
  ['voice', 'Your voice'],
  ['rhythm', 'Rhythm'],
  ['projects', 'Projects'],
  ['limits', 'Limits & effort'],
  ['moments', 'Moments'],
  ['method', 'Method'],
] as const

export function Recap(p: Props) {
  const r = p.report
  return (
    <main class="frame">
      <SinceStrip r={r} />
      <Reveal r={r} onShare={p.onShare} />
      <TwinBand r={r} />
      <CardsBand r={r} onShare={p.onShare} toast={p.toast} />
      <YearBand r={r} />
      <RecordsBand r={r} />
      <BranchesBand r={r} />
      <ModelsBand r={r} />
      <BillBand r={r} />
      <WordsBand r={r} onShare={p.onShare} />
      <RankBand r={r} toast={p.toast} />
      <LoreBand r={r} />
      <NarrativeBand {...p} />
      <div class="deep-head band">
        <span class="label">
          <b>11</b> the deep dive
        </span>
        <h2>Everything else, counted.</h2>
      </div>
      <div class="layout">
        <Toc />
        <div class="sections">
          <Spectra r={r} />
          <Work r={r} />
          <Steering r={r} />
          <Voice r={r} />
          <Rhythm r={r} />
          <Projects r={r} />
          <Limits r={r} />
          <Moments r={r} />
          <Method r={r} />
        </div>
      </div>
      <PaidBand r={r} toast={p.toast} />
      <EndBand r={r} onShare={p.onShare} />
    </main>
  )
}

// ───────────────────────── since your last run

function SinceStrip({ r }: { r: Report }) {
  const s = r.since
  if (!s) return null
  const moved = Math.round(s.steer.to * 100) - Math.round(s.steer.from * 100)
  const bits: ComponentChildren[] = [
    s.prompts > 0 && (
      <span>
        <b>+{n(s.prompts)}</b> {s.prompts === 1 ? 'prompt' : 'prompts'}
      </span>
    ),
    s.projects > 0 && (
      <span>
        <b>{n(s.projects)}</b> new {s.projects === 1 ? 'project' : 'projects'}
        {s.newProjects.length > 0 && <span class="was"> ({s.newProjects.slice(0, 3).join(', ')})</span>}
      </span>
    ),
    moved !== 0 && (
      <span>
        steering <b>{pct(s.steer.from)} → {pct(s.steer.to)}</b>
      </span>
    ),
    // what changed, never what it changed to: that's the reveal's job
    s.card && (
      <span>
        <b>a new card</b>
        <span class="was"> (was {s.card.from})</span>
      </span>
    ),
    !s.card && s.code && (
      <span>
        <b>a new code</b>
        <span class="was"> (was <span class="mono">{s.code.from}</span>)</span>
      </span>
    ),
    s.twin && (
      <span>
        <b>a new twin</b>
        <span class="was"> (was {s.twin.from})</span>
      </span>
    ),
  ].filter(Boolean)
  if (!bits.length && !s.notes.length) return null
  return (
    <aside class="since" aria-label="Since your last run">
      <span class="label">since {fmtDate(s.at, { month: 'short', day: 'numeric' })}</span>
      {bits.length ? <span class="since-bits">{bits}</span> : <span class="was">nothing new from your agents yet</span>}
      {s.notes.length > 0 && (
        <ul class="since-notes">
          {s.notes.map((x) => (
            <li>{x}</li>
          ))}
        </ul>
      )}
    </aside>
  )
}

// ───────────────────────── your card, measured

function Spectra({ r }: { r: Report }) {
  const a = r.archetype
  return (
    <Sec id="spectra" n="12" title="seven spectra">
      <h2>
        {a.name} is one end of one line. <em>Here are all seven.</em>
      </h2>
      <p class="lead">The middle tick is a typical heavy agent user; the dot is you. Your card is the end you sit furthest out toward, measured in standard deviations on a log scale. {a.description}</p>
      <div class="spectra-list">
        {a.spectra.map((sp) => (
          <div class="spectra-row">
            <Slider s={sp} />
            <small>
              {sp.metric} · {sp.typical}
            </small>
          </div>
        ))}
      </div>
      <div class="duo" style={{ marginTop: '22px' }}>
        <div>
          <b>superpower</b>
          {a.superpower}
        </div>
        <div>
          <b>blind spot</b>
          {a.blindSpot}
        </div>
      </div>
      {a.badges.length > 0 && (
        <div class="badges">
          {a.badges.map((b) => (
            <span class="badge" title={b.why}>
              {b.label}
            </span>
          ))}
        </div>
      )}
      <div class="sub-h">closest cards in the deck</div>
      <div class="matches">
        {a.matches.map((m) => (
          <span>
            <b>{m.name}</b> {m.score}%
          </span>
        ))}
      </div>
      <p class="note">The percentage is how far your dot sits from the middle toward that end. “Typical” values are estimates for now; once the lore index has enough anonymous runs, they come from real medians.</p>
    </Sec>
  )
}

function CardsBand({ r, onShare, toast }: { r: Report; onShare: Props['onShare']; toast: (m: string, err?: boolean) => void }) {
  const kinds = useMemo(() => availableCards(r), [r])
  const [imgs, setImgs] = useState<Record<string, { url: string; blob: Blob }>>({})
  useEffect(() => {
    let live = true
    ;(async () => {
      for (const k of kinds) {
        // one card at a time, in idle moments, so scrolling never waits on a render
        await new Promise((res) => ('requestIdleCallback' in window ? (window as any).requestIdleCallback(res, { timeout: 600 }) : setTimeout(res, 30)))
        const img = await cardImage(k, r)
        if (!live) return
        setImgs((m) => ({ ...m, [k]: img }))
      }
    })()
    return () => {
      live = false
    }
  }, [kinds, r])
  const download = (k: string) => {
    const a = document.createElement('a')
    a.href = imgs[k].url
    a.download = `lore-${k}.png`
    a.click()
  }
  const copy = async (k: string) => {
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': imgs[k].blob })])
      toast(`${CARD_LABELS[k as CardKind]} copied`)
    } catch {
      toast('Copy isn’t available here — use download', true)
    }
  }
  const all = async () => {
    for (const k of kinds) {
      if (!imgs[k]) continue
      download(k)
      await new Promise((res) => setTimeout(res, 250))
    }
  }
  return (
    <section class="band cards-band" id="cards">
      <div class="cards-head">
        <div>
          <span class="label">
            <b>01</b> your cards
          </span>
          <h2>{kinds.length} cards. Post the loudest.</h2>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span class="note">counts only · no code, quotes or project names</span>
          <button class="btn small" onClick={all} disabled={Object.keys(imgs).length < kinds.length}>
            download all
          </button>
        </div>
      </div>
      <div class="carousel">
        {kinds.map((k) => (
          <figure class="card-tile">
            <button class="ct-img" onClick={() => onShare(k)} aria-label={`Open ${CARD_LABELS[k]}`}>
              {imgs[k] ? <img src={imgs[k].url} alt={CARD_LABELS[k]} loading="lazy" decoding="async" /> : <span class="spinner" />}
            </button>
            <figcaption>
              <span>{CARD_LABELS[k]}</span>
              <span class="ct-actions">
                <button class="icon-btn small" title="Download PNG" disabled={!imgs[k]} onClick={() => download(k)}>
                  ↓
                </button>
                <button class="icon-btn small" title="Copy image" disabled={!imgs[k]} onClick={() => copy(k)}>
                  ⧉
                </button>
              </span>
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  )
}


function LoreBand({ r }: { r: Report }) {
  if (!r.lore.length) return null
  const maxEra = Math.max(1, ...r.eras.map((e) => e.prompts))
  return (
    <section class="band" id="lore">
      <span class="label">
        <b>09</b> the lore
      </span>
      <h2 class="band-title">Things you’ve probably forgotten.</h2>
      <p class="band-lead">Pulled from {n(r.totals.prompts)} prompts by rules, not guesses. Every quote is real and opens where it was said.</p>
      <div class="eras" aria-label="Eras: your main project and model by month">
        {r.eras.map((e, i) => (
          <div class={`era ${i && r.eras[i - 1].project !== e.project ? 'change' : ''}`} title={`${fmtMonth(`${e.month}-15`)}: ${n(e.prompts)} prompts, mostly ${e.project}${e.model ? `, ${prettyModel(e.model)}` : `, mostly ${e.tool} (model not recorded)`}`}>
            <span class="era-bar" style={{ height: `${8 + (e.prompts / maxEra) * 52}px` }} />
            <span class="era-m">{new Date(`${e.month}-15`).toLocaleString('en-US', { month: 'short' })}</span>
            <span class="era-p">{e.project}</span>
            <span class="era-model">{e.model ? prettyModel(e.model).replace(/^Claude /, '') : (e.tool ?? '—')}</span>
          </div>
        ))}
      </div>
      <ol class="timeline-lore">
        {r.lore.map((e) => (
          <li>
            <div class="tl-date">{e.undated ? 'all along' : fmtDate(e.at, { month: 'short', year: 'numeric' })}</div>
            <div class="tl-dot" />
            <div class="tl-body">
              <span class="tl-kicker">{e.kicker}</span>
              <h3>{e.title}</h3>
              <p>{e.body}</p>
              {e.example && <Quote ex={e.example} />}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}

// ───────────────────────── narrative + receipt

export function ReceiptCard({ receipt }: { receipt: Receipt }) {
  const u = receipt.usage
  return (
    <div class="receipt">
      <div class="r-title">
        <span>run receipt</span>
        <span>{fmtDate(receipt.at, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
      </div>
      <div class="r-row">
        <span>action</span>
        <span>{receipt.action}</span>
      </div>
      <div class="r-row">
        <span>model</span>
        <span>{receipt.model}</span>
      </div>
      <div class="r-row">
        <span>calls · time</span>
        <span>
          {receipt.calls} · {(receipt.ms / 1000).toFixed(1)}s
        </span>
      </div>
      <div class="r-row">
        <span>tokens in / out</span>
        <span>
          {big(u.inputTokens)} / {big(u.outputTokens)}
        </span>
      </div>
      {u.costUsd ? (
        <div class="r-row">
          <span>API-equivalent</span>
          <span>{money(u.costUsd)}</span>
        </div>
      ) : null}
      <hr />
      {receipt.windows.length ? (
        receipt.windows.map((w) => (
          <div style={{ display: 'grid', gap: '4px' }}>
            <div class="r-row">
              <span>{w.name}</span>
              <span>{w.before !== null && w.after !== null ? `${w.before}% → ${w.after}%${w.after - w.before < 1 ? ' (<1%)' : ''}` : `${w.after ?? '?'}% used after`}</span>
            </div>
            <div class="meter">
              <span style={{ width: `${Math.min(100, w.before ?? w.after ?? 0)}%` }} />
              {w.before !== null && w.after !== null && <span class="delta" style={{ left: `${w.before}%`, width: `${Math.max(0.6, w.after - w.before)}%` }} />}
            </div>
          </div>
        ))
      ) : (
        <div class="note">The provider didn't report plan usage for this run.</div>
      )}
      <div class="note">Paid by your existing plan. No API key, no billing fallback.</div>
    </div>
  )
}

function NarrativeBand({ report: r, narrative, providers, budget, receipts, onNarrate }: Props) {
  const open = useEvidence()
  const [busy, setBusy] = useState<ProviderId | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [tone, setTone] = useState<'recap' | 'roast'>('recap')
  const cite = (id: string) => narrative?.examples.find((e) => e.id === id)?.example
  const receipt = receipts.find((x) => x.action === 'narrative')
  const other = narrative?.tone === 'roast' ? 'recap' : 'roast'
  const run = async (pid: ProviderId, t = tone) => {
    setBusy(pid)
    setErr(null)
    try {
      await onNarrate(pid, t)
    } catch (e: any) {
      setErr(e.message || String(e))
    } finally {
      setBusy(null)
    }
  }
  return (
    <section class="band">
      <span class="label">
        <b>10</b> the story, written from your numbers
      </span>
      <div class="narrative" style={{ marginTop: '20px' }}>
        <div class="narrative-text">
          {narrative ? (
            <>
              <div class="headline">{narrative.headline}</div>
              {narrative.paragraphs.map((p) => (
                <p>
                  {p.text}
                  {p.cites.map((c) => (
                    <button class="cite" onClick={() => cite(c) && open(cite(c)!.ref)} title={cite(c)?.text}>
                      [{c.replace('e', '')}]
                    </button>
                  ))}
                </p>
              ))}
              <p class="note">
                Written by {narrative.model} from counted facts and {narrative.examples.length} selected messages; bracketed numbers open the message behind a claim.
                {narrative.stale ? ` Written ${fmtDate(narrative.createdAt)} from an earlier scan; the numbers on this page are current.` : ''}
                {narrative.stale && (
                  <button class="cite" style={{ verticalAlign: 'baseline', fontSize: '12px' }} disabled={!!busy || budget.used >= budget.limit} onClick={() => run(narrative.provider, narrative.tone || 'recap')}>
                    {busy ? 'rewriting…' : 'rewrite with today’s numbers'}
                  </button>
                )}
                <button class="cite" style={{ verticalAlign: 'baseline', fontSize: '12px' }} disabled={!!busy || budget.used >= budget.limit} onClick={() => run(narrative.provider, other)}>
                  {busy ? 'writing…' : other === 'roast' ? 'roast me instead' : 'the straight version'}
                </button>
              </p>
            </>
          ) : (
            <div class="narrate-cta">
              <div style={{ fontSize: '17px', fontWeight: 300 }}>
                Everything on this page is counted, no model involved.
                {providers[0]?.off ? ` ${providers[0].off}` : ' Want it written up? One call to a model you’re already signed in to turns these numbers and 8 of your messages into a short, cited story.'}
              </div>
              {!providers[0]?.off && <div class="seg" role="group" aria-label="Tone" style={{ marginTop: '14px' }}>
                <button class={tone === 'recap' ? 'on' : ''} aria-pressed={tone === 'recap'} onClick={() => setTone('recap')}>
                  Straight
                </button>
                <button class={tone === 'roast' ? 'on' : ''} aria-pressed={tone === 'roast'} onClick={() => setTone('roast')} title="The same counted facts, with a raised eyebrow. It roasts habits, not people.">
                  Roast me
                </button>
              </div>}
              {!providers[0]?.off && <div class="row">
                {providers.map((pv) => (
                  <button class="btn small" disabled={!pv.available || !!busy || budget.used >= budget.limit} onClick={() => run(pv.id)} title={pv.note}>
                    {busy === pv.id ? <span class="spinner" /> : null} write it with {pv.label}
                  </button>
                ))}
                <span class="note">≈3k tokens · {budget.used}/{budget.limit} calls used this run</span>
              </div>}
            </div>
          )}
          {err && <p class="note" style={{ color: 'var(--bad)' }}>{err}</p>}
        </div>
        <div>{receipt ? <ReceiptCard receipt={receipt} /> : <div class="receipt"><div class="r-title"><span>run receipt</span></div><div class="r-row"><span>this run</span><span>0 model calls</span></div><div class="r-row"><span>tokens</span><span>0</span></div><hr /><div class="note">Optional model calls show their exact cost on your plan here: tokens, time, and how much of your Claude or Codex window they used.</div></div>}</div>
      </div>
    </section>
  )
}

// ───────────────────────── sections

function Toc() {
  const [on, setOn] = useState('spectra')
  useEffect(() => {
    const io = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
      if (vis) setOn(vis.target.id)
    }, { rootMargin: '-60px 0px -60% 0px' })
    for (const [id] of SECTIONS) {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    }
    return () => io.disconnect()
  }, [])
  return (
    <nav class="toc" aria-label="Sections">
      {SECTIONS.map(([id, label], i) => (
        <a href={`#${id}`} class={on === id ? 'on' : ''}>
          {String(i + 12).padStart(2, '0')} {label}
        </a>
      ))}
    </nav>
  )
}

function Sec({ id, n: num, title, children }: { id: string; n: string; title: string; children: ComponentChildren }) {
  return (
    <section class="sec" id={id}>
      <span class="label">
        <b>{num}</b> {title}
      </span>
      {children}
    </section>
  )
}

function Stat({ v, k, small }: { v: ComponentChildren; k: string; small?: string }) {
  return (
    <div class="stat">
      <div class="v">
        {v}
        {small ? <small> {small}</small> : null}
      </div>
      <div class="k">{k}</div>
    </div>
  )
}

function Work({ r }: { r: Report }) {
  const w = r.deep.work
  const open = useEvidence()
  const totalHours = w.agentHours || 1
  return (
    <Sec id="work" n="13" title="what the agents did">
      <h2>
        {plural(Math.round(w.agentHours), 'hour')} of agent work. {big(w.commands.total)} commands. {big(w.linesAdded)} lines.
      </h2>
      <p class="lead">
        Each prompt bought <strong>{w.agentMinutesPerPrompt.toFixed(1)} minutes</strong> of agent time and <strong>{w.actionsPerPrompt.toFixed(1)} actions</strong>. A typical turn ran {w.medianTurnMin.toFixed(1)} minutes;
        {w.longestTurn ? (
          <>
            {' '}
            the longest ran <strong>{dur(w.longestTurn.min)}</strong> without you, on{' '}
            <button class="link-btn" onClick={() => open(w.longestTurn!.ref)}>
              <span class="hl">“{w.longestTurn.title}”</span>
            </button>
            .
          </>
        ) : null}
        {w.perPromptBasis.observed < w.perPromptBasis.prompts * 0.95 ? (
          <span class="muted">
            {' '}
            Per-prompt numbers count only the {pct(w.perPromptBasis.observed / Math.max(1, w.perPromptBasis.prompts))} of prompts whose replies are still on disk.
          </span>
        ) : null}
      </p>
      <div class="grid3">
        <div class="panel">
          <Stat v={n(w.agentHours)} k="agent hours" />
          <div style={{ height: '14px' }} />
          <HBars
            rows={SOURCE_KEYS.filter((s) => w.agentHoursBySource[s] > 0).map((s) => ({ label: SOURCE_LABEL[s], value: w.agentHoursBySource[s], color: sourceVar(s), display: `${pct(w.agentHoursBySource[s] / totalHours)}` }))}
          />
          <p class="note" style={{ marginTop: '12px' }}>
            {r.definitions.agentHours}
          </p>
        </div>
        <div class="panel">
          <Stat v={<><span class="plus">+{big(w.linesAdded)}</span> <span class="minus" style={{ fontSize: '28px' }}>−{big(w.linesRemoved)}</span></>} k={`lines across ${n(w.filesTouched)} files`} />
          <div style={{ height: '14px' }} />
          <HBars rows={w.languages.slice(0, 6).map((l) => ({ label: l.lang, value: l.lines, display: big(l.lines) }))} />
          <p class="note" style={{ marginTop: '12px' }}>Lines added by language. Lockfiles and build output excluded.</p>
        </div>
        <div class="panel">
          <Stat v={big(w.commands.total)} k="shell commands agents ran" />
          <div style={{ height: '14px' }} />
          <HBars rows={w.commands.categories.slice(0, 6).map((c) => ({ label: c.label, value: c.count, display: pct(c.share), title: c.examples?.join('\n') }))} />
        </div>
      </div>
      <div class="sub-h">most-run commands</div>
      <div class="chips">
        {w.commands.top.map((c) => (
          <span class="chip">
            {c.cmd}
            <b>×{n(c.count)}</b>
          </span>
        ))}
      </div>
      <div class="sub-h">the files agents kept coming back to</div>
      <table class="dt">
        <thead>
          <tr>
            <th>file</th>
            <th>project</th>
            <th class="n">turns that edited it</th>
            <th class="n">lines changed</th>
          </tr>
        </thead>
        <tbody>
          {w.topFiles.slice(0, 8).map((f) => (
            <tr>
              <td class="mono" style={{ fontSize: '12.5px' }}>
                {f.file}
              </td>
              <td>{f.project}</td>
              <td class="n">{n(f.turns)}</td>
              <td class="n">{big(f.lines)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sec>
  )
}

function Limits({ r }: { r: Report }) {
  const lim = r.deep.limits
  const e = r.deep.effort
  return (
    <Sec id="limits" n="18" title="limits & effort">
      <h2>
        {pct(e.highShare)} of turns at xhigh effort or above.
        {lim && lim.windowsAtLimit ? <em> {plural(lim.windowsAtLimit, 'limit')} hit.</em> : null}
      </h2>
      <div class="grid2">
        <div class="panel">
          <h3>Effort you asked for</h3>
          <p class="note">Reasoning effort recorded per agent turn.</p>
          <HBars rows={e.levels.slice(0, 6).map((l) => ({ label: l.key, value: l.count, display: pct(l.share), color: ['xhigh', 'max', 'ultra'].includes(l.key) ? 'var(--accent)' : 'var(--ink)' }))} />
          {e.planModeTurns ? <p class="note" style={{ marginTop: '12px' }}>{n(e.planModeTurns)} prompts in plan mode.</p> : null}
        </div>
        <div class="panel">
          <h3>Tokens by model</h3>
          <p class="note">{r.definitions.tokens} Dollars are in the bill above.</p>
          <TokenBars rows={r.deep.tokens.byModel.slice(0, 8)} />
        </div>
      </div>
      {lim && (
        <>
          <div class="sub-h">codex plan limit, peak per week{lim.plan ? ` · ${lim.plan} plan` : ''}</div>
          <LimitWeeks weeks={lim.weeklyPeaks} />
          <p class="note">
            You hit a Codex usage limit <strong style={{ color: 'var(--ink)' }}>{plural(lim.windowsAtLimit, 'time')}</strong>
            {lim.weeksAtLimit ? `, and maxed out the weekly window in ${plural(lim.weeksAtLimit, 'week')}` : ''}. {r.definitions.limits}
          </p>
        </>
      )}
    </Sec>
  )
}

function Steering({ r }: { r: Report }) {
  const d = r.deep
  const [openKey, setOpenKey] = useState<string | null>(null)
  const maxRate = Math.max(...d.steeringByModel.map((m) => m.rate), 0.01)
  return (
    <Sec id="steering" n="14" title="how you steer">
      <h2>{r.totals.steers ? `${oneIn(r.steering.rate)} follow-ups redirect the agent.` : 'You haven’t redirected an agent yet.'}</h2>
      {r.totals.steers > 0 && (
        <p class="lead">
          <strong>{n(r.totals.steers)}</strong> redirect{r.totals.steers === 1 ? '' : 's'}, a median of <strong>{secs(d.timeToSteer.medianSec)}</strong> after the agent’s attempt{r.totals.interrupts ? `, and ${plural(r.totals.interrupts, 'time')} you stopped it mid-turn` : ''}.{d.chains.longest > 1 ? (
            <>
              {' '}
              Your longest losing streak: <strong>{d.chains.longest} redirects in a row</strong>.
            </>
          ) : null}
        </p>
      )}
      <div class="grid2">
        <div class="panel">
          <h3>Which model’s work you redirected most</h3>
          <p class="note">{r.definitions.steerByModel}</p>
          <HBars rows={d.steeringByModel.slice(0, 9).map((m) => ({ label: m.model, value: m.rate, color: sourceVar(m.source), display: pct(m.rate, 1), title: `${n(m.steers)} of ${n(m.followups)} follow-ups` }))} max={maxRate} />
        </div>
        <div class="quotes">
          {d.timeToSteer.fastest && (
            <>
              <div class="sub-h" style={{ margin: '0 0 2px' }}>
                fastest redirect
              </div>
              <Quote ex={d.timeToSteer.fastest} />
            </>
          )}
          {d.chains.example && (
            <>
              <div class="sub-h" style={{ margin: '12px 0 2px' }}>
                start of your longest redirect streak ({d.chains.longest} in a row)
              </div>
              <Quote ex={d.chains.example} />
            </>
          )}
        </div>
      </div>
      <div class="sub-h">what you said when you redirected</div>
      <div class="grid2">
        {r.steering.themes.slice(0, 6).map((th) => {
          const exs = th.examples.filter((e) => e.safe)
          return (
            <div class="panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '12px' }}>
                <h3>{th.label}</h3>
                <span class="mono note">
                  {n(th.count)} · {pct(th.share)}
                </span>
              </div>
              <p class="note">{th.blurb}</p>
              <div class="quotes">
                {(openKey === th.key ? exs : exs.slice(-1)).map((ex) => (
                  <Quote ex={ex} />
                ))}
              </div>
              {exs.length > 1 && openKey !== th.key && (
                <button class="btn small ghost" style={{ marginTop: '8px' }} onClick={() => setOpenKey(th.key)}>
                  {exs.length - 1} more
                </button>
              )}
            </div>
          )
        })}
      </div>
    </Sec>
  )
}

function Voice({ r }: { r: Report }) {
  const open = useEvidence()
  const d = r.deep
  return (
    <Sec id="voice" n="15" title="your voice">
      <h2>
        {r.style.medianWords} words per prompt. {pct(r.style.oneLinerShare)} one-liners.
      </h2>
      <p class="lead">
        One in ten prompts runs past {r.style.p90Words} words and {pct(r.style.questionShare)} end in a question mark. Most often you opened a conversation to <strong>{d.intents[0]?.label.toLowerCase()}</strong>.
      </p>
      <div class="grid2">
        <div class="panel">
          <h3>What you opened conversations to do</h3>
          <p class="note">{r.definitions.intent}</p>
          <HBars rows={d.intents.slice(0, 10).map((i) => ({ label: i.label, value: i.count, display: pct(i.share), title: i.examples?.join('\n') }))} />
        </div>
        <div class="panel">
          <h3>Your signature phrases</h3>
          <p class="note">{r.definitions.phrase} Click one to see it in context.</p>
          <div class="chips">
            {r.phrases.map((p) => (
              <button class="chip" onClick={() => open(p.example.ref)}>
                “{p.text}”<b>{p.threads}</b>
              </button>
            ))}
          </div>
          {r.style.longest && (
            <>
              <div class="sub-h">longest prompt you actually wrote</div>
              <Quote ex={r.style.longest} />
            </>
          )}
        </div>
      </div>
    </Sec>
  )
}

function Rhythm({ r }: { r: Report }) {
  return (
    <Sec id="rhythm" n="16" title="rhythm">
      <h2>You peak around {hourLabel(r.rhythm.peakHour)}.</h2>
      <p class="lead">
        {pct(r.rhythm.nightShare)} of your prompts land between 10pm and 4am, {pct(r.rhythm.earlyShare)} before 8am, {pct(r.rhythm.weekendShare)} on weekends.
      </p>
      <RhythmGrid grid={r.rhythm.grid} />
      <div class="chart-caption">
        <span>prompts by weekday and hour · {r.timezone}</span>
        <HeatLegend />
      </div>
    </Sec>
  )
}

function Projects({ r }: { r: Report }) {
  const from = r.coverage.from
  const span = Math.max(1, r.coverage.to - from)
  const ct = r.deep.crossTool
  return (
    <Sec id="projects" n="17" title="where you went deep">
      <h2>{r.projects.filter((p) => p.prompts >= 50).length} projects got real attention.</h2>
      <p class="lead">
        {ct.projectsOnBoth ? (
          <>
            {plural(ct.projectsOnBoth, 'project')} ran on more than one agent
            {ct.switches ? <>, and {plural(ct.switches, 'time')} you switched tools right after redirecting one</> : ''}.
          </>
        ) : (
          'Each project lived in one tool.'
        )}
      </p>
      <table class="dt">
        <thead>
          <tr>
            <th>project</th>
            <th>active span</th>
            <th class="n">prompts</th>
            <th class="n hide-sm">threads</th>
            <th class="n hide-sm">days</th>
            <th class="n">steer rate</th>
            <th class="hide-sm">tools</th>
          </tr>
        </thead>
        <tbody>
          {r.projects.slice(0, 12).map((p) => (
            <tr>
              <td>
                <b>{p.name}</b>
              </td>
              <td class="span-cell">
                <div style={{ position: 'relative', height: '8px', background: 'var(--bg-3)', borderRadius: '4px' }} title={`${fmtMonth(p.first)} → ${fmtMonth(p.last)}`}>
                  <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((p.first - from) / span) * 100}%`, width: `${Math.max(2, ((p.last - p.first) / span) * 100)}%`, background: 'var(--accent)', borderRadius: '4px' }} />
                </div>
              </td>
              <td class="n">{n(p.prompts)}</td>
              <td class="n hide-sm">{n(p.threads)}</td>
              <td class="n hide-sm">{n(p.activeDays)}</td>
              <td class="n">{pct(p.steerRate)}</td>
              <td class="hide-sm">
                {p.sources.map((s) => (
                  <span class="src" style={{ marginRight: '8px' }}>
                    <i style={{ background: sourceVar(s) }} />
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div class="sub-h">how the biggest ones started</div>
      <div class="grid3">
        {r.projects.slice(0, 3).map((p) =>
          p.asks[0] ? (
            <div>
              <div class="mono note" style={{ marginBottom: '6px' }}>
                {p.name}
              </div>
              <Quote ex={p.asks[0]} />
            </div>
          ) : null,
        )}
      </div>
    </Sec>
  )
}

function Moments({ r }: { r: Report }) {
  const open = useEvidence()
  return (
    <Sec id="moments" n="19" title="moments">
      <h2>A few specific messages.</h2>
      <div class="grid2">
        {r.moments.map((m) => (
          <div>
            <div class="mono note" style={{ marginBottom: '6px' }}>
              {m.title} · {m.detail}
            </div>
            <Quote ex={m.example} />
          </div>
        ))}
      </div>
      <div class="sub-h">the longest threads</div>
      <table class="dt">
        <thead>
          <tr>
            <th>thread</th>
            <th>project</th>
            <th class="n">prompts</th>
            <th class="n">redirects</th>
            <th class="n">days</th>
          </tr>
        </thead>
        <tbody>
          {r.deepest.map((t) => (
            <tr>
              <td>
                <button class="link-btn" onClick={() => open(t.ref)}>
                  {t.title}
                </button>
              </td>
              <td>{t.project}</td>
              <td class="n">{n(t.prompts)}</td>
              <td class="n">{n(t.steers)}</td>
              <td class="n">{n(t.days)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Sec>
  )
}

function Method({ r }: { r: Report }) {
  const c = r.coverage
  const ret = r.deep.retention
  return (
    <Sec id="method" n="20" title="how this was made">
      <h2>Counted, not guessed.</h2>
      <div class="grid2">
        <div class="note" style={{ fontSize: '13.5px' }}>
          <p>
            <b style={{ color: 'var(--ink)' }}>Read locally.</b> {c.sources.map((s) => `${s.label}: ${n(s.mainThreads)} main threads from ${n(s.files)} files`).join('; ')}. Every retained file was read; nothing was sampled.
          </p>
          <p>
            <b style={{ color: 'var(--ink)' }}>Left out.</b> {n(c.sources.reduce((a, s) => a + s.automatedThreads, 0))} automated runs, hidden reasoning, tool output and injected context. {n(c.sources.reduce((a, s) => a + s.subagentFiles, 0))} subagent transcripts were read for their token counts only.
          </p>
          {ret && !ret.configured && ret.claudeSessions > ret.transcriptSessions && (
            <p>
              <b style={{ color: 'var(--warn)' }}>Missing history.</b> Claude Code deletes transcripts after {ret.retentionDays} days. Its own stats count {n(ret.claudeSessions)} sessions since {fmtDate(ret.claudeSince || '')}; {n(ret.transcriptSessions)} are still on disk. Add <span class="mono">"cleanupPeriodDays": 365</span> to <span class="mono">~/.claude/settings.json</span> to keep a year.
            </p>
          )}
        </div>
        <div class="note" style={{ fontSize: '13.5px' }}>
          <p>
            <b style={{ color: 'var(--ink)' }}>What it doesn’t claim.</b> Active days aren’t hours worked. Silence isn’t approval. A redirect means you changed course, not that you were right. A model’s steer rate describes your history with it, not the model.
          </p>
          <p>
            <b style={{ color: 'var(--ink)' }}>Rules, not vibes.</b> Steers, themes, intents and your type come from stated rules over your words. Hover any label for the rule; the Data tab has every definition.
          </p>
        </div>
      </div>
    </Sec>
  )
}
