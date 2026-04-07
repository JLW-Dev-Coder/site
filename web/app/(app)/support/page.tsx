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
  created_at: string
  messages: Message[]
}

const STATUS_DOT: Record<TicketStatus, string> = {
  open: 'bg-emerald-400',
  awaiting: 'bg-amber-400',
  closed: 'bg-slate-500',
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

const PRIORITY_OPTIONS: Priority[] = ['normal', 'high', 'critical']

export default function SupportPage() {
  const [accountId, setAccountId] = useState<string | null>(null)
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [loading, setLoading] = useState(true)
  const [folder, setFolder] = useState<'all' | TicketStatus>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Ticket | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)

  // New ticket inline form state
  const [composing, setComposing] = useState(false)
  const [newSubject, setNewSubject] = useState('')
  const [newPriority, setNewPriority] = useState<Priority>('normal')
  const [newMessage, setNewMessage] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [createSuccess, setCreateSuccess] = useState(false)

  useEffect(() => {
    async function init() {
      try {
        const sessionRes = await fetch('https://api.virtuallaunch.pro/v1/auth/session', { credentials: 'include' })
        if (!sessionRes.ok) return
        const session = await sessionRes.json()
        const aid = session.session?.account_id ?? session.account_id
        if (!aid) return
        setAccountId(aid)
        await loadTickets(aid)
      } catch {/* ignore */} finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function loadTickets(aid: string) {
    try {
      const res = await fetch(`https://api.virtuallaunch.pro/v1/support/tickets/by-account/${aid}`, { credentials: 'include' })
      if (!res.ok) return
      const data = await res.json()
      const list: Ticket[] = Array.isArray(data) ? data : (data.tickets ?? [])
      setTickets(list)
    } catch {/* ignore */}
  }

  async function handleSend() {
    if (!selected || !reply.trim() || !accountId) return
    setSending(true)
    try {
      await fetch(`https://api.virtuallaunch.pro/v1/support/tickets/${selected.ticket_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message: reply.trim() }),
      })
      setReply('')
      if (accountId) await loadTickets(accountId)
    } catch {/* ignore */} finally {
      setSending(false)
    }
  }

  async function handleCreate() {
    if (!newSubject.trim() || !newMessage.trim() || !accountId) return
    setCreating(true)
    setCreateError(null)
    try {
      const res = await fetch('https://api.virtuallaunch.pro/v1/support/tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ subject: newSubject.trim(), message: newMessage.trim(), priority: newPriority }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setCreateError((data as { message?: string }).message || 'Failed to create ticket.')
        return
      }
      setNewSubject('')
      setNewPriority('normal')
      setNewMessage('')
      setCreateSuccess(true)
      await loadTickets(accountId)
      setTimeout(() => {
        setCreateSuccess(false)
        setComposing(false)
      }, 1500)
    } catch {
      setCreateError('Network error. Please try again.')
    } finally {
      setCreating(false)
    }
  }

  const counts: Record<string, number> = {
    all: tickets.length,
    open: tickets.filter((t) => t.status === 'open').length,
    awaiting: tickets.filter((t) => t.status === 'awaiting').length,
    closed: tickets.filter((t) => t.status === 'closed').length,
  }

  const filtered = tickets.filter((t) => {
    const matchFolder = folder === 'all' || t.status === folder
    const matchSearch = !search || t.subject.toLowerCase().includes(search.toLowerCase())
    return matchFolder && matchSearch
  })

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* Left column — folders */}
      <div className="w-56 shrink-0 border-r border-slate-800/60 flex flex-col py-4 px-3 gap-1">
        <div className="mb-3 px-1">
          <h1 className="text-base font-bold text-white">Support</h1>
          <p className="text-xs text-slate-500 mt-0.5">Your tickets</p>
        </div>
        {FOLDERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFolder(f.key)}
            className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition ${
              folder === f.key
                ? 'bg-slate-800 text-white'
                : 'text-slate-400 hover:bg-slate-900 hover:text-white'
            }`}
          >
            <span>{f.label}</span>
            <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-bold ${
              folder === f.key ? 'bg-slate-700 text-white' : 'bg-slate-800/80 text-slate-500'
            }`}>
              {counts[f.key]}
            </span>
          </button>
        ))}
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => { setComposing(true); setSelected(null); setCreateError(null); setCreateSuccess(false) }}
          className="mt-2 w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition"
        >
          New Ticket
        </button>
      </div>

      {/* Middle column — ticket list */}
      <div className="flex flex-1 flex-col min-w-0 border-r border-slate-800/60">
        <div className="px-4 pt-4 pb-3 border-b border-slate-800/60">
          <input
            type="text"
            placeholder="Search tickets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-4 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
          />
        </div>
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60">
          {loading ? (
            <div className="p-6 text-sm text-slate-500">Loading…</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No tickets found.</div>
          ) : (
            filtered.map((t) => (
              <button
                key={t.ticket_id}
                type="button"
                onClick={() => { setSelected(t); setComposing(false) }}
                className={`w-full text-left px-4 py-3.5 transition hover:bg-slate-900/60 ${
                  selected?.ticket_id === t.ticket_id ? 'bg-slate-800/60' : ''
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-semibold text-white truncate">{t.subject}</span>
                  <span className={`shrink-0 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL[t.status]}`}>
                    <span className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[t.status]}`} />
                    {STATUS_LABEL[t.status]}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${PRIORITY_PILL[t.priority]}`}>
                    {t.priority}
                  </span>
                  <span className="text-xs text-slate-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Right column — ticket detail or new-ticket form */}
      <div className="w-80 shrink-0 flex flex-col">
        {composing ? (
          <>
            <div className="border-b border-slate-800/60 px-5 py-4">
              <h2 className="text-sm font-bold text-white">New Support Ticket</h2>
              <p className="mt-1 text-xs text-slate-500">Send us a message and we&apos;ll get back to you.</p>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Subject</label>
                <input
                  type="text"
                  value={newSubject}
                  onChange={(e) => setNewSubject(e.target.value)}
                  placeholder="Briefly describe your issue"
                  className="w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Priority</label>
                <div className="flex gap-2">
                  {PRIORITY_OPTIONS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setNewPriority(p)}
                      className={`flex-1 rounded-xl py-2 text-xs font-semibold capitalize transition ${
                        newPriority === p
                          ? 'bg-orange-500 text-slate-950'
                          : 'border border-slate-700 bg-slate-800/60 text-slate-300 hover:border-orange-500/40'
                      }`}
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-400">Message</label>
                <textarea
                  rows={6}
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Describe your issue in detail…"
                  className="w-full rounded-xl border border-slate-800/60 bg-slate-950/60 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none resize-none"
                />
              </div>
              {createError && <p className="text-xs text-red-400">{createError}</p>}
              {createSuccess && <p className="text-xs text-emerald-400">Ticket submitted. We&apos;ll respond shortly.</p>}
            </div>
            <div className="border-t border-slate-800/60 px-4 py-3 flex gap-2">
              <button
                type="button"
                onClick={() => { setComposing(false); setCreateError(null); setCreateSuccess(false) }}
                className="flex-1 rounded-xl border border-slate-700 bg-slate-900/60 py-2 text-sm font-semibold text-slate-300 hover:text-white transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || !newSubject.trim() || !newMessage.trim()}
                className="flex-1 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
              >
                {creating ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        ) : !selected ? (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <p className="text-sm text-slate-500">Select a ticket to view the conversation, or click <span className="text-slate-300 font-semibold">New Ticket</span> to start one.</p>
          </div>
        ) : (
          <>
            <div className="border-b border-slate-800/60 px-5 py-4">
              <h2 className="text-sm font-bold text-white leading-snug">{selected.subject}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL[selected.status]}`}>
                  {STATUS_LABEL[selected.status]}
                </span>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${PRIORITY_PILL[selected.priority]}`}>
                  {selected.priority}
                </span>
                <span className="text-xs text-slate-500 self-center">
                  {new Date(selected.created_at).toLocaleDateString()}
                </span>
              </div>
            </div>

            {/* Thread */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {(selected.messages ?? []).length === 0 ? (
                <p className="text-xs text-slate-500">No messages yet.</p>
              ) : (
                (selected.messages ?? []).map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex ${msg.author === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
                        msg.author === 'user'
                          ? 'bg-amber-500/20 text-amber-100 rounded-br-sm'
                          : 'bg-slate-800/80 text-slate-300 rounded-bl-sm'
                      }`}
                    >
                      <p className="leading-relaxed">{msg.body}</p>
                      <p className={`mt-1 text-xs ${msg.author === 'user' ? 'text-amber-400/60' : 'text-slate-500'}`}>
                        {new Date(msg.createdAt).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Reply */}
            <div className="border-t border-slate-800/60 px-4 py-3 space-y-2">
              <textarea
                rows={3}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder="Write a reply…"
                className="w-full rounded-xl border border-slate-800/60 bg-slate-900/60 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500/60 focus:outline-none resize-none"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !reply.trim()}
                className="w-full rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 py-2 text-sm font-bold text-slate-950 hover:from-orange-400 hover:to-amber-400 transition disabled:opacity-60"
              >
                {sending ? 'Sending…' : 'Send'}
              </button>
            </div>
          </>
        )}
      </div>

    </div>
  )
}
