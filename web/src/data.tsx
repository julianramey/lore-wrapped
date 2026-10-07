import { useState } from 'preact/hooks'
import type { Report } from '../../src/report-types.ts'
import { api, type Budget, type Receipt, type StatsStatus } from './api.ts'
import { big, fmtDate, n, pct, SOURCE_LABEL, sourceVar } from './format.ts'
import { ReceiptCard } from './recap.tsx'

export function DataView({ report: r, stats, setStats, budget, receipts, toast }: { report: Report; stats: StatsStatus; setStats: (s: StatsStatus) => void; budget: Budget; receipts: Receipt[]; toast: (m: string, err?: boolean) => void }) {
  const exportJson = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'lore-report.json'
    a.click()
    URL.revokeObjectURL(url)
  }
  return (
    <main class="frame">
      <section class="band">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', gap: '20px', flexWrap: 'wrap' }}>
          <div>
            <span class="label">
              <b>●</b> every number, its definition, and what leaves this machine
            </span>
            <h2 style={{ fontWeight: 300, fontSize: '40px', letterSpacing: '-0.03em', margin: '10px 0 0' }}>Data</h2>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button class="btn small" onClick={exportJson}>
              export report JSON
            </button>
          </div>
        </div>
      </section>
      <section class="band">
        <div class="data-grid">
          <div class="panel wide">
            <h3>Coverage</h3>
            <p class="note">What was found, what was read, and what was left out on purpose. Not sampled.</p>
            <table class="dt">
              <thead>
                <tr>
                  <th>source</th>
                  <th>location</th>
                  <th class="n">files</th>
                  <th class="n">archived</th>
                  <th class="n">main threads</th>
                  <th class="n">desktop</th>
                  <th class="n">subagent files (tokens only)</th>
                  <th class="n">automated</th>
                  <th class="n">size</th>
                  <th>range</th>
                </tr>
              </thead>
              <tbody>
                {r.coverage.sources.filter((c) => c.found || c.source === 'claude-code' || c.source === 'codex').map((c) => (
                  <tr>
                    <td>
                      <span class="src">
                        <i style={{ background: sourceVar(c.source) }} />
                        {c.label}
                      </span>
                      {c.warnings.length > 0 && (
                        <ul class="warnings">
                          {c.warnings.slice(0, 3).map((w) => (
                            <li>! {w}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td class="mono note">{c.found ? c.root.replace(/^(\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/i, '~') : 'not found'}</td>
                    <td class="n">{n(c.files)}</td>
                    <td class="n">{n(c.archivedFiles)}</td>
                    <td class="n">{n(c.mainThreads)}</td>
                    <td class="n">{n(c.desktopThreads)}</td>
                    <td class="n">{n(c.subagentFiles)}</td>
                    <td class="n">{n(c.automatedThreads)}</td>
                    <td class="n">{(c.bytes / 1e9).toFixed(1)} GB</td>
                    <td class="note">{c.firstAt ? `${fmtDate(c.firstAt)} → ${fmtDate(c.lastAt!)}` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {r.deep.retention && (
              <p class="note" style={{ marginTop: '10px' }}>
                Claude’s own stats: {n(r.deep.retention.claudeSessions)} sessions since {fmtDate(r.deep.retention.claudeSince || '')}; transcripts kept {r.deep.retention.retentionDays} days
                {r.deep.retention.configured ? ' (your setting)' : ' (default)'}.
              </p>
            )}
          </div>

          <div class="panel two">
            <h3>Steer rate by model</h3>
            <p class="note">{r.definitions.steerByModel}</p>
            <table class="dt">
              <thead>
                <tr>
                  <th>model</th>
                  <th>tool</th>
                  <th class="n">follow-ups</th>
                  <th class="n">redirects</th>
                  <th class="n">rate</th>
                  <th class="n">interrupts</th>
                </tr>
              </thead>
              <tbody>
                {r.deep.steeringByModel.map((m) => (
                  <tr>
                    <td class="mono">{m.model}</td>
                    <td>{SOURCE_LABEL[m.source]}</td>
                    <td class="n">{n(m.followups)}</td>
                    <td class="n">{n(m.steers)}</td>
                    <td class="n">{pct(m.rate, 1)}</td>
                    <td class="n">{n(m.interrupts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="panel third">
            <h3>Run receipts</h3>
            <p class="note">
              Optional model calls, measured on your plan. {budget.used}/{budget.limit} calls used this run.
            </p>
            <div style={{ display: 'grid', gap: '10px' }}>
              {receipts.length ? receipts.slice(0, 4).map((x) => <ReceiptCard receipt={x} />) : <div class="note">No model calls yet. The report itself needs none.</div>}
            </div>
          </div>

          <div class="panel">
            <h3>Tokens by model</h3>
            <table class="dt">
              <thead>
                <tr>
                  <th>model</th>
                  <th class="n">fresh in</th>
                  <th class="n">cached in</th>
                  <th class="n">out</th>
                </tr>
              </thead>
              <tbody>
                {r.deep.tokens.byModel.map((m) => (
                  <tr>
                    <td class="mono">{m.model}</td>
                    <td class="n">{big(m.input)}</td>
                    <td class="n">{big(m.cached)}</td>
                    <td class="n">{big(m.output)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div class="panel">
            <h3>Commands by category</h3>
            <table class="dt">
              <thead>
                <tr>
                  <th>category</th>
                  <th>examples</th>
                  <th class="n">count</th>
                </tr>
              </thead>
              <tbody>
                {r.deep.work.commands.categories.map((c) => (
                  <tr>
                    <td>{c.label}</td>
                    <td class="mono note" style={{ maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.examples?.join(' · ')}
                    </td>
                    <td class="n">{n(c.count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div class="panel two">
            <h3>Definitions</h3>
            <p class="note">Every number on every screen means exactly this.</p>
            <dl class="defs">
              {Object.entries(r.definitions).map(([k, v]) => (
                <div>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <StatsPanel stats={stats} setStats={setStats} toast={toast} />
        </div>
      </section>
    </main>
  )
}

function StatsPanel({ stats, setStats, toast }: { stats: StatsStatus; setStats: (s: StatsStatus) => void; toast: (m: string, err?: boolean) => void }) {
  const [busy, setBusy] = useState(false)
  const cls = stats.state === 'sent' || stats.state === 'already-sent' ? 'good' : stats.state === 'failed' ? 'bad' : stats.state === 'disabled' ? '' : 'warn'
  const label: Record<StatsStatus['state'], string> = { sent: 'sent', 'already-sent': 'sent this month', disabled: 'off', 'no-endpoint': 'no collector configured', failed: 'failed', pending: 'pending' }
  return (
    <div class="panel third">
      <h3>What we send</h3>
      <p class="note">Anonymous counts, sent when you run lore. Running it again the same month doesn't send again. Nothing runs in the background. They build the public index and rank your report. Counts only: no text, paths, project names, ids or times. This is the whole payload.</p>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' }}>
        <span class={`status-pill ${cls}`}>{label[stats.state]}</span>
        <label class="switch">
          <input
            type="checkbox"
            checked={stats.enabled}
            onChange={async (e) => {
              try {
                setStats(await api.toggleStats((e.target as HTMLInputElement).checked))
              } catch (err: any) {
                toast(err.message, true)
              }
            }}
          />
          send anonymous stats
        </label>
        <label class="switch" title="Counts across the git repos agents edited in: tests, CI, sizes, ages, hosts, licenses. No names, paths, URLs or authors.">
          <input
            type="checkbox"
            checked={stats.repoStats}
            disabled={busy}
            onChange={async (e) => {
              setBusy(true)
              try {
                setStats(await api.toggleRepoStats((e.target as HTMLInputElement).checked))
              } catch (err: any) {
                toast(err.message, true)
              } finally {
                setBusy(false)
              }
            }}
          />
          include repo stats
        </label>
      </div>
      <p class="note">{stats.detail}</p>
      {stats.repoStats ? null : <p class="note">Repo stats are off: turning them on adds counts across the repos agents edited in (tests, CI, sizes, ages, hosts, licenses), with no names, paths, URLs or authors.</p>}
      <pre class="json">{JSON.stringify(stats.payload, null, 2)}</pre>
      {stats.endpoint && stats.enabled && (
        <button
          class="btn small"
          style={{ marginTop: '10px' }}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const s = await api.sendStats()
              setStats(s)
              toast(s.state === 'sent' ? 'Stats sent' : s.detail, s.state === 'failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          send now
        </button>
      )}
    </div>
  )
}
