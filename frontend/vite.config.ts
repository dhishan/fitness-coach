import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN
const sentryOrg = process.env.SENTRY_ORG
const sentryProject = process.env.SENTRY_PROJECT_WEB

export default defineConfig({
  plugins: [
    react(),
    ...(sentryAuthToken && sentryOrg && sentryProject
      ? [
          sentryVitePlugin({
            authToken: sentryAuthToken,
            org: sentryOrg,
            project: sentryProject,
            release: { name: process.env.VITE_BUILD_ID },
            sourcemaps: { assets: './dist/**' },
          }),
        ]
      : []),
  ],
  build: {
    sourcemap: true,
  },
})
