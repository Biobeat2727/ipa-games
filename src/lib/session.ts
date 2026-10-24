// Persistent browser session stored in localStorage.
// No login — a player's phone is identified by a self-generated device id plus a
// private secret that never leaves the phone. The id is public (it's stored on the
// player's seat); every player-side database function also takes the secret, and
// the server keeps only its hash (supabase/phase_a_1_functions.sql).

const KEYS = {
  deviceId:     'trivia_device_id',      // player identity (public)
  deviceSecret: 'trivia_device_secret',  // proves the identity (private)
  hostId:       'trivia_host_id',        // host identity (stored on room creation)
  roomCode:     'trivia_room_code',      // last joined/created room
  teamId:       'trivia_team_id',        // last joined team (players only)
} as const

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
}

// The id and secret are only useful together, so a phone missing either gets a
// fresh pair. (The pre-key `trivia_session_id` is deliberately not reused: it was
// readable by anyone before keys existed, so it could have been claimed first.)
function ensureDevice(): { id: string; secret: string } {
  let id = localStorage.getItem(KEYS.deviceId)
  let secret = localStorage.getItem(KEYS.deviceSecret)
  if (!id || !secret || secret.length !== 64) {
    id = crypto.randomUUID()
    secret = randomHex(32)
    localStorage.setItem(KEYS.deviceId, id)
    localStorage.setItem(KEYS.deviceSecret, secret)
  }
  return { id, secret }
}

/** This phone's public player id (players.session_id). */
export function getSessionId(): string {
  return ensureDevice().id
}

/** Arguments every key-checked player function takes. */
export function deviceAuth(): { p_device_id: string; p_device_secret: string } {
  const { id, secret } = ensureDevice()
  return { p_device_id: id, p_device_secret: secret }
}

/** Just the secret, for the older functions whose id parameter is p_session_id. */
export function getDeviceSecret(): string {
  return ensureDevice().secret
}

export function getHostId():   string | null { return localStorage.getItem(KEYS.hostId) }
export function getRoomCode(): string | null { return localStorage.getItem(KEYS.roomCode) }
export function getTeamId():   string | null { return localStorage.getItem(KEYS.teamId) }

export function setHostId(id: string):   void { localStorage.setItem(KEYS.hostId, id) }
export function setRoomCode(code: string): void { localStorage.setItem(KEYS.roomCode, code) }
export function setTeamId(id: string):   void { localStorage.setItem(KEYS.teamId, id) }

export function clearHostSession(): void {
  localStorage.removeItem(KEYS.hostId)
  localStorage.removeItem(KEYS.roomCode)
}

export function clearPlayerSession(): void {
  localStorage.removeItem(KEYS.roomCode)
  localStorage.removeItem(KEYS.teamId)
}
