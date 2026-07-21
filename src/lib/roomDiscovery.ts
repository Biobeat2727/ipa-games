import { supabase } from './supabase'
import type { Room } from './types'

export function getLocalDayStartIso(): string {
  const localMidnight = new Date()
  localMidnight.setHours(0, 0, 0, 0)
  return localMidnight.toISOString()
}

export async function findCurrentActiveRoom(hostId?: string): Promise<Room | null> {
  let query = supabase
    .from('rooms')
    .select()
    .neq('status', 'finished')
    .gte('created_at', getLocalDayStartIso())

  if (hostId) query = query.eq('host_id', hostId)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  return data ?? null
}
