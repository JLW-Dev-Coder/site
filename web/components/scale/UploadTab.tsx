'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { uploadProspectCSV, getScaleStatus } from '@/lib/api/scale'
import styles from '@/app/scale/page.module.css'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
  totalRows: number
  credentialCounts: Record<string, number>
  duplicateEmails: number
  invalidStatusRows: number
}

interface UploadResult {
  ok: boolean
  stored?: number
  deduped?: number
  already_sent?: number
  filtered_invalid?: number
  date?: string
  error?: string
  missing?: string[]
}

interface PipelineStatus {
  ok: boolean
  pending_csvs?: number
  pending_prospects?: number
  email1_queued?: number
  email1_sent_today?: number
  email1_sent_total?: number
  email2_queued?: number
  asset_pages_live?: number
  last_batch_date?: string | null
  pipeline_healthy?: boolean
}

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields per RFC 4180
// ---------------------------------------------------------------------------
function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let i = 0
  const len = text.length

  while (i < len) {
    const row: string[] = []
    while (i < len) {
      let value = ''
      if (text[i] === '"') {
        // quoted field
        i++ // skip opening quote
        while (i < len) {
          if (text[i] === '"') {
            if (i + 1 < len && text[i + 1] === '"') {
              value += '"'
              i += 2
            } else {
              i++ // skip closing quote
              break
            }
          } else {
            value += text[i]
            i++
          }
        }
      } else {
        // unquoted field
        while (i < len && text[i] !== ',' && text[i] !== '\r' && text[i] !== '\n') {
          value += text[i]
          i++
        }
      }
      row.push(value.trim())

      if (i < len && text[i] === ',') {
        i++ // skip comma
      } else {
        break
      }
    }
    // skip line endings
    if (i < len && text[i] === '\r') i++
    if (i < len && text[i] === '\n') i++

    // skip empty trailing rows
    if (row.length > 0 && !(row.length === 1 && row[0] === '')) {
      rows.push(row)
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
const REQUIRED_COLUMNS = [
  'LAST_NAME', 'First_NAME', 'BUS_ADDR_CITY', 'BUS_ST_CODE',
  'PROFESSION', 'email_found', 'email_status', 'firm_bucket',
]
const VALID_PROFESSIONS = ['CPA', 'EA', 'ATTY', 'JD']

function validateCSV(file: File, text: string): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  // 1. Extension check
  if (!file.name.toLowerCase().endsWith('.csv')) {
    errors.push('File must have a .csv extension')
  }

  // 2. Size check
  if (file.size > 5 * 1024 * 1024) {
    errors.push(`File size ${(file.size / (1024 * 1024)).toFixed(1)}MB exceeds 5MB limit`)
  }

  const rows = parseCSV(text)
  if (rows.length === 0) {
    errors.push('File is empty')
    return { valid: false, errors, warnings, totalRows: 0, credentialCounts: {}, duplicateEmails: 0, invalidStatusRows: 0 }
  }

  // 3. Headers
  const headers = rows[0]

  // 4. Required columns
  const missing = REQUIRED_COLUMNS.filter(col => !headers.includes(col))
  if (missing.length > 0) {
    errors.push(`Missing required columns: ${missing.join(', ')}`)
  }

  // 5. Data rows
  const dataRows = rows.slice(1)
  if (dataRows.length === 0) {
    errors.push('No data rows found after headers')
    return { valid: errors.length === 0, errors, warnings, totalRows: 0, credentialCounts: {}, duplicateEmails: 0, invalidStatusRows: 0 }
  }

  // Column indices
  const colIdx: Record<string, number> = {}
  for (const col of REQUIRED_COLUMNS) {
    colIdx[col] = headers.indexOf(col)
  }

  const credentialCounts: Record<string, number> = {}
  const emails = new Set<string>()
  let duplicateEmails = 0
  let invalidStatusRows = 0

  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r]
    const rowNum = r + 2 // 1-indexed + header

    // 6. email_found check
    if (colIdx.email_found >= 0) {
      const email = row[colIdx.email_found] ?? ''
      if (!email || !email.includes('@')) {
        errors.push(`Row ${rowNum}: empty or invalid email_found`)
      } else {
        const lower = email.toLowerCase()
        if (emails.has(lower)) {
          duplicateEmails++
        } else {
          emails.add(lower)
        }
      }
    }

    // 7. PROFESSION check
    if (colIdx.PROFESSION >= 0) {
      const prof = (row[colIdx.PROFESSION] ?? '').trim()
      if (prof && !VALID_PROFESSIONS.includes(prof)) {
        errors.push(`Row ${rowNum}: PROFESSION '${prof}' is not valid (expected CPA, EA, ATTY, or JD)`)
      }
      if (prof) {
        const normalized = prof === 'JD' ? 'ATTY' : prof
        credentialCounts[normalized] = (credentialCounts[normalized] || 0) + 1
      }
    }

    // 8. email_status check
    if (colIdx.email_status >= 0) {
      const status = (row[colIdx.email_status] ?? '').trim()
      if (status !== 'valid') {
        invalidStatusRows++
      }
    }
  }

  if (invalidStatusRows > 0) {
    warnings.push(`${invalidStatusRows} rows have email_status other than 'valid' (will be filtered out)`)
  }
  if (duplicateEmails > 0) {
    warnings.push(`${duplicateEmails} duplicate emails (will be deduped)`)
  }

  // Cap error reporting at 20
  if (errors.length > 20) {
    const total = errors.length
    errors.length = 20
    errors.push(`... and ${total - 20} more errors`)
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    totalRows: dataRows.length,
    credentialCounts,
    duplicateEmails,
    invalidStatusRows,
  }
}

