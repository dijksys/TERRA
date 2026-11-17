import { useEffect, useId, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeftRight,
  Building2,
  Database,
  FileClock,
  HardDrive,
  Home,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Menu,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../app/AuthContext'
import ThemeToggle from '../components/ThemeToggle'
import { PERMISSIONS } from '../features/auth/permissions'

const workerNavGroups = [
  {
    id: 'general',
    label: 'GENERAL',
    items: [
      { to: '/app', label: 'Inicio', icon: Home, end: true },
      { to: '/app/profile', label: 'Mi perfil', icon: UserRound },
    ],
  },
  {
    id: 'documents',
    label: 'GESTIÓN DOCUMENTAL',
    items: [
      { to: '/app/drive', label: 'Google Drive', icon: HardDrive },
      { to: '/app/jobs', label: 'Mis descargas', icon: ListChecks },
    ],
  },
  {
    id: 'account-security',
    label: 'CUENTA Y SEGURIDAD',
    items: [
      { to: '/app/security', label: 'Seguridad', icon: ShieldCheck },
    ],
  },
]

const adminNavGroups = [
  {
    id: 'general',
    label: 'GENERAL',
    items: [
      { to: '/app/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, permission: PERMISSIONS.DASHBOARD_READ },
    ],
  },
  {
    id: 'organization',
    label: 'ORGANIZACIÓN',
    items: [
      { to: '/app/admin/workers', label: 'Trabajadores', icon: Users, permission: PERMISSIONS.USERS_READ },
      { to: '/app/admin/organization', label: 'Áreas y cargos', icon: Building2, permission: PERMISSIONS.ORGANIZATION_READ },
    ],
  },
  {
    id: 'documents',
    label: 'GESTIÓN DOCUMENTAL',
    items: [
      { to: '/app/admin/connections', label: 'Conexiones Drive', icon: Database, permission: PERMISSIONS.DRIVE_READ },
      { to: '/app/admin/downloads', label: 'Descargas', icon: ArrowLeftRight, permission: PERMISSIONS.JOBS_CREATE },
      { to: '/app/admin/jobs', label: 'Trabajos', icon: FileClock, permission: PERMISSIONS.JOBS_READ },
    ],
  },
  {
    id: 'institutional-control',
    label: 'CONTROL INSTITUCIONAL',
    items: [
      { to: '/app/admin/audit', label: 'Auditoría', icon: ScrollText, permission: [PERMISSIONS.AUDIT_READ, PERMISSIONS.AUDIT_OPERATIONAL_READ] },
      { to: '/app/admin/policy', label: 'Política', icon: KeyRound, permission: PERMISSIONS.POLICY_WRITE },
    ],
  },
  {
    id: 'account-security',
    label: 'CUENTA Y SEGURIDAD',
    items: [
      { to: '/app/security', label: 'Seguridad', icon: ShieldCheck },
    ],
  },
]

function itemAllowed(item, can) {
  if (!item.permission) return true
  return Array.isArray(item.permission) ? item.permission.some(can) : can(item.permission)
}

function filterNavGroups(groups, can) {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => itemAllowed(item, can)) }))
    .filter((group) => group.items.length > 0)
}

const roleLabels = {
  admin: 'Administrador',
  moderator: 'Moderador',
  read_only: 'Solo lectura',
  user: 'Trabajador',
}

function currentSection(groups, pathname, fallback) {
  const match = groups.flatMap((group) => group.items)
    .find((item) => (item.end ? pathname === item.to : pathname.startsWith(item.to)))
  return match?.label || fallback
}

