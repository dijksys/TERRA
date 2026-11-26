import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Database,
  FileClock,
  HardDrive,
  ListChecks,
  RefreshCw,
  ShieldAlert,
  Users,
} from 'lucide-react'
import { api } from '../../services/api'
import { useAuth } from '../../app/AuthContext'
import { PERMISSIONS } from '../../features/auth/permissions'
import { Alert, Card, CardBody, LoadingBlock, PageHeader, StatCard } from '../../components/ui'
import { formatBytes, formatDate } from '../../utils/format'
import { useRealtimeChannel } from '../../features/realtime/RealtimeContext'

function ageLabel(seconds) {
  if (!seconds) return '—'
  if (seconds < 60) return `${Math.round(seconds)} s`
  return `${Math.round(seconds / 60)} min`
}

export default function AdminDashboard() {
  const { can } = useAuth()
  const canCreateJobs = can(PERMISSIONS.JOBS_CREATE)
  const canReadUsers = can(PERMISSIONS.USERS_READ)
  const canReadOrganization = can(PERMISSIONS.ORGANIZATION_READ)
  const canReadJobs = can(PERMISSIONS.JOBS_READ)
  const canReadDrive = can(PERMISSIONS.DRIVE_READ)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    api
      .get('/admin/dashboard')
      .then((result) => active && setData(result))
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [])

  useRealtimeChannel('admin.dashboard', (message) => {
    if (message.type === 'dashboard.snapshot' || message.type === 'dashboard.metrics') {
      setData(message.data)
    }
  })

  if (error) return <Alert tone="error">{error}</Alert>
  if (!data) return <LoadingBlock />

  const threshold = data.queue_warning_threshold_seconds || 900
  const queuedAge = data.oldest_queued_age_seconds ?? data.oldest_queue_age_seconds ?? 0
  const queueWarning = data.queued_jobs > 0 && queuedAge >= threshold
  const jobsLink = canReadJobs ? '/app/admin/jobs' : undefined
  const hasQuickLinks = canReadUsers || canReadDrive || canReadJobs || can(PERMISSIONS.POLICY_WRITE)

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Estado operativo de TERRA: identidades, conexiones, trabajos y almacenamiento institucional."
        actions={canCreateJobs ? (
          <Link to="/app/admin/downloads" className="btn-primary whitespace-nowrap">
            <ArrowRight className="h-4 w-4" /> Nueva descarga
          </Link>
        ) : null}
      />

      <div className="grid gap-4 @sm:grid-cols-2 @3xl:grid-cols-3">
        <StatCard
          label="Trabajadores activos"
          value={data.active_users}
          hint={`${data.pending_profiles} perfiles pendientes`}
          icon={Users}
          to={canReadUsers ? '/app/admin/workers?status=active' : undefined}
        />
        <StatCard
          label="Áreas / cargos"
          value={`${data.areas} / ${data.positions}`}
          hint="Catálogo organizativo"
          icon={Database}
          to={canReadOrganization ? '/app/admin/organization' : undefined}
        />
        <StatCard
          label="Trabajos en curso"
          value={data.running_jobs + data.queued_jobs + data.waiting_authorization_jobs}
          hint={`${data.queued_jobs} en cola · ${data.waiting_authorization_jobs} en espera`}
          icon={ListChecks}
          to={jobsLink ? `${jobsLink}?status=active` : undefined}
        />
        <StatCard
          label="Almacenamiento"
          value={formatBytes(data.stored_bytes)}
          hint="Documentos resguardados · informativo"
          icon={HardDrive}
        />
        <StatCard
          label="Completados"
          value={data.completed_jobs}
          hint="Snapshots finalizados"
          icon={FileClock}
          to={jobsLink ? `${jobsLink}?status=completed` : undefined}
        />
        <StatCard
          label="Fallidos / parciales"
          value={data.failed_jobs}
          hint="Requieren revisión"
          icon={ShieldAlert}
          tone="text-amber-600"
          to={jobsLink ? `${jobsLink}?status=attention` : undefined}
        />
        <StatCard
          label="Drives conectados"
          value={data.connected_drives}
          hint={`${data.reauth_drives} requieren reconexión`}
          icon={Database}
          tone="text-emerald-600"
          to={canReadDrive ? '/app/admin/connections?status=connected' : undefined}
        />
        <StatCard
          label="Requieren reconexión"
          value={data.reauth_drives}
          hint="Conexiones sin refresh token o reautorización pendiente"
          icon={RefreshCw}
          tone="text-amber-600"
          to={canReadDrive ? '/app/admin/connections?status=reauthorization_required' : undefined}
        />
        <StatCard
          label="Cola más antigua"
          value={ageLabel(queuedAge)}
          hint={`${data.queued_jobs} en cola · alerta desde ${Math.round(threshold / 60)} min`}
          icon={Activity}
          tone={queueWarning ? 'text-amber-600' : 'text-brand-700'}
          to={jobsLink ? `${jobsLink}?status=queued` : undefined}
        />
      </div>

      {queueWarning ? (
        <div className="mt-4">
          <Alert tone="warning" title="Cola con espera prolongada">
            El trabajo en cola más antiguo lleva {ageLabel(queuedAge)} esperando. El umbral configurado es{' '}
            {Math.round(threshold / 60)} minutos y hay {data.queued_jobs} trabajo(s) en cola.{' '}
            {jobsLink ? <Link to={`${jobsLink}?status=queued`} className="font-semibold underline">Revisar cola</Link> : null}
          </Alert>
        </div>
      ) : null}

      {data.waiting_authorization_jobs > 0 ? (
        <div className="mt-4">
          <Alert tone="warning" title="Trabajos esperando autorización">
            Hay trabajos que esperan que sus propietarios vuelvan a autorizar Google Drive
            ({data.waiting_authorization_jobs} en espera).{' '}
            {canReadDrive ? (
              <Link to="/app/admin/connections?status=reauthorization_required" className="font-semibold underline">
                Revisar conexiones
              </Link>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {data.reauth_drives > 0 ? (
        <div className="mt-4">
          <Alert tone="warning" title="Conexiones que requieren reconexión">
            {data.reauth_drives} conexión(es) necesitan que el trabajador vuelva a autorizar su cuenta.
            {' '}
            {canReadDrive ? (
              <Link to="/app/admin/connections?status=reauthorization_required" className="font-semibold underline">
                Ver conexiones
              </Link>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {data.failed_jobs > 0 ? (
        <div className="mt-4">
          <Alert tone="warning" title="Trabajos fallidos o parciales">
            Hay {data.failed_jobs} trabajo(s) que requieren revisión.
            {' '}
            {jobsLink ? <Link to={`${jobsLink}?status=attention`} className="font-semibold underline">Revisar trabajos</Link> : null}
          </Alert>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 @3xl:grid-cols-3">
        <Card className="@3xl:col-span-2">
          <CardBody>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Actividad reciente</h2>
              {can(PERMISSIONS.AUDIT_READ) || can(PERMISSIONS.AUDIT_OPERATIONAL_READ) ? (
                <Link to="/app/admin/audit" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                  Ver auditoría <ArrowRight className="h-4 w-4" />
                </Link>
              ) : null}
            </div>
            {data.recent_activity?.length ? (
              <ul className="divide-y divide-slate-100">
                {data.recent_activity.map((event) => (
                  <li key={event.id} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">{event.action}</p>
                      <p className="text-xs text-slate-500">
                        {event.actor_name || 'Sistema'} · {event.target_type}
                        {event.target_id ? ` · ${event.target_id.slice(0, 8)}` : ''}
                      </p>
                    </div>
                    <span className="whitespace-nowrap text-xs text-slate-400">{formatDate(event.created_at)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-8 text-center text-sm text-slate-500">Sin actividad registrada.</p>
            )}
          </CardBody>
        </Card>

        {hasQuickLinks ? (
          <Card className="h-fit self-start">
            <CardBody>
              <h2 className="font-semibold text-slate-900">Accesos rápidos</h2>
              <div className="mt-3 space-y-2">
                {canReadUsers ? (
                  <Link to="/app/admin/workers" className="btn-secondary w-full justify-start gap-3 rounded-full px-4">
                    <Users className="h-4 w-4 shrink-0" /> Trabajadores
                  </Link>
                ) : null}
                {canReadDrive ? (
                  <Link to="/app/admin/connections" className="btn-secondary w-full justify-start gap-3 rounded-full px-4">
                    <Database className="h-4 w-4 shrink-0" /> Conexiones de Drive
                  </Link>
                ) : null}
                {canReadJobs ? (
                  <Link to="/app/admin/jobs" className="btn-secondary w-full justify-start gap-3 rounded-full px-4">
                    <FileClock className="h-4 w-4 shrink-0" /> Historial de trabajos
                  </Link>
                ) : null}
                {can(PERMISSIONS.POLICY_WRITE) ? (
                  <Link to="/app/admin/policy" className="btn-secondary w-full justify-start gap-3 rounded-full px-4">
                    <ShieldAlert className="h-4 w-4 shrink-0" /> Política institucional
                  </Link>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </div>
  )
}
