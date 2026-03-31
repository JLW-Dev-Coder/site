'use client'

import { useState } from 'react'
import { startAffiliateOnboarding, requestPayout } from './client-api'
import type { AffiliateData, AffiliateEvent } from '@/lib/api/types'
import styles from './page.module.css'

interface AffiliateClientProps {
  accountId: string
  initialAffiliateData: AffiliateData
  initialAffiliateEvents: AffiliateEvent[]
}

export default function AffiliateClient({
  accountId,
  initialAffiliateData,
  initialAffiliateEvents,
}: AffiliateClientProps) {
  const [affiliateData, setAffiliateData] = useState<AffiliateData>(initialAffiliateData)
  const [affiliateEvents] = useState<AffiliateEvent[]>(initialAffiliateEvents)
  const [copyText, setCopyText] = useState('Copy')
  const [successMessage, setSuccessMessage] = useState('')

  const handleCopyReferralLink = async () => {
    try {
      await navigator.clipboard.writeText(affiliateData.referral_url)
      setCopyText('Copied!')
      setTimeout(() => setCopyText('Copy'), 2000)
    } catch (error) {
      console.error('Failed to copy to clipboard:', error)
    }
  }

  const handleConnectBank = async () => {
    try {
      const response = await startAffiliateOnboarding()
      window.location.href = response.onboard_url
    } catch (error) {
      console.error('Failed to start onboarding:', error)
    }
  }

  const handleRequestPayout = async () => {
    if (affiliateData.balance_pending < 1000) return

    try {
      const response = await requestPayout(affiliateData.balance_pending)
      setSuccessMessage(`Payout requested successfully! Payout ID: ${response.payout_id}`)

      // Update affiliate data optimistically
      setAffiliateData({
        ...affiliateData,
        balance_pending: 0,
        balance_paid: affiliateData.balance_paid + affiliateData.balance_pending,
      })
    } catch (error) {
      console.error('Failed to request payout:', error)
    }
  }

  const isPayoutDisabled =
    affiliateData.balance_pending < 1000 || affiliateData.connect_status !== 'active'

  const getPayoutTooltip = () => {
    if (affiliateData.balance_pending < 1000) return 'Minimum payout is $10'
    if (affiliateData.connect_status !== 'active') return 'Connect your bank account to withdraw'
    return ''
  }

  const formatCurrency = (cents: number) => `$${(cents / 100).toFixed(2)}`

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Affiliate Program</h1>
        <p>Earn commissions by referring new customers to our platform.</p>
      </div>

      {/* Section 1 — Referral Link */}
      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Your Referral Link</h2>
        <div className={styles.referralInputGroup}>
          <input
            type="text"
            className={styles.referralInput}
            value={affiliateData.referral_url}
            readOnly
          />
          <button
            className={`${styles.copyButton} ${copyText === 'Copied!' ? styles.copied : ''}`}
            onClick={handleCopyReferralLink}
          >
            {copyText}
          </button>
        </div>
        <p className={styles.subtext}>
          Share this link. Earn 20% commission on every purchase your referrals make, for life.
        </p>
      </div>

      {/* Section 2 — Earnings Summary */}
      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Earnings Summary</h2>
        <div className={styles.statsGrid}>
          <div className={styles.statCard}>
            <div className={styles.statValue}>
              {formatCurrency(affiliateData.balance_pending)}
            </div>
            <div className={styles.statLabel}>Available to withdraw</div>
          </div>
          <div className={styles.statCard}>
            <div className={styles.statValue}>
              {formatCurrency(affiliateData.balance_paid)}
            </div>
            <div className={styles.statLabel}>Total earned and paid</div>
          </div>
        </div>
        <div className={styles.tooltip}>
          <button
            className={styles.payoutButton}
            disabled={isPayoutDisabled}
            onClick={handleRequestPayout}
          >
            Request Payout
          </button>
          {isPayoutDisabled && (
            <span className={styles.tooltipText}>{getPayoutTooltip()}</span>
          )}
        </div>
        {successMessage && (
          <div className={styles.successMessage}>{successMessage}</div>
        )}
      </div>

      {/* Section 3 — Stripe Connect */}
      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Bank Account</h2>
        {affiliateData.connect_status === 'active' ? (
          <div className={`${styles.badge} ${styles.badgeSuccess}`}>
            <span>✓</span>
            Bank account connected
          </div>
        ) : (
          <div className={styles.connectCard}>
            <h3>Connect your bank account</h3>
            <p>Connect via Stripe to receive commission payouts directly to your bank.</p>
            <button className={styles.connectButton} onClick={handleConnectBank}>
              Connect Bank Account
            </button>
          </div>
        )}
      </div>

      {/* Section 4 — Commission History */}
      <div className={styles.section}>
        <h2 className={styles.sectionHeading}>Commission History</h2>
        {affiliateEvents.length === 0 ? (
          <div className={styles.emptyState}>
            No commissions yet. Share your referral link to start earning.
          </div>
        ) : (
          <table className={styles.table}>
            <thead className={styles.tableHeader}>
              <tr>
                <th>Date</th>
                <th>Platform</th>
                <th>Sale Amount</th>
                <th>Your Commission</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {affiliateEvents.map((event, index) => (
                <tr key={index} className={styles.tableRow}>
                  <td className={styles.tableCell}>{formatDate(event.created_at)}</td>
                  <td className={styles.tableCell}>{event.platform}</td>
                  <td className={styles.tableCell}>{formatCurrency(event.gross_amount)}</td>
                  <td className={styles.tableCell}>{formatCurrency(event.commission_amount)}</td>
                  <td className={styles.tableCell}>
                    <span
                      className={`${styles.statusBadge} ${
                        event.status === 'paid' ? styles.statusPaid : styles.statusPending
                      }`}
                    >
                      {event.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}