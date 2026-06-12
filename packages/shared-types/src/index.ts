export type Muscle =
  | 'chest' | 'back' | 'quads' | 'hamstrings' | 'glutes' | 'shoulders'
  | 'biceps' | 'triceps' | 'core' | 'calves' | 'forearms'

export type MovementPattern = 'push' | 'pull' | 'squat' | 'hinge' | 'carry' | 'core'
export type Equipment = 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight' | 'other'

export interface Exercise {
  id: string
  user_id: string
  name: string
  primary_muscles: Muscle[]
  secondary_muscles: Muscle[]
  movement_pattern: MovementPattern
  equipment: Equipment
  is_custom: boolean
}

export interface ExerciseCreate {
  name: string
  primary_muscles: Muscle[]
  secondary_muscles?: Muscle[]
  movement_pattern: MovementPattern
  equipment: Equipment
}

export interface SetEntry {
  weight: number
  reps: number
  rpe?: number | null
  is_warmup?: boolean
}

export interface WorkoutEntry {
  exercise_id: string
  exercise_name: string
  superset_group?: string | null
  sets: SetEntry[]
}

export interface Workout {
  id: string
  user_id: string
  date: string
  started_at: string | null
  ended_at: string | null
  notes: string
  entries: WorkoutEntry[]
  exercise_ids: string[]
  total_volume: number
}

export interface WorkoutListResponse { items: Workout[]; total: number }

export interface PR {
  exercise_id: string
  exercise_name: string
  weight: number
  previous_best: number
}

export interface FinishResponse extends Workout { prs: PR[] }

export interface ExerciseHistoryItem { workout_id: string; date: string; sets: SetEntry[] }

export interface DashboardSummary {
  week_start: string
  sessions_this_week: number
  trained_dates: string[]
  week_volume: number
  streak_weeks: number
}

export interface ProgressPoint { date: string; top_weight: number; volume: number }

export interface AuthResponse {
  access_token: string
  token_type: string
  user: { id: string; email: string; display_name: string }
}

export interface Conversation {
  id: string
  title: string
  created_at: string
  updated_at: string
  total_cost_usd: number
  total_input_tokens: number
  total_output_tokens: number
}

export interface ChatEvent {
  seq: number
  type: 'text' | 'tool_call' | 'tool_result' | 'done' | 'error'
  text?: string
  name?: string
  args?: Record<string, unknown>
  message?: string
}

export interface Turn {
  id: string
  role: 'user' | 'assistant'
  content: string
  status: 'pending' | 'completed' | 'failed'
  created_at: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  events?: ChatEvent[]
}

export interface ConversationDetail extends Conversation { turns: Turn[] }

export interface StartChatResponse {
  conversation_id: string
  user_turn_id: string
  assistant_turn_id: string
}

export interface UsageSummary {
  month: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  calls: number
}
