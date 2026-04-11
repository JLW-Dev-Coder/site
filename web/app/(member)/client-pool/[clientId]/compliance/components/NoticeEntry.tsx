'use client'

import { X } from 'lucide-react'
import { Field, Grid2, Select, DateInput, TextArea } from './FormPrimitives'
import {
  NOTICE_RECEIVED_OPTIONS,
  NOTICE_TYPE_OPTIONS,
  NOTICE_CP_NUMBER_OPTIONS,
  type NoticeEntryData,
} from '../types'

interface Props {
  index: number
  entry: NoticeEntryData
  onChange: (entry: NoticeEntryData) => void
  onRemove?: () => void
}

export default function NoticeEntry({ index, entry, onChange, onRemove }: Props) {
  const isCP = entry.type === 'CP (Computer Paragraph Notice)'

  function update<K extends keyof NoticeEntryData>(key: K, value: NoticeEntryData[K]) {
    onChange({ ...entry, [key]: value })
  }

  return (
    <div className="space-y-4 rounded-lg border border-white/10 bg-white/[0.04] p-4">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium text-white">Notice Entry {index}</div>
        {index === 1 ? (
          <span className="text-xs text-white/40">Primary</span>
        ) : onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 text-xs text-white/50 transition hover:text-white"
          >
            <X className="h-3 w-3" />
            Remove
          </button>
        ) : null}
      </div>

      <Grid2>
        <Field label="Notice Received">
          <Select
            options={NOTICE_RECEIVED_OPTIONS}
            value={entry.received}
            onChange={(e) => update('received', e.target.value)}
          />
        </Field>
        <Field label="Notice Date">
          <DateInput value={entry.date} onChange={(e) => update('date', e.target.value)} />
        </Field>
        <Field label="Notice Type" span={2}>
          <Select
            options={NOTICE_TYPE_OPTIONS}
            value={entry.type}
            onChange={(e) => {
              const next = { ...entry, type: e.target.value }
              if (e.target.value !== 'CP (Computer Paragraph Notice)') {
                next.cp_number = ''
              }
              onChange(next)
            }}
          />
        </Field>
        {isCP ? (
          <Field label="CP Number" span={2}>
            <Select
              options={NOTICE_CP_NUMBER_OPTIONS}
              value={entry.cp_number}
              onChange={(e) => update('cp_number', e.target.value)}
              className="font-mono"
            />
          </Field>
        ) : null}
        <Field label="Notice Details" span={2}>
          <TextArea
            rows={3}
            placeholder="Free text: what the notice says, deadlines, amounts, requested actions..."
            value={entry.details}
            onChange={(e) => update('details', e.target.value)}
          />
        </Field>
      </Grid2>
    </div>
  )
}
