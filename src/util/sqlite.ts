// Read-only access to other agents' SQLite stores (OpenCode, Kilo, OpenClaw) through Node's
// built-in driver, node:sqlite: no native module to install, unflagged since Node 22.13.
// lore opens them read-only and never takes a write lock, so the agent can keep running.

import { createRequire } from 'node:module'
import zlib from 'node:zlib'

type Sqlite = typeof import('node:sqlite')
export type Db = InstanceType<Sqlite['DatabaseSync']>

let driver: Sqlite | null | undefined

function load(): Sqlite | null {
  if (driver !== undefined) return driver
  // Node 22 labels the driver experimental on first load; that note is for developers
  const emit = process.emitWarning
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    if (!String((w as Error)?.message ?? w).includes('SQLite')) (emit as (...a: unknown[]) => void).call(process, w, ...rest)
  }) as typeof process.emitWarning
  try {
    driver = createRequire(import.meta.url)('node:sqlite') as Sqlite
  } catch {
    driver = null
  } finally {
    process.emitWarning = emit
  }
  return driver
}

/** The database, opened read-only; null when it can't be opened or Node has no driver. */
export function openReadOnly(file: string): Db | null {
  const m = load()
  if (!m) return null
  try {
    return new m.DatabaseSync(file, { readOnly: true })
  } catch {
    return null
  }
}

export function tableNames(db: Db): Set<string> {
  try {
    return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name))
  } catch {
    return new Set()
  }
}

export function rows<T>(db: Db, sql: string, ...params: (string | number)[]): T[] {
  try {
    return db.prepare(sql).all(...params) as T[]
  } catch {
    return []
  }
}

/** Text from a TEXT or BLOB column, or from a zstd-compressed BLOB when this Node can inflate it. */
export function textOf(v: unknown, zstd = false): string {
  if (typeof v === 'string') return v
  if (!(v instanceof Uint8Array)) return ''
  if (!zstd) return Buffer.from(v).toString('utf8')
  const inflate = (zlib as { zstdDecompressSync?: (b: Uint8Array) => Buffer }).zstdDecompressSync
  try {
    return inflate ? inflate(v).toString('utf8') : ''
  } catch {
    return ''
  }
}
