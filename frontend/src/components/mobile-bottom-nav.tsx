import { useTranslation } from 'react-i18next'
import { Link, useLocation } from 'react-router-dom'
import { ArrowLeftRight, Building2, LayoutDashboard, Menu, Plus, Target } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ModuleId } from '@/lib/modules'

interface MobileBottomNavProps {
  /** Opens the quick add; absent for someone who can only view. */
  onQuickAdd?: () => void
  /** Opens the full menu (the sidebar drawer). */
  onMenu: () => void
  hasModule: (id: ModuleId) => boolean
}

type Tab = { key: string; path: string; icon: React.ElementType; module?: ModuleId }

/**
 * Thumb-reach navigation for phones: the four places used every day and a
 * big button to add a transaction in the middle, like the church app.
 * Everything else stays one tap away in the menu.
 */
export function MobileBottomNav({ onQuickAdd, onMenu, hasModule }: MobileBottomNavProps) {
  const { t } = useTranslation()
  const location = useLocation()

  const tabs: Tab[] = [
    { key: 'dashboard', path: '/', icon: LayoutDashboard },
    { key: 'transactions', path: '/transactions', icon: ArrowLeftRight, module: 'transactions' },
    { key: 'goals', path: '/goals', icon: Target, module: 'goals' },
    { key: 'accounts', path: '/accounts', icon: Building2, module: 'accounts' },
  ]
  const shown = tabs.filter((tab) => !tab.module || hasModule(tab.module)).slice(0, onQuickAdd ? 3 : 4)
  const isActive = (path: string) => (path === '/' ? location.pathname === '/' : location.pathname.startsWith(path))

  const tabLink = (tab: Tab) => {
    const active = isActive(tab.path)
    const Icon = tab.icon
    return (
      <Link
        key={tab.key}
        to={tab.path}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold transition-colors',
          active ? 'text-primary' : 'text-sidebar-muted hover:text-sidebar-foreground',
        )}
      >
        <Icon size={21} strokeWidth={active ? 2.4 : 2} />
        {t(`nav.${tab.key}`)}
      </Link>
    )
  }

  return (
    <nav
      aria-label={t('nav.bottomNav')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-sidebar-border bg-sidebar/95 backdrop-blur lg:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center px-2">
        {shown.slice(0, 2).map(tabLink)}
        {onQuickAdd ? (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={onQuickAdd}
              aria-label={t('transactions.addManual')}
              className="-mt-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-primary/30 transition-transform active:scale-95"
            >
              <Plus size={26} strokeWidth={2.5} />
            </button>
          </div>
        ) : (
          shown[2] && tabLink(shown[2])
        )}
        {shown.slice(onQuickAdd ? 2 : 3).map(tabLink)}
        <button
          type="button"
          onClick={onMenu}
          className="flex flex-col items-center justify-center gap-0.5 rounded-xl py-1.5 text-[11px] font-semibold text-sidebar-muted transition-colors hover:text-sidebar-foreground"
        >
          <Menu size={21} />
          {t('nav.more')}
        </button>
      </div>
    </nav>
  )
}
