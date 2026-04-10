'use client'

import { useEffect, useState } from 'react'
import { renderMarkdown } from '@/components/scale/MarkdownRenderer'
import styles from '../page.module.css'

export default function WorkflowPage() {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('https://api.virtuallaunch.pro/v1/admin/scale/workflow', { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.text()
      })
      .then((text) => {
        if (!cancelled) setMarkdown(text)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load WORKFLOW.md')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Workflow</h1>
        <p className="mt-1 text-sm text-slate-500 italic">
          Synced from <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded border border-white/10 text-amber-400/90">scale/WORKFLOW.md</code> — push updates via <code className="text-xs bg-white/5 px-1.5 py-0.5 rounded border border-white/10 text-amber-400/90">node scale/push-workflow.js</code>
        </p>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16">
          <svg className={styles.spinner} viewBox="0 0 24 24" style={{ width: 28, height: 28 }}>
            <circle className={styles.spinnerCircle} cx="12" cy="12" r="10" />
          </svg>
        </div>
      )}

      {error && (
        <div className="text-center py-12 text-red-400/90 text-sm">Error: {error}</div>
      )}

      {!loading && !error && markdown !== null && (
        <div
          className={styles.workflowMarkdown}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(markdown) }}
        />
      )}
    </div>
  )
}
