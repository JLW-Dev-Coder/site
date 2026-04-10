import { requireAuth } from '@/lib/auth/guard'
import MemberSidebar from '@/components/member/MemberSidebar'
import MemberTopbar from '@/components/member/MemberTopbar'

export default async function MemberLayout({
  children,
}: {
  children: React.ReactNode
}) {
  await requireAuth()

  return (
    <div className="flex h-screen overflow-hidden bg-[#0a0e27]">
      <MemberSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <MemberTopbar />
        <main className="flex-1 overflow-y-auto px-8 py-8">{children}</main>
      </div>
    </div>
  )
}
