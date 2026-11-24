import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '@/App'
import { Gate } from '@/components/sign-in'
import '@/index.css'
import { isIosApp } from '@/lib/backend'
import { keepSafeArea } from '@/lib/safe-area'

// Only the iPhone and iPad app has a native safe area to ask for (lib/safe-area.ts).
if (isIosApp) keepSafeArea()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Gate>
      <App />
    </Gate>
  </StrictMode>,
)
