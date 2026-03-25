// lib/notifications/email.ts
import { Resend } from 'resend'

export interface BlockEmailRecipient {
  email: string
  full_name: string | null
}

export interface BlockInfo {
  shift_type: 'day' | 'night'
  start_date: string
  end_date: string
  status: string
}

/**
 * Email to all dept members when a block is posted (preliminary or final).
 */
export async function sendBlockPostedEmail(
  recipients: BlockEmailRecipient[],
  block: BlockInfo
): Promise<void> {
  if (!recipients.length) return
  if (!process.env.RESEND_API_KEY) {
    console.warn('[sendBlockPostedEmail] RESEND_API_KEY missing — email skipped')
    return
  }

  const resend = new Resend(process.env.RESEND_API_KEY)
  const statusLabel = block.status === 'final' ? 'Final' : 'Preliminary'
  const typeLabel = block.shift_type === 'day' ? 'Day' : 'Night'
  const subject = `${statusLabel} ${typeLabel} Schedule Posted — ${block.start_date} to ${block.end_date}`
  const text = [
    `Your ${typeLabel.toLowerCase()} shift schedule (${block.start_date} to ${block.end_date}) has been posted as ${statusLabel.toLowerCase()}.`,
    '',
    'Log in to Teamwise to view your schedule:',
    'https://teamwise.work/schedule',
  ].join('\n')

  try {
    await resend.emails.send({
      from: 'Teamwise Schedule <schedule@teamwise.work>',
      to: recipients.map(r => r.email),
      subject,
      text,
    })
  } catch (err) {
    console.error('[sendBlockPostedEmail] failed', { count: recipients.length, err })
  }
}
