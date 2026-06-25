import axios from 'axios'
import type {
  AuthResponse, Conversation, ConversationDetail, DashboardSummary, Exercise,
  ExerciseCreate, ExerciseHistoryItem, FinishResponse, ProgressPoint,
  StartChatResponse, TemplateCreate, TemplateEntry, UsageSummary, Workout,
  WorkoutEntry, WorkoutListResponse, WorkoutTemplate,
  DayLogs, Estimation, Favorite, FavoriteCreate, FoodLog, FoodLogCreate, FoodLogUpdate,
  FoodSuggestion, Goals, GoalSuggestion, SignedUpload,
  BodyMetric, BodyMetricCreate, BodyMetricUpdate,
  CardioLog, CardioLogCreate, CardioLogUpdate,
  Recipe, RecipeCreate, RecipeUpdate, RecipeLogRequest,
} from '@fitness/shared-types'
import { useAuth } from '../store/auth'

export const API_URL = import.meta.env.VITE_API_URL as string

export interface IngredientHit {
  name: string
  serving: string
  macros: { calories: number; protein_g: number; carbs_g: number; fat_g: number }
  micros?: Record<string, number>
  usda_fdc_id?: number | null
  data_type?: string
  source?: 'usda' | 'off' | 'ifct' | string | null
}

export const api = axios.create({
  baseURL: `${API_URL}/api/v1`,
  timeout: 45_000, // Cloud Run cold starts
})

