// ============================================================
// Enums
// ============================================================

// `round_3` requires the matching enum value in the database —
// supabase/add_round_three_1_enum.sql, _2_game_logic.sql and _3_category_round_check.sql
// must be applied (as three separate SQL-editor runs) before this frontend is deployed.
// Round helpers (labels, next-status, Double Tap floors) live in src/lib/rounds.ts.
export type RoomStatus = 'lobby' | 'round_1' | 'round_2' | 'round_3' | 'final_jeopardy' | 'finished'
export type FinalPhase = 'starting' | 'wager' | 'question' | 'review' | 'done'
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
  buzz_opened_at?: string | null
  current_turn_team_id?: string | null
  pending_question_id?: string | null
  pending_selection_team_id?: string | null
  pending_selection_session_id?: string | null
  pending_selection_claimed_at?: string | null
  pending_selection_wager?: number | null
  final_phase?: FinalPhase | null
  final_question_id?: string | null
  final_response_deadline_at?: string | null
  final_review_team_id?: string | null
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

/** Post-game player feedback. Insert-only for anon; the host reads it in the
 *  Supabase dashboard. See supabase/add_feedback.sql */
export type MailingListEntry = {
  id: string
  email: string
  room_id: string | null
  team_name: string | null
  created_at: string
}

export type Feedback = {
  id: string
  room_id: string | null
  team_id: string | null
  team_name: string | null
  kind: 'thoughts' | 'bug'
  message: string
  created_at: string
}

export type Category = {
  id: string
  room_id: string
  name: string
  /** 1, 2, 3 = regular boards. Final Tap is stored as 4 by current imports
   *  (FINAL_TAP_STORAGE_ROUND); rooms imported before Round 3 existed stored
   *  it as 3. Identify Final Tap by its null point_value — src/lib/finalTap.ts */
  round: number
  /** Host-read flavor text shown during the round-start category reveal */
  description: string | null
  /** Index within its round from the imported JSON — drives board left-to-right
   *  order and the reveal sequence. Null on content imported before this existed
   *  (falls back to alphabetical); see src/lib/categoryOrder.ts */
  position: number | null
}

export type Question = {
  id: string
  category_id: string
  answer: string
  correct_question: string // host only — query questions_public to omit this
  point_value: number | null // null ONLY for the Final Tap clue (wager-scored)
  is_answered: boolean
  answered_by_team_id: string | null
  is_double_tap?: boolean
}

export type QuestionPublic = {
  id: string
  category_id: string
  /** The clue. Null from questions_public until the clue is live, answered, or
   *  (Final) revealed — see supabase/phase_a_1_functions.sql. The inline
   *  question_activated payload always carries it. */
  answer: string | null
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
  response_deadline_at: string
  status: BuzzStatus
}

