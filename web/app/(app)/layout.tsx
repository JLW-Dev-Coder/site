import { requireAuth } from '@/lib/auth/guard'
import Sidebar from '@/components/ui/Sidebar'
import Topbar from '@/components/ui/Topbar'

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireAuth()

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar userEmail={session.email} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-6 py-8">
          {children}
        </main>
      </div>
    </div>
  )
}
