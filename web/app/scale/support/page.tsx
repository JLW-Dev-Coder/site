'use client'

import { useEffect, useState } from 'react'

type Priority = 'normal' | 'high' | 'critical'
type TicketStatus = 'open' | 'awaiting' | 'closed'

interface Message {
  id: string
  body: string
  author: 'user' | 'support'
  createdAt: string
}

interface Ticket {
  ticket_id: string
  subject: string
  status: TicketStatus
  priority: Priority
  platform?: string
  account_id?: string
  email?: string
  created_at: string
  messages: Message[]
}

const STATUS_PILL: Record<TicketStatus, string> = {
  open: 'bg-emerald-900/60 text-emerald-300',
  awaiting: 'bg-amber-900/60 text-amber-300',
  closed: 'bg-slate-800 text-slate-400',
}

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Open',
  awaiting: 'Awaiting Response',
  closed: 'Closed',
}

const PRIORITY_PILL: Record<Priority, string> = {
  normal: 'bg-slate-800 text-slate-400',
  high: 'bg-orange-900/60 text-orange-300',
  critical: 'bg-red-900/60 text-red-300',
}

const FOLDERS: { key: 'all' | TicketStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open' },
  { key: 'awaiting', label: 'Awaiting Response' },
  { key: 'closed', label: 'Closed' },
]