function Sidebar({ groups, user, onLogout, onNavigate, variant = 'rail' }) {
  const idPrefix = useId()
  const rail = variant === 'rail'
  const displayName = user?.display_name || user?.email || 'Usuario'
  const roleLabel = roleLabels[user?.roles?.[0]] || 'Usuario'
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || 'T'

  return (
    <div
      data-testid={rail ? 'sidebar-panel' : undefined}
      className={
        rail
          ? 'terra-sidebar-panel terra-sidebar-panel--rail flex h-full flex-col rounded-[22px] border border-slate-200 bg-sidebar-background shadow-sm'
          : 'flex h-full w-full min-w-0 flex-col'
      }
    >
      <div
        data-testid={rail ? 'sidebar-brand' : undefined}
        className="terra-sidebar-brand flex items-center gap-3 px-4 py-5"
      >
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-700 font-bold text-white" aria-hidden="true">T</span>
        <div className="terra-sidebar-reveal min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">TERRA</p>
          <p className="truncate text-xs text-slate-500">Gestión documental</p>
        </div>
      </div>

      <nav
        data-testid={rail ? 'sidebar-navigation' : undefined}
        aria-label="Navegación principal"
        className="admin-scroll-container min-h-0 flex-1 space-y-4 overflow-y-auto px-3 pb-4"
      >
        {groups.map((group) => {
          const headingId = `${idPrefix}-${group.id}`
          return (
            <div key={group.id} className="terra-sidebar-group">
              <h3
                id={headingId}
                className="terra-sidebar-group-label px-3 pb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
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
                        title={item.label}
                        onClick={onNavigate}
                        className={({ isActive }) =>
                          `terra-sidebar-link flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                            isActive ? 'bg-brand-50 text-brand-800' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                          }`
                        }
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        <span className="terra-sidebar-reveal truncate">{item.label}</span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </nav>

      <div data-testid={rail ? 'sidebar-footer' : undefined} className="border-t border-slate-200 p-3">
        <div data-testid={rail ? 'sidebar-user' : undefined} className="terra-sidebar-user flex items-center gap-2 rounded-xl bg-muted px-3 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-50 text-xs font-semibold text-brand-800" aria-hidden="true">
            {initials}
          </span>
          <div className="terra-sidebar-reveal min-w-0">
            <p className="truncate text-sm font-medium text-slate-800" title={displayName}>{displayName}</p>
            <p className="truncate text-xs text-slate-500">{roleLabel}</p>
            {user?.area_name ? <p className="mt-1 truncate text-xs text-slate-400" title={user.area_name}>{user.area_name}</p> : null}
          </div>
        </div>
        <div className="terra-sidebar-footer-actions mt-2 flex items-stretch gap-2">
          <button
            type="button"
            onClick={onLogout}
            aria-label="Cerrar sesión"
            className="terra-sidebar-logout flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl px-2.5 py-2.5 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="terra-sidebar-reveal truncate">Cerrar sesión</span>
          </button>
          <ThemeToggle />
        </div>
      </div>
    </div>
  )
}

export default function AppLayout() {
  const { user, isAdministrative, isWorker, can, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const mainRef = useRef(null)
  const previousPath = useRef(location.pathname)
  const navGroups = filterNavGroups(isWorker ? workerNavGroups : adminNavGroups, can)

  useEffect(() => {
    if (previousPath.current === location.pathname) return
    previousPath.current = location.pathname
    mainRef.current?.focus({ preventScroll: true })
  }, [location.pathname])

  const handleLogout = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  const handleNavigate = (event) => {
    setOpen(false)
    if (event && (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)) return
    window.requestAnimationFrame(() => {
      mainRef.current?.focus({ preventScroll: true })
    })
  }

  const headerLabel = isAdministrative ? 'Panel administrativo' : isWorker ? 'Panel del trabajador' : 'Panel restringido'
  const sectionLabel = currentSection(navGroups, location.pathname, headerLabel)
  const testIds = isWorker
    ? { sidebar: 'worker-sidebar', workspace: 'worker-workspace', scroll: 'worker-scroll', drawer: 'worker-drawer' }
    : { sidebar: 'admin-sidebar', workspace: 'admin-workspace', scroll: 'admin-scroll', drawer: 'admin-drawer' }
  const railSidebar = (
    <Sidebar variant="rail" groups={navGroups} user={user} onLogout={handleLogout} onNavigate={handleNavigate} />
  )
  const drawerSidebar = (
    <Sidebar variant="drawer" groups={navGroups} user={user} onLogout={handleLogout} onNavigate={handleNavigate} />
  )

  return (
    <div className="h-dvh bg-shell p-3 sm:p-4">
      <div className="mx-auto flex h-full w-full max-w-[1920px] gap-3 sm:gap-4">
        <aside
          data-testid={testIds.sidebar}
          className="terra-sidebar-rail relative hidden h-full shrink-0 rounded-[22px] bg-sidebar-background shadow-sm md:flex"
        >
          {railSidebar}
        </aside>

        <div
          data-testid={testIds.workspace}
          className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-surface shadow-sm"
        >
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-slate-200 px-4 sm:px-6">
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-700">
                {headerLabel}
                <span className="text-slate-400"> · </span>
                {sectionLabel}
              </p>
            </div>
            <div className="hidden items-center gap-2 @xl:flex">
              <span
                className="max-w-[10rem] truncate rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 @3xl:max-w-[14rem] @5xl:max-w-[16rem]"
                title={user?.area_name || 'Sin área'}
              >
                {user?.area_name || 'Sin área'}
              </span>
              <span className="max-w-[8rem] truncate rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                {roleLabels[user?.roles?.[0]] || 'Usuario'}
              </span>
            </div>
          </header>

          <div
            ref={mainRef}
            data-testid={testIds.scroll}
            tabIndex={0}
            aria-label={`Contenido del ${headerLabel.toLowerCase()}`}
            className="admin-scroll-container min-h-0 min-w-0 flex-1 overflow-y-auto"
          >
            <main className="@container mx-auto w-full px-4 py-6 sm:px-6 lg:px-7 lg:py-8">
              <Outlet />
            </main>
          </div>
        </div>
      </div>

      {open ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 dark:bg-black/70"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          />
          <aside
            data-testid={testIds.drawer}
            className="relative m-3 flex h-[calc(100dvh-1.5rem)] w-[280px] max-w-[85vw] flex-col overflow-hidden rounded-[22px] border border-slate-200 bg-sidebar-background shadow-xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute right-3 top-4 z-10 rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"
              aria-label="Cerrar menú"
            >
              <X className="h-5 w-5" />
            </button>
            {drawerSidebar}
          </aside>
        </div>
      ) : null}
    </div>
  )
}
