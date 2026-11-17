import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import ThemeToggle from '../ThemeToggle'

function initialsFor(user) {
  const name = user?.display_name || user?.email || 'Usuario'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'T'
}

export default function AppSidebar({
  groups,
  user,
  roleLabel,
  onLogout,
  onNavigate,
  variant = 'desktop',
}) {
  const desktop = variant === 'desktop'
  const displayName = user?.display_name || user?.email || 'Usuario'
  const initials = initialsFor(user)

  return (
    <div
      data-variant={variant}
      data-testid={desktop ? 'sidebar-panel' : undefined}
      className="app-sidebar flex h-full min-h-0 w-full min-w-0 flex-col"
    >
      <div
        data-testid={desktop ? 'sidebar-brand' : undefined}
        className="app-sidebar-brand flex items-center gap-3 px-4 py-5"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-700 font-bold text-white" aria-hidden="true">T</span>
        <div className="app-sidebar-brand-text min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">TERRA</p>
          <p className="truncate text-xs text-slate-500">Gestión documental</p>
        </div>
      </div>

      <nav
        data-testid={desktop ? 'sidebar-navigation' : undefined}
        aria-label="Navegación principal"
        className="app-sidebar-navigation admin-scroll-container min-h-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto overscroll-contain px-3 pb-4"
      >
        {groups.map((group) => {
          const headingId = `sidebar-${variant}-${group.id}`
          return (
            <div key={group.id} className="app-sidebar-group">
              <h3
                id={headingId}
                className="app-sidebar-group-title px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
              >
                {group.label}
              </h3>
              <ul aria-labelledby={headingId} className="space-y-1">
                {group.items.map((item) => {
                  const Icon = item.icon
                  return (
                    <li key={item.to}>
                      <NavLink
                        to={item.to}
                        end={item.end}
                        aria-label={item.label}
                        title={item.label}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `app-sidebar-link flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="app-sidebar-link-text truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div data-testid={desktop ? 'sidebar-footer' : undefined} className="app-sidebar-footer border-t border-slate-200 p-3">
        <div
          data-testid={desktop ? 'sidebar-user' : undefined}
          className="app-sidebar-user flex items-center gap-2 rounded-xl bg-muted px-3 py-3"
        >
          <span
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800"
            title={`${displayName} · ${roleLabel}`}
            aria-hidden="true"
          >
            {initials}
          </span>
          <div className="app-sidebar-user-info min-w-0">
            <p className="truncate text-sm font-medium text-slate-800" title={displayName}>{displayName}</p>
            <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            {user?.area_name ? <p className="mt-1 truncate text-xs text-slate-400" title={user.area_name}>{user.area_name}</p> : null}
          </div>
        </div>
        <div className="app-sidebar-footer-actions mt-2 flex items-stretch gap-2">
          <button
            type="button"
            onClick={onLogout}
            aria-label="Cerrar sesión"
            className="app-sidebar-logout flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2.5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="app-sidebar-logout-text truncate">Cerrar sesión</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}
