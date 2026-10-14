import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages hosts this repository under /Mahi-Voice-Assist/; local and
  // Render builds continue to use the domain root.
  base: process.env.GITHUB_ACTIONS === 'true' ? '/Mahi-Voice-Assist/' : '/',
})
