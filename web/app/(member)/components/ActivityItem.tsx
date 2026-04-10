interface ActivityItemProps {
  title: string
  timestamp: string
  dotColor?: string
}

export default function ActivityItem({ title, timestamp, dotColor = 'bg-brand-orange' }: ActivityItemProps) {
  return (
    <div className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-white/80">{title}</p>
        <p className="mt-0.5 text-xs text-white/40">{timestamp}</p>
      </div>
    </div>
  )
}
