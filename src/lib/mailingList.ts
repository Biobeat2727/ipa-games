import { supabase } from './supabase'

// Tapped In! mailing list (supabase/add_mailing_list.sql). Players sign up
// through the join_mailing_list RPC; only a signed-in host can read the table.

export const MAILING_LIST_JOINED_KEY = 'mailingListJoined'

/** Loose client-side check — the database function is the real gate. */
export function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim()) && value.trim().length <= 254
}

export async function joinMailingList(email: string, roomId?: string | null, teamName?: string | null) {
  return supabase.rpc('join_mailing_list', {
    p_email: email.trim(),
    p_room_id: roomId ?? null,
    p_team_name: teamName ?? null,
  })
}

export async function mailingListCount(): Promise<number | null> {
  const { count, error } = await supabase
    .from('mailing_list').select('id', { count: 'exact', head: true })
  return error ? null : count ?? 0
}

function csvCell(value: string | null | undefined): string {
  const s = value ?? ''
  // Quote everything; neutralize spreadsheet formula injection (=, +, -, @)
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s
  return `"${safe.replace(/"/g, '""')}"`
}

/** Host only: fetch every sign-up and save it as a CSV file. Returns the row
 *  count, or throws with a readable message. */
export async function downloadMailingListCsv(): Promise<number> {
  const rows: Array<{ email: string; team_name: string | null; created_at: string }> = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mailing_list')
      .select('email, team_name, created_at')
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  const lines = [
    ['email', 'signed_up', 'team'].map(csvCell).join(','),
    ...rows.map(r => [r.email, r.created_at.slice(0, 10), r.team_name].map(csvCell).join(',')),
  ]
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `tapped-in-mailing-list-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
  return rows.length
}
