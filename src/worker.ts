import { parentPort, workerData } from 'node:worker_threads'
import { parseJob } from './pipeline/scan.ts'
import { runPane } from './terminal.ts'

// lore's one worker file, two jobs: the live pane (see livePane in terminal.ts), or parsing
// one discovered file per message (see runPool in pipeline/scan.ts).
if (workerData?.pane) runPane(workerData.pane)
else
  parentPort!.on('message', async (job) => {
    const outcome = await parseJob(job).catch((e) => ({ kind: 'error', message: String(e?.message || e) }))
    parentPort!.postMessage(outcome)
  })
