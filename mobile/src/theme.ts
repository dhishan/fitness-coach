import { StyleSheet } from 'react-native'

export const colors = {
  primary: '#3b82f6',
  primaryDark: '#2563eb',
  primaryLight: '#60a5fa',

  // Muscle palette (mirrors frontend tailwind palette)
  chest: '#ef4444',
  back: '#3b82f6',
  quads: '#f59e0b',
  hamstrings: '#f97316',
  glutes: '#ec4899',
  shoulders: '#8b5cf6',
  biceps: '#06b6d4',
  triceps: '#10b981',
  core: '#6366f1',
  calves: '#84cc16',
  forearms: '#14b8a6',

  // Gray scale
  gray50: '#f9fafb',
  gray100: '#f3f4f6',
  gray200: '#e5e7eb',
  gray300: '#d1d5db',
  gray400: '#9ca3af',
  gray500: '#6b7280',
  gray600: '#4b5563',
  gray700: '#374151',
  gray800: '#1f2937',
  gray900: '#111827',

  // Semantic
  bg: '#fcfcfc',
  surface: '#ffffff',
  border: '#f3f4f6',
  text: '#111827',
  textSecondary: '#6b7280',
  success: '#22c55e',
  error: '#ef4444',
  warning: '#f59e0b',
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  base: 16,
  lg: 24,
  xl: 32,
}

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  full: 9999,
}

export const shadow = {
  shadowColor: '#000',
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.05,
  shadowRadius: 4,
  elevation: 2,
}

export const card = StyleSheet.create({
  base: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
}).base
