// ============================================================
// Enums
// ============================================================

export type RoomStatus = 'lobby' | 'round_1' | 'round_2' | 'final_jeopardy' | 'finished'
export type BuzzStatus = 'pending' | 'correct' | 'wrong' | 'expired' | 'skipped'
export type WagerStatus = 'pending' | 'correct' | 'wrong'

// ============================================================
// Row types (mirror the DB schema exactly)
// ============================================================

export interface Room {
  id: string
  code: string
  host_id: string
  status: RoomStatus
  current_question_id: string | null
  created_at: string
}

export interface Team {
  id: string
  room_id: string
  name: string
  score: number
  is_active: boolean
  created_at: string
}

export interface Player {
  id: string
  team_id: string
  nickname: string | null
  session_id: string
  created_at: string
}

export interface Category {
  id: string
  room_id: string
  name: string
  round: number // 1, 2, or 3 (3 = Final Jeopardy)
}

export interface Question {
  id: string
  category_id: string
  answer: string
  correct_question: string // host only — query questions_public to omit this
  point_value: number | null // null for Final Jeopardy
  is_answered: boolean
  answered_by_team_id: string | null
}

export interface QuestionPublic {
  id: string
  category_id: string
  answer: string
  point_value: number | null
  is_answered: boolean
  answered_by_team_id: string | null
}

export interface Buzz {
  id: string
  question_id: string
  team_id: string
  buzzed_at: string // server-generated — never use client time for ordering
  response: string | null
  response_submitted_at: string | null
  status: BuzzStatus
}

export interface Wager {
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
      rooms: {
        Row: Room
        Insert: Omit<Room, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Room, 'id'>>
      }
      teams: {
        Row: Team
        Insert: Omit<Team, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Team, 'id'>>
      }
      players: {
        Row: Player
        Insert: Omit<Player, 'id' | 'created_at'> & { id?: string; created_at?: string }
        Update: Partial<Omit<Player, 'id'>>
      }
      categories: {
        Row: Category
        Insert: Omit<Category, 'id'> & { id?: string }
        Update: Partial<Omit<Category, 'id'>>
      }
      questions: {
        Row: Question
        Insert: Omit<Question, 'id'> & { id?: string }
        Update: Partial<Omit<Question, 'id'>>
      }
      buzzes: {
        Row: Buzz
        Insert: Omit<Buzz, 'id' | 'buzzed_at'> & { id?: string; buzzed_at?: string }
        Update: Partial<Omit<Buzz, 'id'>>
      }
      wagers: {
        Row: Wager
        Insert: Omit<Wager, 'id'> & { id?: string }
        Update: Partial<Omit<Wager, 'id'>>
      }
    }
    Views: {
      questions_public: {
        Row: QuestionPublic
      }
    }
    Enums: {
      room_status: RoomStatus
      buzz_status: BuzzStatus
      wager_status: WagerStatus
    }
  }
}
