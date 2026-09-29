import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { AppProviders } from '../app/providers.tsx'

export function renderWithProviders(ui: ReactNode) {
  return render(<AppProviders>{ui}</AppProviders>)
}
