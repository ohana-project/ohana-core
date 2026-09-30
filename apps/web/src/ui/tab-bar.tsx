import { cn } from 'cn'
import { useTranslation } from 'react-i18next'

import { Icon } from '@/ui/icon.tsx'
import type { ShellSection } from '@/ui/shell.ts'

/*
 * Ohana tab bar (`.tabbar` in the prototype): glass, fixed to the
 * bottom with safe-area padding, one pill per visible section; the
 * active icon sits on an accent-soft plate. Hidden from 920px up.
 */

export interface TabBarProps {
  sections: ShellSection[]
  activeId?: string
  onSectionClick?: (id: string) => void
  className?: string
}

export function TabBar({ sections, activeId, onSectionClick, className }: TabBarProps) {
  const { t } = useTranslation()

  return (
    <nav
      data-slot="tabbar"
      aria-label={t('layout.sections')}
      className={cn(
        'glass-bar fixed inset-x-0 bottom-0 z-30 grid grid-rows-1 grid-flow-col auto-cols-fr gap-0 rounded-none border-0 px-2 pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))] desktop:hidden',
        className,
      )}
    >
      {sections.map((section) => {
        const active = section.id === activeId
        return (
          <button
            key={section.id}
            type="button"
            data-slot="tab"
            aria-current={active ? 'page' : undefined}
            onClick={() => onSectionClick?.(section.id)}
            className={cn(
              'flex min-h-12 flex-col items-center gap-[3px] rounded-md pt-1 pb-0.5 text-[11.5px] font-medium transition-colors duration-(--t-fast) ease-(--ease) hover:text-foreground aria-[current=page]:text-primary',
              active ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <Icon
              name={section.icon}
              className={cn(
                'h-7 w-10 rounded-full px-2 py-0.5 transition-colors duration-(--t-fast) ease-(--ease)',
                active && 'bg-primary-soft',
              )}
            />
            <span>{section.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
