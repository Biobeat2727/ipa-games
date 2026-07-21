// ============================================================
// Enums
// ============================================================

export type RoomStatus = 'lobby' | 'round_1' | 'round_2' | 'final_jeopardy' | 'finished'
export type BuzzStatus = 'pending' | 'correct' | 'wrong' | 'expired' | 'skipped'
export type WagerStatus = 'pending' | 'correct' | 'wrong'

// ============================================================
// Row types (mirror the DB schema exactly)
// ============================================================

export type ScoreSnapshot = {
  label: string
  scores: Array<{ team_id: string; score: number }>
}

export type Room = {
  id: string
  code: string
  host_id: string
  status: RoomStatus
  current_question_id: string | null
  current_turn_team_id?: string | null
  pending_question_id?: string | null
  pending_selection_team_id?: string | null
  pending_selection_session_id?: string | null
  pending_selection_claimed_at?: string | null
  pending_selection_wager?: number | null
  score_snapshots?: ScoreSnapshot[]
  created_at: string
}

export type Team = {
  id: string
  room_id: string
  name: string
  score: number
  is_active: boolean
  created_at: string
}

export type Player = {
  id: string
  team_id: string
  nickname: string | null
  session_id: string
  created_at: string
}

export type Category = {
  id: string
  room_id: string
  name: string
  round: number // 1, 2, or 3 (3 = Final Jeopardy)
}

export type Question = {
  id: string
  category_id: string
  answer: string
  correct_question: string // host only — query questions_public to omit this
  point_value: number | null // null for Final Jeopardy
  is_answered: boolean
  answered_by_team_id: string | null
  is_double_tap?: boolean
}

export type QuestionPublic = {
  id: string
  category_id: string
  answer: string
  point_value: number | null
  is_answered: boolean
  answered_by_team_id: string | null
  is_double_tap?: boolean
}

export type Buzz = {
  id: string
  question_id: string
  team_id: string
  buzzed_at: string // server-generated — never use client time for ordering
  response: string | null
  response_submitted_at: string | null
  status: BuzzStatus
}

export type Wager = {
  id: string
  team_id: string
  room_id: string
  amount: number
  response: string | null
  status: WagerStatus
  submitted_at: string | null
}

// ============================================================
// Supabase Database type (used with createClient<Database>)
// ============================================================

export type Database = {
  public: {
    Tables: {
      authorized_hosts: {
        Row: {
          user_id: string
          display_name: string | null
          is_active: boolean
          created_at: string
        }
        Insert: {
          user_id: string
          display_name?: string | null
          is_active?: boolean
          created_at?: string
        }
        Update: {
          display_name?: string | null
          is_active?: boolean
        }
        Relationships: []
      }
      rooms: {
        Row: Room
        Insert: Omit<Room, 'id' | 'created_at' | 'current_question_id'> & { id?: string; created_at?: string; current_question_id?: string | null }
        Update: Partial<Omit<Room, 'id'>>
        Relationships: []
      }
      teams: {
        Row: Team
        Insert: Omit<Team, 'id' | 'created_at' | 'score' | 'is_active'> & { id?: string; created_at?: string; score?: number; is_active?: boolean }
        Update: Partial<Omit<Team, 'id'>>
        Relationships: []
      }
      players: {
        Row: Player
        Insert: Omit<Player, 'id' | 'created_at' | 'nickname'> & { id?: string; created_at?: string; nickname?: string | null }
        Update: Partial<Omit<Player, 'id'>>
        Relationships: []
      }
      categories: {
        Row: Category
        Insert: Omit<Category, 'id'> & { id?: string }
        Update: Partial<Omit<Category, 'id'>>
        Relationships: []
      }
      questions: {
        Row: Question
        Insert: Omit<Question, 'id' | 'is_answered' | 'answered_by_team_id'> & { id?: string; is_answered?: boolean; answered_by_team_id?: string | null }
        Update: Partial<Omit<Question, 'id'>>
        Relationships: []
      }
      buzzes: {
        Row: Buzz
        Insert: Omit<Buzz, 'id' | 'buzzed_at' | 'response' | 'response_submitted_at'> & { id?: string; buzzed_at?: string; response?: string | null; response_submitted_at?: string | null }
        Update: Partial<Omit<Buzz, 'id'>>
        Relationships: []
      }
      wagers: {
        Row: Wager
        Insert: Omit<Wager, 'id' | 'response' | 'submitted_at'> & { id?: string; response?: string | null; submitted_at?: string | null }
        Update: Partial<Omit<Wager, 'id'>>
        Relationships: []
      }
    }
    Views: {
      questions_public: {
        Row: QuestionPublic
        Relationships: []
      }
    }
    Functions: {
      claim_question_selection: {
        Args: {
          p_room_id: string
          p_team_id: string
          p_question_id: string
          p_session_id: string
        }
        Returns: Array<{
          accepted: boolean
          question_id: string | null
          selecting_team_id: string | null
          selector_session_id: string | null
          claimed_at: string | null
        }>
      }
      confirm_question_selection: {
        Args: {
          p_room_id: string
          p_team_id: string
          p_question_id: string
          p_session_id: string
          p_wager: number
        }
        Returns: boolean
      }
    }
    Enums: {
      room_status: RoomStatus
      buzz_status: BuzzStatus
      wager_status: WagerStatus
    }
    CompositeTypes: Record<never, never>
  }
}
