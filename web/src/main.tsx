import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@xyflow/react/dist/style.css'
import './index.css'
import App from './App.tsx'

const bootstrap = async (): Promise<void> => {
  if (__ENABLE_REACT_SCANE__) {
    try {
      const { scan } = await import("react-scan")
      scan({
        enabled: true,
        dangerouslyForceRunInProduction: true,
      })
    } catch (error) {
      console.warn("Failed to initialize react-scan:", error)
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void bootstrap()
