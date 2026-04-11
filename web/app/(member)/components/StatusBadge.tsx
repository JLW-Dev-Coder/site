const variants: Record<string, string> = {
  active: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  completed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  confirmed: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  connected: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  'paid out': 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  pending: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  'in progress': 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  upcoming: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  assigned: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  available: 'bg-brand-orange/10 text-brand-orange border-brand-orange/20',
  cancelled: 'bg-red-500/10 text-red-400 border-red-500/20',
  'no-show': 'bg-red-500/10 text-red-400 border-red-500/20',
  resolved: 'bg-white/5 text-white/50 border-white/10',
  closed: 'bg-white/5 text-white/50 border-white/10',
  unavailable: 'bg-white/5 text-white/40 border-white/10',
}

interface StatusBadgeProps {
  status: string
}

export default function StatusBadge({ status }: StatusBadgeProps) {
  const key = status.toLowerCase()
  const classes = variants[key] ?? 'bg-white/5 text-white/50 border-white/10'

  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${classes}`}>
      {status}
    </span>
  )
}
