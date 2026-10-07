import fs from 'node:fs'

const HEAD_BYTES = 768

/**
 * Streams a JSONL file without decoding lines we don't need. `want` sees the first
 * bytes of each line (latin1, enough to match ASCII keys) and decides whether the
 * full line is assembled. Multi-hundred-megabyte tool outputs are skipped at memchr speed.
 */
export async function scanLines(
  file: string,
  want: (head: string, lineNo: number) => boolean | 'stop',
  onLine: (line: Buffer, lineNo: number) => void | 'stop',
): Promise<void> {
  const stream = fs.createReadStream(file, { highWaterMark: 1 << 20 })
  let pieces: Buffer[] = []
  let size = 0
  let decided = 0 as 0 | 1 | 2 // undecided | keep | skip
  let lineNo = 1

  let stop = false
  const decide = () => {
    const joined = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces)
    pieces = [joined]
    const w = want(joined.subarray(0, HEAD_BYTES).toString('latin1'), lineNo)
    if (w === 'stop') stop = true
    decided = w === true ? 1 : 2
    if (decided === 2) {
      pieces = []
      size = 0
    }
  }

  try {
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      let pos = 0
      while (pos <= chunk.length) {
        const nl = chunk.indexOf(10, pos)
        const end = nl === -1 ? chunk.length : nl
        if (decided !== 2 && end > pos) {
          pieces.push(chunk.subarray(pos, end))
          size += end - pos
        }
        if (decided === 0 && (size >= HEAD_BYTES || nl !== -1) && size > 0) decide()
        if (stop) return
        if (nl === -1) break
        if (decided === 1 && size > 0) {
          const line = pieces.length === 1 ? pieces[0] : Buffer.concat(pieces)
          if (onLine(line, lineNo) === 'stop') {
            stream.destroy()
            return
          }
        }
        pieces = []
        size = 0
        decided = 0
        lineNo++
        pos = nl + 1
      }
    }
    if (size > 0) {
      if (decided === 0) decide()
      if (decided === 1) onLine(pieces.length === 1 ? pieces[0] : Buffer.concat(pieces), lineNo)
    }
  } finally {
    stream.destroy()
  }
}

/** Reads and parses only the first line of a file. */
export async function readFirstJsonLine(file: string): Promise<any | null> {
  let out: any = null
  await scanLines(
    file,
    () => true,
    (line) => {
      try {
        out = JSON.parse(line.toString('utf8'))
      } catch {
        out = null
      }
      return 'stop'
    },
  )
  return out
}

export function parseJson(line: Buffer): any | null {
  try {
    return JSON.parse(line.toString('utf8'))
  } catch {
    return null
  }
}
