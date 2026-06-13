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
  images?: string[]
  instructions?: string[]
  difficulty?: string | null
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

export interface TemplateEntry {
  exercise_id: string
  exercise_name: string
  target_sets: number
  superset_group?: string | null
}

export interface WorkoutTemplate {
  id: string
  user_id: string
  name: string
  entries: TemplateEntry[]
  created_at: string
  updated_at: string
}

export interface TemplateCreate {
  name: string
  entries?: TemplateEntry[]
}

export interface UsageSummary {
  month: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  calls: number
}

// Nutrition types
export interface Macros { calories: number; protein_g: number; carbs_g: number; fat_g: number }
export type FoodLogSource = 'ai_text' | 'ai_photo' | 'favorite' | 'manual'
export interface FoodLog {
  id: string; user_id: string; date: string; name: string; serving: string;
  macros: Macros; source: FoodLogSource; notes: string; created_at: string
}
export interface FoodLogCreate { date: string; name: string; serving?: string; macros: Macros; source?: FoodLogSource; notes?: string }
export interface FoodLogUpdate { name?: string; serving?: string; macros?: Macros; notes?: string }
export interface Favorite { id: string; user_id: string; name: string; serving: string; macros: Macros; last_used_at: string | null }
export interface FavoriteCreate { name: string; serving?: string; macros: Macros }
export interface Goals { calories: number; protein_g: number; carbs_g: number; fat_g: number }
export interface DayLogs { items: FoodLog[]; totals: Macros }
export interface Estimation { name: string; serving: string; macros: Macros; confidence: number }
export interface GoalSuggestion { proposal: Goals; rationale: string }
export interface SignedUpload { upload_url: string; gs_url: string; public_url: string; content_type: string }

// Cardio types
export type CardioType = 'run' | 'ride' | 'walk' | 'swim' | 'other'
export interface CardioLog {
  id: string; user_id: string; date: string;
  type: CardioType; duration_s: number; distance_m: number;
  avg_hr?: number | null; calories?: number | null; notes: string;
  source: 'manual' | 'healthkit'; external_id?: string | null;
  created_at: string;
}
export interface CardioLogCreate {
  date: string; type: CardioType; duration_s: number;
  distance_m?: number; avg_hr?: number | null; calories?: number | null;
  notes?: string; source?: 'manual' | 'healthkit'; external_id?: string | null;
}
export interface CardioLogUpdate {
  type?: CardioType; duration_s?: number; distance_m?: number;
  avg_hr?: number | null; calories?: number | null; notes?: string;
}

// Body Metrics types
export interface BodyMetric {
  id: string
  user_id: string
  date: string
  weight_kg: number
  body_fat_pct?: number | null
  waist_cm?: number | null
  chest_cm?: number | null
  arm_cm?: number | null
  thigh_cm?: number | null
  photo_urls: string[]
  notes: string
  created_at: string
}

export interface BodyMetricCreate {
  date: string
  weight_kg: number
  body_fat_pct?: number | null
  waist_cm?: number | null
  chest_cm?: number | null
  arm_cm?: number | null
  thigh_cm?: number | null
  photo_urls?: string[]
  notes?: string
}

export interface BodyMetricUpdate {
  weight_kg?: number | null
  body_fat_pct?: number | null
  waist_cm?: number | null
  chest_cm?: number | null
  arm_cm?: number | null
  thigh_cm?: number | null
  photo_urls?: string[] | null
  notes?: string | null
}