api.interceptors.request.use((config) => {
  const token = useAuth.getState().token
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(undefined, (error) => {
  if (error.response?.status === 401 && !error.config?.url?.includes('/auth/google')) {
    useAuth.getState().logout()
  }
  return Promise.reject(error)
})

export const authApi = {
  google: (idToken: string) =>
    api.post<AuthResponse>('/auth/google', { id_token: idToken }).then((r) => r.data),
}

export const exercisesApi = {
  list: (params?: { muscle?: string; pattern?: string; q?: string }) =>
    api.get<Exercise[]>('/exercises', { params }).then((r) => r.data),
  create: (body: ExerciseCreate) => api.post<Exercise>('/exercises', body).then((r) => r.data),
  alternatives: (id: string) => api.get<Exercise[]>(`/exercises/${id}/alternatives`).then((r) => r.data),
  history: (id: string, limit = 3) =>
    api.get<ExerciseHistoryItem[]>(`/exercises/${id}/history`, { params: { limit } }).then((r) => r.data),
}

export interface SessionIntentPayload {
  goal?: string
  energy?: number | null
  mental?: number | null
  physical?: number | null
}

export interface NextExerciseSuggestion {
  exercise_id: string
  exercise_name: string
  primary_muscles?: string[]
  movement_pattern?: string
  equipment?: string
  sets: number
  reps: number
  reason: string
}

export const workoutsApi = {
  create: (body: { date: string; notes?: string; entries?: WorkoutEntry[]; intent?: SessionIntentPayload }) =>
    api.post<Workout>('/workouts', body).then((r) => r.data),
  suggestNext: (id: string) =>
    api.post<NextExerciseSuggestion>(`/workouts/${id}/suggest-next`).then((r) => r.data),
  list: (params?: { from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<WorkoutListResponse>('/workouts', { params }).then((r) => r.data),
  active: () => api.get<Workout | null>('/workouts/active').then((r) => r.data),
  get: (id: string) => api.get<Workout>(`/workouts/${id}`).then((r) => r.data),
  update: (id: string, body: { notes?: string; entries?: WorkoutEntry[] }) =>
    api.put<Workout>(`/workouts/${id}`, body).then((r) => r.data),
  finish: (id: string) => api.post<FinishResponse>(`/workouts/${id}/finish`).then((r) => r.data),
  remove: (id: string) => api.delete(`/workouts/${id}`),
}

export const dashboardApi = {
  summary: (referenceDate: string) =>
    api.get<DashboardSummary>('/dashboard/summary', { params: { reference_date: referenceDate } }).then((r) => r.data),
  exerciseProgress: (id: string) =>
    api.get<ProgressPoint[]>(`/dashboard/exercise/${id}`).then((r) => r.data),
  muscleSplit: (referenceDate: string, weeks = 4) =>
    api.get<Record<string, number>>('/dashboard/muscle-split', { params: { reference_date: referenceDate, weeks } }).then((r) => r.data),
}

export const chatApi = {
  start: (message: string, conversationId?: string) =>
    api.post<StartChatResponse>('/chat/start', { message, conversation_id: conversationId }).then((r) => r.data),
  conversations: () => api.get<Conversation[]>('/chat/conversations').then((r) => r.data),
  conversation: (id: string) => api.get<ConversationDetail>(`/chat/conversations/${id}`).then((r) => r.data),
}

export const templatesApi = {
  list: () => api.get<WorkoutTemplate[]>('/templates').then((r) => r.data),
  create: (body: TemplateCreate) =>
    api.post<WorkoutTemplate>('/templates', body).then((r) => r.data),
  get: (id: string) => api.get<WorkoutTemplate>(`/templates/${id}`).then((r) => r.data),
  update: (id: string, body: { name?: string; entries?: TemplateEntry[] }) =>
    api.put<WorkoutTemplate>(`/templates/${id}`, body).then((r) => r.data),
  remove: (id: string) => api.delete(`/templates/${id}`),
}

export interface UsageBySource {
  month: string
  by_source: Record<string, { input_tokens: number; output_tokens: number; cost_usd: number; calls: number }>
}

export const usageApi = {
  summary: (month?: string) =>
    api.get<UsageSummary>('/usage/summary', { params: month ? { month } : {} }).then((r) => r.data),
  summaryBySource: (month?: string) =>
    api.get<UsageBySource>('/usage/summary/by-source', { params: month ? { month } : {} }).then((r) => r.data),
}

export const uploadsApi = {
  signFoodPhoto: (contentType: string) =>
    api.post<SignedUpload>('/uploads/sign-food-photo', { content_type: contentType }).then((r) => r.data),
}

export const bodyApi = {
  list: (params?: { limit?: number }) =>
    api.get<BodyMetric[]>('/body', { params }).then((r) => r.data),
  latest: () =>
    api.get<BodyMetric | null>('/body/latest').then((r) => r.data),
  create: (body: BodyMetricCreate) =>
    api.post<BodyMetric>('/body', body).then((r) => r.data),
  update: (id: string, body: BodyMetricUpdate) =>
    api.put<BodyMetric>(`/body/${id}`, body).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/body/${id}`),
}

export const cardioApi = {
  list: (params?: { from?: string; to?: string; limit?: number; offset?: number }) =>
    api.get<CardioLog[]>('/cardio', { params }).then((r) => r.data),
  create: (body: CardioLogCreate) =>
    api.post<CardioLog>('/cardio', body).then((r) => r.data),
  update: (id: string, body: CardioLogUpdate) =>
    api.put<CardioLog>(`/cardio/${id}`, body).then((r) => r.data),
  remove: (id: string) =>
    api.delete(`/cardio/${id}`),
}

export const nutritionApi = {
  suggestFoods: (q: string, limit = 10) =>
    api.get<FoodSuggestion[]>('/nutrition/foods/suggest', { params: { q, limit } }).then((r) => r.data),
  estimateLabel: (image_url: string) =>
    api.post<Estimation>('/nutrition/estimate/label', { image_url }).then((r) => r.data),
  searchFoods: (q: string, limit = 8) =>
    api.get<IngredientHit[]>('/nutrition/foods/search', { params: { q, limit } }).then((r) => r.data),
  estimateText: (text: string) =>
    api.post<Estimation>('/nutrition/estimate/text', { text }).then((r) => r.data),
  estimatePhoto: (image_url: string, hint?: string) =>
    api.post<Estimation>('/nutrition/estimate/photo', { image_url, hint }).then((r) => r.data),
  barcode: (code: string) =>
    api.get<Estimation & { source?: string; code?: string }>(`/nutrition/barcode/${code}`).then((r) => r.data),
  logs: {
    list: (date: string) =>
      api.get<DayLogs>('/nutrition/logs', { params: { date } }).then((r) => r.data),
    create: (body: FoodLogCreate) =>
      api.post<FoodLog>('/nutrition/logs', body).then((r) => r.data),
    update: (id: string, body: FoodLogUpdate) =>
      api.put<FoodLog>(`/nutrition/logs/${id}`, body).then((r) => r.data),
    remove: (id: string) =>
      api.delete(`/nutrition/logs/${id}`),
  },
  dayStatus: {
    set: (date: string, incomplete: boolean) =>
      api
        .put<{ date: string; incomplete: boolean }>('/nutrition/day-status', { date, incomplete })
        .then((r) => r.data),
  },
  favorites: {
    list: () =>
      api.get<Favorite[]>('/nutrition/favorites').then((r) => r.data),
    create: (body: FavoriteCreate) =>
      api.post<Favorite>('/nutrition/favorites', body).then((r) => r.data),
    update: (id: string, body: FavoriteCreate) =>
      api.put<Favorite>(`/nutrition/favorites/${id}`, body).then((r) => r.data),
    remove: (id: string) =>
      api.delete(`/nutrition/favorites/${id}`),
    log: (id: string, date: string) =>
      api.post<FoodLog>(`/nutrition/favorites/${id}/log`, null, { params: { date } }).then((r) => r.data),
  },
  recipes: {
    list: () =>
      api.get<Recipe[]>('/nutrition/recipes').then((r) => r.data),
    get: (id: string) =>
      api.get<Recipe>(`/nutrition/recipes/${id}`).then((r) => r.data),
    create: (body: RecipeCreate) =>
      api.post<Recipe>('/nutrition/recipes', body).then((r) => r.data),
    update: (id: string, body: RecipeUpdate) =>
      api.put<Recipe>(`/nutrition/recipes/${id}`, body).then((r) => r.data),
    remove: (id: string) =>
      api.delete(`/nutrition/recipes/${id}`),
    log: (id: string, body: RecipeLogRequest) =>
      api.post<FoodLog>(`/nutrition/recipes/${id}/log`, body).then((r) => r.data),
  },
  goals: {
    get: () =>
      api.get<Goals | null>('/nutrition/goals').then((r) => r.data),
    set: (g: Goals) =>
      api.put<Goals>('/nutrition/goals', g).then((r) => r.data),
    suggest: (params?: { bodyweight_kg?: number; goal_text?: string }) =>
      api.post<GoalSuggestion>('/nutrition/goals/suggest', params ?? {}).then((r) => r.data),
  },
}
