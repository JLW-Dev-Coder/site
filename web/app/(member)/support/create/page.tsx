import type { Metadata } from 'next'
import {
  ArrowLeft,
  Send,
  X,
} from 'lucide-react'

export const metadata: Metadata = { title: 'Create Ticket' }

/* ── shared form styles ──────────────────────────────────────── */

const labelCls = 'block text-[11px] uppercase tracking-widest text-white/40 mb-1.5'
const inputCls =
  'w-full rounded-lg border border-[--member-border] bg-[--member-card] px-4 py-2.5 text-sm text-white placeholder-white/30 transition focus:border-brand-orange/50 focus:outline-none focus:ring-1 focus:ring-brand-orange/30'
const selectCls =
  'w-full appearance-none rounded-lg border border-[--member-border] bg-[--member-card] px-4 py-2.5 text-sm text-white transition focus:border-brand-orange/50 focus:outline-none focus:ring-1 focus:ring-brand-orange/30'

/* ── page ──────────────────────────────────────────────────────── */

export default function CreateTicketPage() {
  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <a
          href="/support"
          className="mb-3 inline-flex items-center gap-1.5 text-sm text-white/40 transition hover:text-white"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Support
        </a>
        <h1 className="text-2xl font-semibold text-white">Create Support Ticket</h1>
        <p className="mt-1 text-sm text-white/50">
          Submit a new support request and our team will respond promptly.
        </p>
      </div>

      <form className="space-y-6">
        {/* Contact Information */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Contact Information</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Full Name</label>
              <input type="text" placeholder="Jamie Williams" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Email Address</label>
              <input type="email" placeholder="jamie.williams@virtuallaunch.pro" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Ticket Classification */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Ticket Classification</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Category</label>
              <select className={selectCls}>
                <option value="">Select category</option>
                <option value="billing">Billing</option>
                <option value="bookings">Bookings</option>
                <option value="profile">Profile</option>
                <option value="reports">Reports</option>
                <option value="tokens">Tokens</option>
                <option value="technical">Technical Issue</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Issue Type</label>
              <select className={selectCls}>
                <option value="">Select issue type</option>
                <option value="bug">Bug / Error</option>
                <option value="question">Question</option>
                <option value="feature">Feature Request</option>
                <option value="account">Account Issue</option>
                <option value="data">Data Discrepancy</option>
              </select>
            </div>
          </div>
        </div>

        {/* Priority & Urgency */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Priority &amp; Urgency</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Priority</label>
              <select className={selectCls}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Urgency</label>
              <select className={selectCls}>
                <option value="no-rush">No Rush</option>
                <option value="normal">Normal</option>
                <option value="urgent">Urgent — Affects workflow</option>
                <option value="emergency">Emergency — Service down</option>
              </select>
            </div>
          </div>
        </div>

        {/* Issue Details */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Issue Details</h3>
          <div className="mt-5 space-y-4">
            <div>
              <label className={labelCls}>Subject</label>
              <input type="text" placeholder="Brief summary of your issue" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Message</label>
              <textarea
                rows={6}
                placeholder="Describe your issue in detail. Include steps to reproduce, expected behavior, and any error messages you've encountered."
                className={`${inputCls} resize-none`}
              />
            </div>
          </div>
        </div>

        {/* Additional Information */}
        <div className="rounded-xl border border-[--member-border] bg-[--member-card] p-6">
          <h3 className="text-xs uppercase tracking-widest text-white/40">Additional Information</h3>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelCls}>Token ID (optional)</label>
              <input type="text" placeholder="e.g. TKN_abc123" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Related ID (optional)</label>
              <input type="text" placeholder="e.g. BOOK_20260410_xyz" className={inputCls} />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-brand-orange to-brand-amber px-5 py-2.5 text-sm font-medium text-white shadow transition hover:opacity-90"
          >
            <Send className="h-4 w-4" />
            Submit Ticket
          </button>
          <a
            href="/support"
            className="inline-flex items-center gap-2 rounded-lg border border-[--member-border] px-5 py-2.5 text-sm font-medium text-white/60 transition hover:bg-white/[0.04] hover:text-white"
          >
            <X className="h-4 w-4" />
            Cancel
          </a>
        </div>
      </form>
    </div>
  )
}
