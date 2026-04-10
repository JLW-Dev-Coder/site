import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Profile Preview' }

export default function ProfilePreviewPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold text-white">Preview</h1>
      <p className="mt-1 text-sm text-white/50">
        See how your profile appears to others.
      </p>
    </div>
  )
}
