import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [vue()],
  build: {
    // Preserve the browser syntax targets previously supplied by Vite 6.
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14']
  }
})
