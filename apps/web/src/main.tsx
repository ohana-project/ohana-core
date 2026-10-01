import { RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppProviders } from '@/app/providers.tsx'
import { createAppRouter } from '@/app/router.tsx'
// Both stores capture browser events that fire once per page load wherever
// the visitor happens to be — the eager imports keep that independent of
// which screen (and which shell) is on screen.
import '@/lib/app-update.ts'
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
