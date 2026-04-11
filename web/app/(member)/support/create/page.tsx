import type { Metadata } from 'next'
import CreateTicketClient from './CreateTicketClient'

export const metadata: Metadata = { title: 'Create Ticket' }

export default function CreateTicketPage() {
  return <CreateTicketClient />
}