/** A phone blocked from one game (supabase/phase_b_moderation.sql). Host-readable only. */
export type RoomBlock = {
  id: string
  room_id: string
  device_id: string
  nickname: string | null
  team_name: string | null
  blocked_at: string
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
        Insert: Omit<Category, 'id' | 'description' | 'position'> & { id?: string; description?: string | null; position?: number | null }
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
        Insert: Omit<Buzz, 'id' | 'buzzed_at' | 'response' | 'response_submitted_at' | 'response_deadline_at'> & { id?: string; buzzed_at?: string; response?: string | null; response_submitted_at?: string | null }
        Update: Partial<Omit<Buzz, 'id'>>
        Relationships: []
      }
      wagers: {
        Row: Wager
        Insert: Omit<Wager, 'id' | 'response' | 'submitted_at'> & { id?: string; response?: string | null; submitted_at?: string | null }
        Update: Partial<Omit<Wager, 'id'>>
        Relationships: []
      }
      feedback: {
        Row: Feedback
        Insert: Omit<Feedback, 'id' | 'created_at' | 'kind'> & { id?: string; created_at?: string; kind?: 'thoughts' | 'bug' }
        Update: Partial<Omit<Feedback, 'id'>>
        Relationships: []
      }
      // supabase/add_mailing_list.sql — host-readable only; players write via join_mailing_list
      mailing_list: {
        Row: MailingListEntry
        Insert: never
        Update: never
        Relationships: []
      }
      // supabase/phase_b_moderation.sql — host-readable; written only by host functions
      room_blocks: {
        Row: RoomBlock
        Insert: never
        Update: never
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
          p_device_secret: string
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
          p_device_secret: string
        }
        Returns: boolean
      }
      judge_buzz: {
        Args: {
          p_room_id: string
          p_buzz_id: string
          p_outcome: 'correct' | 'wrong'
          p_points: number
        }
        Returns: Array<{
          applied: boolean
          buzz_id: string
          team_id: string
          question_id: string
          outcome: 'correct' | 'wrong'
          new_score: number
          question_done: boolean
        }>
      }
      judge_final_wager: {
        Args: {
          p_room_id: string
          p_wager_id: string
          p_outcome: 'correct' | 'wrong'
        }
        Returns: Array<{
          applied: boolean
          wager_id: string
          team_id: string
          outcome: 'correct' | 'wrong'
          wager_amount: number
          new_score: number
        }>
      }
      finish_game: {
        Args: {
          p_room_id: string
        }
        Returns: Array<{
          team_id: string
          team_name: string
          final_score: number
        }>
      }
      join_mailing_list: {
        Args: {
          p_email: string
          p_room_id?: string | null
          p_team_name?: string | null
        }
        Returns: undefined
      }
      kick_team: {
        Args: {
          p_team_id: string
        }
        Returns: Array<{
          room_id: string
          turn_cleared: boolean
        }>
      }
      reveal_final_question: {
        Args: {
          p_room_id: string
          p_question_id: string
        }
        Returns: Array<{
          question_id: string
          response_deadline_at: string
        }>
      }
      // ── Key-checked player functions (supabase/phase_a_1_functions.sql) ──
      // Every one takes the phone's device id + secret (lib/session deviceAuth()).
      join_team: {
        Args: { p_team_id: string; p_nickname: string | null; p_device_id: string; p_device_secret: string }
        Returns: Player[]
      }
      create_team: {
        Args: { p_room_id: string; p_team_id: string; p_name: string; p_nickname: string | null; p_device_id: string; p_device_secret: string }
        Returns: Team[]
      }
      leave_team: {
        Args: { p_team_id: string | null; p_device_id: string; p_device_secret: string }
        Returns: number
      }
      claim_buzz: {
        Args: { p_question_id: string; p_device_id: string; p_device_secret: string }
        Returns: Array<{
          buzz_id: string
          team_id: string
          buzzed_at: string
          response_deadline_at: string
          created: boolean
          queue_position: number
        }>
      }
      submit_buzz_response: {
        Args: { p_buzz_id: string; p_response: string; p_device_id: string; p_device_secret: string }
        Returns: Array<{ accepted: boolean; saved_response: string | null; response_submitted_at: string | null }>
      }
      submit_final_wager: {
        Args: { p_room_id: string; p_amount: number; p_device_id: string; p_device_secret: string }
        Returns: Array<{ accepted: boolean; wager_id: string; team_id: string; amount: number }>
      }
      get_my_final_wager: {
        Args: { p_room_id: string; p_device_id: string; p_device_secret: string }
        Returns: Array<{
          wager_id: string
          team_id: string
          amount: number
          response: string | null
          status: WagerStatus
          submitted_at: string | null
        }>
      }
      final_board: {
        Args: { p_room_id: string }
        Returns: Array<{
          team_id: string
          has_wagered: boolean
          submitted: boolean
          amount: number | null
          response: string | null
          status: WagerStatus | null
        }>
      }
      // ── Host moderation (supabase/phase_b_moderation.sql) ──
      host_remove_player: {
        Args: { p_player_id: string }
        Returns: Array<{ team_id: string; device_id: string }>
      }
      host_block_player: {
        Args: { p_player_id: string }
        Returns: Array<{ team_id: string; device_id: string }>
      }
      host_block_team: {
        Args: { p_team_id: string }
        Returns: Array<{ room_id: string; turn_cleared: boolean; blocked_devices: string[] }>
      }
      host_unblock: {
        Args: { p_block_id: string }
        Returns: string
      }
      host_rename_team: {
        Args: { p_team_id: string; p_name: string }
        Returns: Team[]
      }
      submit_final_response: {
        Args: {
          p_room_id: string
          p_team_id: string
          p_session_id: string
          p_response: string
          p_device_secret: string
        }
        Returns: Array<{
          accepted: boolean
          wager_id: string
          saved_response: string | null
          response_submitted_at: string
        }>
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
