import { render } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import type { EvidenceRef } from '../../src/report-types.ts'
import { api, type Boot, type Budget, type ProviderId, type Receipt, type StatsStatus } from './api.ts'
import { DataView } from './data.tsx'
import { EvidenceContext, EvidenceDrawer } from './evidence.tsx'
import { Wordmark } from './brand.tsx'
import { Recap } from './recap.tsx'
import { ShareModal } from './share.tsx'

type Tab = 'recap' | 'data'
const readTab = (): Tab => (location.hash === '#data' ? 'data' : 'recap')

function App() {
  const [boot, setBoot] = useState<Boot | null>(null)
  const [error, setError] = useState<{ text: string; hint?: string } | null>(null)
  const [tab, setTab] = useState<Tab>(readTab())
  const [share, setShare] = useState<string | null>(null)
  const [evidence, setEvidence] = useState<EvidenceRef | null>(null)
  const [toastMsg, setToast] = useState<{ m: string; err?: boolean } | null>(null)
  const [budget, setBudget] = useState<Budget>({ used: 0, limit: 3, busy: false })
  const [stats, setStats] = useState<StatsStatus | null>(null)
  const [receipts, setReceipts] = useState<Receipt[]>([])
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light')

  useEffect(() => {
    api.boot().then(
      (b) => {
        setBoot(b)
        setBudget(b.budget)
        setStats(b.stats)
        setReceipts(b.receipts || [])
      },
      // a used or stale link says what to do itself; anything else is likely lore having stopped
      (e) => setError(e.status === 403 ? { text: e.message } : { text: `Couldn’t load the report: ${e.message || e}`, hint: 'Is lore still running in your terminal?' }),
    )
    const onHash = () => {
      const t = location.hash.replace('#', '')
      if (t === 'data' || t === '' || t === 'recap') setTab(readTab())
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const toast = useCallback((m: string, err?: boolean) => {
    setToast({ m, err })
    setTimeout(() => setToast((t) => (t?.m === m ? null : t)), 3800)
  }, [])

  const go = (t: Tab) => {
    history.replaceState(null, '', t === 'recap' ? location.pathname + location.search : `#${t}`)
    setTab(t)
    window.scrollTo({ top: 0 })
  }

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem('lore-theme', next)
    } catch {}
  }

  const narrate = async (p: ProviderId, tone: 'recap' | 'roast' = 'recap') => {
    const res = await api.narrative(p, tone)
    setBoot((b) => (b ? { ...b, narrative: res.narrative } : b))
    setBudget(res.budget)
    if (res.receipt) setReceipts((rs) => [res.receipt!, ...rs])
  }

  const openEvidence = (ref: EvidenceRef) => setEvidence(ref)

  if (error)
    return (
      <div class="loading">
        <div>
          <p>{error.text}</p>
          {error.hint && <p class="muted">{error.hint}</p>}
        </div>
      </div>
    )
  if (!boot || !stats)
    return (
      <div class="loading">
        <span>
          <span class="spinner" /> reading your history…
        </span>
      </div>
    )

  return (
    <EvidenceContext.Provider value={openEvidence}>
      <header class="topbar">
        <a class="logo-link" href="#" onClick={(e) => (e.preventDefault(), go('recap'))} aria-label="lore">
          <Wordmark size={19} />
        </a>
        <nav class="tabs" role="tablist">
          {(['recap', 'data'] as Tab[]).map((t) => (
            <button class="tab" role="tab" aria-selected={tab === t} onClick={() => go(t)}>
              {t}
            </button>
          ))}
        </nav>
        <span class="spacer" />
        <span class="local-pill">running locally</span>
        <button class="btn small hide-sm" onClick={() => setShare('type')}>
          share
        </button>
        <button class="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">
          {theme === 'dark' ? '☾' : '☀'}
        </button>
      </header>

      {tab === 'recap' && <Recap report={boot.report} narrative={boot.narrative} providers={boot.providers} budget={budget} receipts={receipts} onNarrate={narrate} onShare={(k) => setShare(k || 'type')} toast={toast} />}
      {tab === 'data' && <DataView report={boot.report} stats={stats} setStats={setStats} budget={budget} receipts={receipts} toast={toast} />}

      {share && <ShareModal report={boot.report} initial={share} onClose={() => setShare(null)} toast={toast} />}
      {evidence && <EvidenceDrawer refv={evidence} onClose={() => setEvidence(null)} />}
      {toastMsg && <div class={`toast ${toastMsg.err ? 'error' : ''}`}>{toastMsg.m}</div>}
    </EvidenceContext.Provider>
  )
}

render(<App />, document.getElementById('app')!)
