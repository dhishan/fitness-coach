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
  title?: string | null
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
export interface Micros {
  fiber_g: number
  sugar_g: number
  sodium_mg: number
  potassium_mg: number
  calcium_mg: number
  iron_mg: number
  vitamin_c_mg: number
  vitamin_d_mcg: number
  saturated_fat_g: number
  cholesterol_mg: number
}
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'
export type FoodLogSource = 'ai_text' | 'ai_photo' | 'favorite' | 'manual'
export interface FoodLog {
  id: string; user_id: string; date: string; name: string; description?: string; serving: string;
  macros: Macros; source: FoodLogSource; notes: string; created_at: string;
  meal_type?: MealType | null;
  logged_at?: string | null;
  micros?: Micros | null;
  usda_fdc_id?: number | null;
  micros_source?: 'ai' | 'usda' | 'label' | null;
}
export interface FoodLogCreate {
  date: string; name: string; description?: string; serving?: string; macros: Macros; source?: FoodLogSource; notes?: string;
  meal_type?: MealType | null;
  logged_at?: string | null;
  micros?: Micros | null;
  usda_fdc_id?: number | null;
  micros_source?: 'ai' | 'usda' | 'label' | null;
}
export interface FoodLogUpdate {
  date?: string;
  name?: string; description?: string; serving?: string; macros?: Macros; notes?: string;
  meal_type?: MealType | null;
  logged_at?: string | null;
  micros?: Micros | null;
}
export interface Favorite { id: string; user_id: string; name: string; serving: string; macros: Macros; micros?: Micros | null; micros_source?: 'ai' | 'usda' | 'label' | null; last_used_at: string | null }
export interface FavoriteCreate { name: string; serving?: string; macros: Macros; micros?: Micros | null; micros_source?: 'ai' | 'usda' | 'label' | null }

// ---- Recipes ----
export interface RecipeIngredient {
  name: string
  serving_label: string
  servings_used: number
  calories_per_serving: number
  protein_g_per_serving: number
  carbs_g_per_serving: number
  fat_g_per_serving: number
  fiber_g_per_serving?: number
  sugar_g_per_serving?: number
  sodium_mg_per_serving?: number
  potassium_mg_per_serving?: number
  calcium_mg_per_serving?: number
  iron_mg_per_serving?: number
  vitamin_c_mg_per_serving?: number
  vitamin_d_mcg_per_serving?: number
  saturated_fat_g_per_serving?: number
  cholesterol_mg_per_serving?: number
  usda_fdc_id?: number | null
}
export interface Recipe {
  id: string
  user_id: string
  name: string
  yields_servings: number
  ingredients: RecipeIngredient[]
  notes: string
  totals_macros: Macros
  totals_micros: Micros
  per_serving_macros: Macros
  per_serving_micros: Micros
  created_at?: string
  updated_at?: string
}
export interface RecipeCreate {
  name: string
  yields_servings: number
  ingredients: RecipeIngredient[]
  notes?: string
}
export interface RecipeUpdate {
  name?: string
  yields_servings?: number
  ingredients?: RecipeIngredient[]
  notes?: string
}
export interface RecipeLogRequest {
  date: string
  servings_eaten: number
  meal_type?: 'breakfast' | 'lunch' | 'dinner' | 'snack' | null
  logged_at?: string | null
}
export interface Goals {
  calories: number; protein_g: number; carbs_g: number; fat_g: number;
  micros_targets?: Micros | null;
}
export interface DayLogs { items: FoodLog[]; totals: Macros; micros_totals?: Micros; incomplete?: boolean }
export interface Estimation {
  name: string; description?: string; serving: string; macros: Macros; confidence: number;
  micros?: Micros;
  usda_fdc_id?: number | null;
  micros_source?: 'ai' | 'usda' | 'label' | null;
  is_label?: boolean;
}
export interface FoodSuggestion {
  name: string
  serving: string
  macros: Macros
  source: 'favorite' | 'recent'
  last_used_at: string | null
}
export interface GoalSuggestion {
  proposal: Goals & { micros_targets?: Micros | null }
  rationale: string
}
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

// HealthKit types
export type HealthKitSampleKind = 'weight' | 'steps' | 'workout' | 'hrv' | 'sleep'
export interface HealthKitSample {
  kind: HealthKitSampleKind
  external_id: string
  date: string
  started_at?: string | null
  ended_at?: string | null
  value?: number | null
  workout_type?: string | null
  duration_s?: number | null
  distance_m?: number | null
  avg_hr?: number | null
  calories?: number | null
}
export interface HealthKitBatch {
  samples: HealthKitSample[]
}
export interface HealthKitSyncResult {
  imported: { weight: number; steps: number; workouts: number; hrv: number; sleep: number }
  skipped: number
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
