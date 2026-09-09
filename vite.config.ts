import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Project GitHub Pages: https://kleinron.github.io/bloom-filter-demo/
export default defineConfig({
  plugins: [react()],
  base: '/bloom-filter-demo/',
})
