import { useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
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
  Menu,
  ScrollText,
  ShieldCheck,
  UserRound,
  Users,
  X,
} from 'lucide-react'
import { useAuth } from '../app/AuthContext'
import AppSidebar from '../components/navigation/AppSidebar'
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

export default function AppLayout() {
  const { user, isAdministrative, isWorker, can, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const navGroups = filterNavGroups(isWorker ? workerNavGroups : adminNavGroups, can)
  const roleLabel = roleLabels[user?.roles?.[0]] || 'Usuario'

  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [open])

  const handleLogout = async () => {
    await logout()
    navigate('/', { replace: true })
  }

  const handleNavigate = () => setOpen(false)

  const headerLabel = isAdministrative ? 'Panel administrativo' : isWorker ? 'Panel del trabajador' : 'Panel restringido'
  const sectionLabel = currentSection(navGroups, location.pathname, headerLabel)
  const testIds = isWorker
    ? { sidebar: 'worker-sidebar', workspace: 'worker-workspace', scroll: 'worker-scroll', drawer: 'worker-drawer' }
    : { sidebar: 'admin-sidebar', workspace: 'admin-workspace', scroll: 'admin-scroll', drawer: 'admin-drawer' }
  const railSidebar = (
    <AppSidebar
      variant="desktop"
      groups={navGroups}
      user={user}
      roleLabel={roleLabel}
      onLogout={handleLogout}
      onNavigate={handleNavigate}
    />
  )
  const drawerSidebar = (
    <AppSidebar
      variant="drawer"
      groups={navGroups}
      user={user}
      roleLabel={roleLabel}
      onLogout={handleLogout}
      onNavigate={handleNavigate}
    />
  )

  return (
    <div className="h-dvh bg-shell p-3 sm:p-4">
      <div className="app-shell mx-auto flex h-full w-full max-w-[1920px] gap-3 sm:gap-4">
        <aside
          data-testid={testIds.sidebar}
          className="app-sidebar-desktop hidden h-full min-h-0 shrink-0 flex-col overflow-visible rounded-[22px] border border-slate-200 bg-sidebar-background shadow-sm min-[861px]:flex"
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
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 min-[861px]:hidden"
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
        <div className="fixed inset-0 z-40 min-[861px]:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-slate-900/40 dark:bg-black/70"
            aria-label="Cerrar menú"
            onClick={() => setOpen(false)}
          />
          <aside
            data-testid={testIds.drawer}
            role="dialog"
            aria-modal="true"
            aria-label="Navegación"
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
