'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseCsv, toStayRows, type ParseProblem, type StayImportRow } from '@/lib/csv'
import { importStays, type ImportResult } from './actions'

// Reads the CSV in the browser, shows what will be imported, then sends the
// rows to the database in one call. Re-importing the same file is safe.
export default function ImportStays({ today }: { today: string }) {
  const router = useRouter()
  const [fileName, setFileName] = useState<string | null>(null)
  const [rows, setRows] = useState<StayImportRow[]>([])
  const [problems, setProblems] = useState<ParseProblem[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [result, setResult] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(file: File | undefined) {
    setResult(null)
    if (!file) return
    if (file.size > 2_000_000) {
      setMissing([])
      setRows([])
      setProblems([{ line: 0, message: 'File is larger than 2 MB. Export a shorter date range.' }])
      return
    }
    setFileName(file.name)
    const parsed = toStayRows(parseCsv(await file.text()), today)
    setRows(parsed.rows)
    setProblems(parsed.problems)
    setMissing(parsed.missingColumns)
  }

  async function onImport() {
    setBusy(true)
    const r = await importStays(rows)
    setBusy(false)
    setResult(r)
    if (!r.error) {
      setRows([])
      router.refresh()
    }
  }

  const counts = {
    in_house: rows.filter((r) => r.status === 'in_house').length,
    departed: rows.filter((r) => r.status === 'departed').length,
    cancelled: rows.filter((r) => r.status === 'cancelled').length,
  }

  return (
    <div className="space-y-3">
      <p className="text-sm">
        Upload the PMS arrivals / in-house / departures report, or a Google Sheet saved as CSV (File → Download →
        CSV). Needed columns: <strong>Room, Confirmation number, Surname, Check-in date, Check-out date</strong>.
        Optional: Status (In house / Departed / Cancelled) and Actual departure time.
      </p>
      <a href="/stays-import-template.csv" download className="text-sm font-semibold text-teal underline">
        Download a template
      </a>
      <div>
        <label htmlFor="stays-file" className="label">CSV file</label>
        <input
          id="stays-file"
          type="file"
          accept=".csv,text/csv"
          className="field py-2"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
      </div>

      {missing.length > 0 && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          {fileName} is missing these columns: {missing.join(', ')}.
        </p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg bg-teal-soft p-3 text-sm">
          <p className="font-semibold">
            Ready to import {rows.length} stay{rows.length === 1 ? '' : 's'} from {fileName}
          </p>
          <p>
            {counts.in_house} in house · {counts.departed} departed · {counts.cancelled} cancelled. Blank statuses were
            set from the dates.
          </p>
          <button type="button" className="btn btn-primary mt-3" disabled={busy} onClick={onImport}>
            {busy ? 'Importing…' : `Import ${rows.length} stays`}
          </button>
        </div>
      )}

      {problems.length > 0 && (
        <details className="rounded-lg border border-attention p-3 text-sm" open={rows.length === 0}>
          <summary className="cursor-pointer font-semibold text-attention">
            {problems.length} line{problems.length === 1 ? '' : 's'} can’t be read and will be skipped
          </summary>
          <ul className="mt-2 space-y-1">
            {problems.slice(0, 50).map((p) => (
              <li key={`${p.line}-${p.message}`}>{p.line > 0 ? `Line ${p.line}: ` : ''}{p.message}</li>
            ))}
          </ul>
        </details>
      )}

      {result?.error && (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{result.error}</p>
      )}
      {result && !result.error && (
        <div role="status" className="rounded-lg bg-done-soft p-3 text-sm text-done">
          <p className="font-semibold">Imported {result.saved} stay{result.saved === 1 ? '' : 's'}.</p>
          {(result.failed ?? 0) > 0 && (
            <>
              <p className="mt-1 text-ink">{result.failed} rejected by the database:</p>
              <ul className="mt-1 space-y-1 text-ink">
                {result.errors?.slice(0, 50).map((e) => (
                  <li key={e.row}>Row {e.row}: {e.message}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
