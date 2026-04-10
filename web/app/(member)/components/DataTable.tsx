import type { ReactNode } from 'react'

interface Column {
  key: string
  label: string
  className?: string
}

interface DataTableProps {
  columns: Column[]
  rows: Record<string, ReactNode>[]
}

export default function DataTable({ columns, rows }: DataTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[--member-border] bg-[--member-card]">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-[--member-border]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-5 py-3 text-[11px] uppercase tracking-widest text-white/40 font-medium ${col.className ?? ''}`}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-[--member-border] last:border-b-0 transition hover:bg-[--member-card-hover]"
            >
              {columns.map((col) => (
                <td key={col.key} className={`px-5 py-3.5 text-white/70 ${col.className ?? ''}`}>
                  {row[col.key]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