export default function ScaleSupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState<'all' | TicketStatus>('all')
  const [platform, setPlatform] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [usingPlaceholder, setUsingPlaceholder] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        // Try a privileged all-tickets endpoint first
        const res = await fetch('https://api.virtuallaunch.pro/v1/admin/support/tickets', {
          credentials: 'include',
        })
        if (res.ok) {
          const data = await res.json()
          const list: Ticket[] = Array.isArray(data) ? data : (data.tickets ?? [])
          setTickets(list)
        } else {
          // Fallback: load operator's own tickets
          const sessionRes = await fetch('https://api.virtuallaunch.pro/v1/auth/session', { credentials: 'include' })
          if (sessionRes.ok) {
            const session = await sessionRes.json()
            const aid = session.session?.account_id ?? session.account_id
            if (aid) {
              const r2 = await fetch(`https://api.virtuallaunch.pro/v1/support/tickets/by-account/${aid}`, { credentials: 'include' })
              if (r2.ok) {
                const data = await r2.json()
                const list: Ticket[] = Array.isArray(data) ? data : (data.tickets ?? [])
                setTickets(list)
              }
            }
          }
          setUsingPlaceholder(true)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load tickets')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function handleSend() {
    if (!selected || !reply.trim()) return
    setSending(true)
    setError(null)
    try {
      const res = await fetch(`https://api.virtuallaunch.pro/v1/admin/support/tickets/${selected.ticket_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: reply.trim() }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        setError(err.message || `Failed to send response (${res.status})`)
        return
      }
      const data = await res.json()
      const t: Ticket = data.ticket
      setTickets((prev) => prev.map((p) => (p.ticket_id === t.ticket_id ? t : p)))
      setSelected(t)
      setReply('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to send response')
    } finally {
      setSending(false)
    }
  }

  const platforms = Array.from(new Set(tickets.map((t) => t.platform || 'vlp')))

  const filtered = tickets.filter((t) => {
    const matchFolder = folder === 'all' || t.status === folder
    const matchPlatform = platform === 'all' || (t.platform || 'vlp') === platform
    const q = search.toLowerCase()
    const matchSearch = !q || t.subject.toLowerCase().includes(q) || (t.email || '').toLowerCase().includes(q)
    return matchFolder && matchPlatform && matchSearch
  })

  const counts: Record<string, number> = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    awaiting: tickets.filter((t) => t.status === 'awaiting').length,
    closed: tickets.filter((t) => t.status === 'closed').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">Support — All Platforms</h1>
          <p className="mt-1 text-sm text-slate-400">
            Cross-platform support ticket inbox
          </p>
        </div>
      </div>

      {usingPlaceholder && (
        <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 px-4 py-3 text-xs text-amber-300">
          Note: <code>/v1/admin/support/tickets</code> not yet implemented in Worker — showing operator&apos;s own tickets only. Add the admin route to see cross-platform tickets.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-900/60 bg-red-950/30 px-4 py-3 text-xs text-red-300">{error}</div>
      )}

      <div className="flex h-[calc(100vh-220px)] min-h-0 gap-0 rounded-2xl border border-slate-800/60 overflow-hidden">
        {/* Folders */}
        <div className="w-56 shrink-0 border-r border-slate-800/60 flex flex-col py-4 px-3 gap-1 bg-slate-950">
          <div className="mb-3 px-1">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Status</div>
          </div>
          {FOLDERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFolder(f.key)}
              className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
                folder === f.key ? 'bg-slate-800 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-white'
              }`}
            >
              <span>{f.label}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
                folder === f.key ? 'bg-slate-700 text-white' : 'bg-slate-800/80 text-slate-500'
              }`}>{counts[f.key]}</span>
            </button>
          ))}

          <div className="mt-4 mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Platform</div>
          <button
            type="button"
            onClick={() => setPlatform('all')}
            className={`rounded-lg px-3 py-1.5 text-left text-sm transition ${platform === 'all' ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
          >All platforms</button>
          {platforms.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className={`rounded-lg px-3 py-1.5 text-left text-sm uppercase transition ${platform === p ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >{p}</button>
          ))}
        </div>

        {/* List */}
        <div className="flex flex-1 flex-col min-w-0 border-r border-slate-800/60">
          <div className="px-4 pt-4 pb-3 border-b border-slate-800/60">
            <input
              type="text"
              placeholder="Search subject or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
            />
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
            {loading ? (
              <div className="p-6 text-sm text-slate-500">Loading…</div>
            ) : filtered.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">No tickets match.</div>
            ) : (
              filtered.map((t) => (
                <button
                  key={t.ticket_id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={`w-full text-left px-4 py-3.5 transition hover:bg-slate-900/60 ${selected?.ticket_id === t.ticket_id ? 'bg-slate-800/60' : ''}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-semibold text-white truncate">{t.subject}</span>
                    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_PILL[t.status]}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                    <span className={`rounded px-1.5 py-0.5 uppercase ${PRIORITY_PILL[t.priority]}`}>{t.priority}</span>
                    <span className="uppercase">{t.platform || 'vlp'}</span>
                    {t.email && <span className="truncate">{t.email}</span>}
                    <span className="ml-auto">{new Date(t.created_at).toLocaleDateString()}</span>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="w-96 shrink-0 flex flex-col bg-slate-950">
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-8 text-center">
              <p className="text-sm text-slate-500">Select a ticket to view the conversation.</p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-800/60 px-5 py-4">
                <h2 className="text-sm font-bold text-white leading-snug">{selected.subject}</h2>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-2.5 py-1 font-semibold ${STATUS_PILL[selected.status]}`}>{STATUS_LABEL[selected.status]}</span>
                  <span className={`rounded-full px-2.5 py-1 font-semibold capitalize ${PRIORITY_PILL[selected.priority]}`}>{selected.priority}</span>
                  <span className="self-center text-slate-500">{(selected.platform || 'vlp').toUpperCase()}</span>
                </div>
                {selected.email && <div className="mt-2 text-xs text-slate-500">{selected.email}</div>}
              </div>
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
                {(selected.messages ?? []).length === 0 ? (
                  <p className="text-xs text-slate-500">No messages yet.</p>
                ) : (
                  (selected.messages ?? []).map((msg) => (
                    <div key={msg.id} className={`flex ${msg.author === 'support' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.author === 'support' ? 'bg-amber-500/20 text-amber-100' : 'bg-slate-800/80 text-slate-300'
                      }`}>
                        <p className="leading-relaxed whitespace-pre-wrap">{msg.body}</p>
                        <p className={`mt-1 text-xs ${msg.author === 'support' ? 'text-amber-400/60' : 'text-slate-500'}`}>
                          {msg.createdAt ? new Date(msg.createdAt).toLocaleString() : ''}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="border-t border-slate-800/60 px-4 py-3 space-y-2">
                <textarea
                  rows={3}
                  value={reply}
                  onChange={(e) => setReply(e.target.value)}
                  placeholder="Type your response…"
                  className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none resize-none"
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !reply.trim()}
                  className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
                >
                  {sending ? 'Sending…' : 'Send Response'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
