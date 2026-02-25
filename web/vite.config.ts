import { fileURLToPath } from "node:url"
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const projectRoot = fileURLToPath(new URL(".", import.meta.url))
  const srcRoot = fileURLToPath(new URL("./src", import.meta.url))
  const env = loadEnv(mode, projectRoot, "")
  const enableReactScane = env.ENABLE_REACT_SCANE === "true"
  const internalDebug = env.INTERNAL_DEBUG === "true"

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "#": srcRoot,
      },
    },
    define: {
      __ENABLE_REACT_SCANE__: JSON.stringify(enableReactScane),
      __INTERNAL_DEBUG__: JSON.stringify(internalDebug),
    },
  }
})
