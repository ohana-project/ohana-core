import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers.tsx'
import { createAppRouter } from '@/app/router.tsx'
// The install prompt must be captured on every route: Chromium fires the
// event once per page load, wherever the visitor happens to be.
import '@/lib/install-prompt.ts'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('The #root element is missing from index.html')
}

createRoot(rootElement).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={createAppRouter()} />
    </AppProviders>
  </StrictMode>,
)
