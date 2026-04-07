import { redirect } from 'next/navigation'
import { requireAuth } from '@/lib/auth/guard'
import ScaleSidebar from '@/components/scale/ScaleSidebar'
import Topbar from '@/components/ui/Topbar'

const OPERATOR_EMAILS = [
  'jamie.williams@virtuallaunch.pro',
  'hello@virtuallaunch.pro',
]

export default async function ScaleLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireAuth()

  if (!OPERATOR_EMAILS.includes((session.email || '').toLowerCase())) {
    redirect('/dashboard')
  }

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <ScaleSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 py-8">{children}</main>
      </div>
    </div>
  )
}
