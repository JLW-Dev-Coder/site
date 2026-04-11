'use client'

import { useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Label } from './FormPrimitives'

interface Props {
  fullValue: string
  last4: string
}

export default function SSNField({ fullValue, last4 }: Props) {
  const [visible, setVisible] = useState(false)

  return (
    <div>
      <Label>SSN</Label>
      <div className="flex items-center gap-2">
        <div className="flex-1 rounded-md border border-white/10 bg-white/5 px-3 py-2 font-mono text-sm text-white">
          {visible ? fullValue : `••••-${last4}`}
        </div>
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-white/80 transition hover:bg-white/10"
        >
          {visible ? (
            <>
              <EyeOff className="h-4 w-4" /> Hide
            </>
          ) : (
            <>
              <Eye className="h-4 w-4" /> Show
            </>
          )}
        </button>
      </div>
    </div>
  )
}