// ---------------------------------------------------------------------------
// Preview table
// ---------------------------------------------------------------------------
function PreviewTable({ text }: { text: string }) {
  const rows = parseCSV(text)
  if (rows.length < 2) return null

  const headers = rows[0]
  const nameIdx = headers.indexOf('First_NAME')
  const lastIdx = headers.indexOf('LAST_NAME')
  const firmIdx = headers.indexOf('firm_bucket')
  const cityIdx = headers.indexOf('BUS_ADDR_CITY')
  const stateIdx = headers.indexOf('BUS_ST_CODE')
  const emailIdx = headers.indexOf('email_found')
  const credIdx = headers.indexOf('PROFESSION')

  const previewRows = rows.slice(1, 6)

  return (
    <div className={styles.tableContainer} style={{ marginTop: '1rem' }}>
      <table className={styles.glassTable}>
        <thead>
          <tr>
            <th>Name</th>
            <th>Firm</th>
            <th>City/State</th>
            <th>Email</th>
            <th>Credential</th>
          </tr>
        </thead>
        <tbody>
          {previewRows.map((row, i) => (
            <tr key={i}>
              <td>{nameIdx >= 0 ? row[nameIdx] : ''} {lastIdx >= 0 ? row[lastIdx] : ''}</td>
              <td>{firmIdx >= 0 ? row[firmIdx] : ''}</td>
              <td>{cityIdx >= 0 ? row[cityIdx] : ''}{stateIdx >= 0 ? `, ${row[stateIdx]}` : ''}</td>
              <td style={{ fontSize: '0.8rem' }}>{emailIdx >= 0 ? row[emailIdx] : ''}</td>
              <td>{credIdx >= 0 ? row[credIdx] : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 6 && (
        <p style={{ fontSize: '0.7rem', color: 'rgba(148,163,184,0.6)', marginTop: '0.5rem', textAlign: 'center' }}>
          Showing 5 of {rows.length - 1} rows
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pipeline Status Panel
// ---------------------------------------------------------------------------
function PipelineStatusPanel({ status, loading, onRefresh }: {
  status: PipelineStatus | null
  loading: boolean
  onRefresh: () => void
}) {
  return (
    <div className={styles.glassCard}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div className={styles.glassCardTitle} style={{ marginBottom: 0 }}>Pipeline Status</div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className={styles.uploadRefreshBtn}
          title="Refresh status"
        >
          {loading ? (
            <svg className={styles.spinner} viewBox="0 0 24 24" style={{ width: 14, height: 14 }}>
              <circle className={styles.spinnerCircle} cx="12" cy="12" r="10" />
            </svg>
          ) : (
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          )}
        </button>
      </div>

      {!status || !status.ok ? (
        <div className={styles.glassCardMuted}>
          {loading ? 'Loading pipeline status...' : 'Unable to load pipeline status'}
        </div>
      ) : (
        <div className={styles.uploadStatusGrid}>
          <StatusCard label="Pending CSVs" value={status.pending_csvs ?? 0} />
          <StatusCard label="Prospects in Queue" value={status.pending_prospects ?? 0} />
          <StatusCard label="Email 1 Queued" value={status.email1_queued ?? 0} accent={status.email1_queued ? 'yellow' : undefined} />
          <StatusCard label="Email 1 Sent Today" value={status.email1_sent_today ?? 0} accent={status.email1_sent_today ? 'green' : undefined} />
          <StatusCard label="Email 1 Sent Total" value={status.email1_sent_total ?? 0} accent="green" />
          <StatusCard label="Email 2 Queued" value={status.email2_queued ?? 0} />
          <StatusCard label="Asset Pages Live" value={status.asset_pages_live ?? 0} accent={status.asset_pages_live ? 'green' : undefined} />
          <StatusCard label="Last Batch" value={status.last_batch_date ?? 'No batches yet'} />
          <StatusCard
            label="Pipeline Health"
            value={status.pipeline_healthy ? 'Healthy' : 'Issue'}
            accent={status.pipeline_healthy ? 'green' : 'red'}
          />
        </div>
      )}
    </div>
  )
}

function StatusCard({ label, value, accent }: { label: string; value: string | number; accent?: 'green' | 'yellow' | 'red' }) {
  const colorClass = accent === 'green' ? styles.statusGreen : accent === 'red' ? styles.statusRed : accent === 'yellow' ? styles.statusYellow : ''
  return (
    <div className={styles.uploadStatCard}>
      <div className={`${styles.uploadStatValue} ${colorClass}`}>{value}</div>
      <div className={styles.uploadStatLabel}>{label}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main UploadTab component
// ---------------------------------------------------------------------------
export default function UploadTab() {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [fileText, setFileText] = useState<string | null>(null)
  const [validation, setValidation] = useState<ValidationResult | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  // Pipeline status
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  const fetchStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const data = await getScaleStatus()
      setPipelineStatus(data)
    } catch {
      setPipelineStatus(null)
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // ---- File selection ----
  const handleFile = useCallback((f: File) => {
    setFile(f)
    setUploadResult(null)
    setUploadError(null)
    setValidation(null)

    const reader = new FileReader()
    reader.onload = () => {
      const text = reader.result as string
      setFileText(text)
      setValidation(validateCSV(f, text))
    }
    reader.readAsText(f)
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setDragOver(false), [])

  const handleBrowse = () => fileInputRef.current?.click()

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const handleReset = () => {
    setFile(null)
    setFileText(null)
    setValidation(null)
    setUploadResult(null)
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // ---- Upload ----
  const handleUpload = async () => {
    if (!fileText) return
    setUploading(true)
    setUploadError(null)
    setUploadResult(null)
    try {
      const result = await uploadProspectCSV(fileText)
      if (result.ok) {
        setUploadResult(result)
        fetchStatus()
      } else {
        setUploadError(result.error ?? 'Upload failed')
      }
    } catch (err) {
      setUploadError(String(err))
    } finally {
      setUploading(false)
    }
  }

  const canUpload = validation?.valid && !uploading && !uploadResult

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <div className={styles.glassCard}>
        <div className={styles.glassCardTitle}>Upload Clay CSV</div>

        {/* Success banner */}
        {uploadResult && (
          <div className={styles.uploadBannerSuccess}>
            <svg style={{ width: 20, height: 20, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Upload successful</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>
                Uploaded {uploadResult.stored ?? 0} prospects
                {uploadResult.deduped ? ` (${uploadResult.deduped} deduped)` : ''}
                {uploadResult.already_sent ? `, ${uploadResult.already_sent} already sent` : ''}
                {uploadResult.filtered_invalid ? `, ${uploadResult.filtered_invalid} filtered invalid` : ''}
              </div>
              {uploadResult.date && (
                <div style={{ fontSize: '0.75rem', opacity: 0.8, marginTop: '0.15rem' }}>
                  Batch date: {uploadResult.date} &middot; Next campaign run: 12:00 UTC today
                </div>
              )}
            </div>
          </div>
        )}

        {/* Error banner */}
        {uploadError && (
          <div className={styles.uploadBannerError}>
            <svg style={{ width: 20, height: 20, flexShrink: 0 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Upload failed</div>
              <div style={{ fontSize: '0.8rem', opacity: 0.9 }}>{uploadError}</div>
            </div>
          </div>
        )}

        {/* Dropzone */}
        {!uploadResult && (
          <div
            className={`${styles.uploadDropzone} ${dragOver ? styles.uploadDropzoneActive : ''}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={handleBrowse}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleInputChange}
              style={{ display: 'none' }}
            />
            {file ? (
              <div className={styles.uploadFileInfo}>
                <svg style={{ width: 28, height: 28, color: 'rgb(249,115,22)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <div>
                  <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>{file.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.7)' }}>
                    {(file.size / 1024).toFixed(1)} KB
                  </div>
                </div>
              </div>
            ) : (
              <div className={styles.uploadDropzoneContent}>
                <svg style={{ width: 36, height: 36, color: 'rgba(148,163,184,0.5)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                <div style={{ fontWeight: 600, color: 'rgba(255,255,255,0.8)' }}>
                  Drag &amp; drop a CSV file here
                </div>
                <div style={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.6)' }}>
                  or click to browse &middot; .csv only &middot; max 5MB
                </div>
              </div>
            )}
          </div>
        )}

        {/* Validation errors */}
        {validation && !validation.valid && (
          <div className={styles.uploadValidationError}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
              Validation errors
            </div>
            <ul style={{ margin: 0, paddingLeft: '1.25rem', fontSize: '0.8rem' }}>
              {validation.errors.map((err, i) => (
                <li key={i} style={{ marginBottom: '0.2rem' }}>{err}</li>
              ))}
            </ul>
            {validation.warnings.length > 0 && (
              <ul style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem', fontSize: '0.8rem', color: 'rgb(251,191,36)' }}>
                {validation.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: '0.2rem' }}>{w}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              onClick={handleReset}
              className={styles.uploadChooseDifferent}
            >
              Choose different file
            </button>
          </div>
        )}

        {/* Validation success — summary + preview */}
        {validation && validation.valid && !uploadResult && (
          <div className={styles.uploadValidationSuccess}>
            <div style={{ fontWeight: 700, marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Ready to upload
            </div>
            <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'rgba(255,255,255,0.95)' }}>
              {validation.totalRows.toLocaleString()} prospects ready
            </div>
            <div style={{ fontSize: '0.8rem', color: 'rgba(148,163,184,0.85)', marginTop: '0.25rem' }}>
              {Object.entries(validation.credentialCounts).map(([k, v]) => `${v} ${k}`).join(' \u00B7 ')}
            </div>
            {(validation.duplicateEmails > 0 || validation.invalidStatusRows > 0) && (
              <div style={{ fontSize: '0.75rem', color: 'rgba(148,163,184,0.6)', marginTop: '0.25rem' }}>
                {validation.duplicateEmails > 0 && `${validation.duplicateEmails} duplicate emails (will be deduped)`}
                {validation.duplicateEmails > 0 && validation.invalidStatusRows > 0 && ' \u00B7 '}
                {validation.invalidStatusRows > 0 && `${validation.invalidStatusRows} invalid email_status rows`}
              </div>
            )}

            {fileText && <PreviewTable text={fileText} />}
          </div>
        )}

        {/* Action buttons */}
        {!uploadResult && (
          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!canUpload}
              className={styles.uploadButton}
            >
              {uploading ? (
                <>
                  <svg className={styles.spinner} viewBox="0 0 24 24" style={{ width: 16, height: 16 }}>
                    <circle className={styles.spinnerCircle} cx="12" cy="12" r="10" />
                  </svg>
                  Uploading...
                </>
              ) : (
                <>
                  <svg style={{ width: 16, height: 16 }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                  Upload CSV
                </>
              )}
            </button>
            {file && !uploading && (
              <button type="button" onClick={handleReset} className={styles.uploadResetButton}>
                Choose different file
              </button>
            )}
          </div>
        )}

        {/* After upload success — option to upload another */}
        {uploadResult && (
          <div style={{ marginTop: '1rem' }}>
            <button type="button" onClick={handleReset} className={styles.uploadResetButton}>
              Upload another CSV
            </button>
          </div>
        )}
      </div>

      {/* Pipeline status panel */}
      <PipelineStatusPanel status={pipelineStatus} loading={statusLoading} onRefresh={fetchStatus} />
    </div>
  )
}
