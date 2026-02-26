// Persistent browser session stored in localStorage.
// No auth — players and hosts are identified by self-generated UUIDs.

const KEYS = {
  sessionId: 'trivia_session_id',   // player identity
  hostId:    'trivia_host_id',      // host identity (stored on room creation)
  roomCode:  'trivia_room_code',    // last joined/created room
  teamId:    'trivia_team_id',      // last joined team (players only)
} as const

export function getSessionId(): string {
  let id = localStorage.getItem(KEYS.sessionId)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(KEYS.sessionId, id)
  }
  return id
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
