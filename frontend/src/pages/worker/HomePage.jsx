import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Cloud, HardDrive, ListChecks, ShieldCheck } from 'lucide-react'
import { useAuth } from '../../app/AuthContext'
import { api } from '../../services/api'
import { Alert, Card, CardBody, LoadingBlock, PageHeader, StatCard } from '../../components/ui'
import { StatusBadge } from '../../features/downloads/StatusBadge'
import { useRealtimeChannel } from '../../features/realtime/RealtimeContext'
import { formatBytes, formatDate } from '../../utils/format'

function connectionState(connection) {
  if (!connection) return { value: 'Sin conectar', hint: 'Autorice su cuenta para permitir respaldos', status: undefined }
  const hints = {
    connected: 'Cuenta autorizada para respaldos',
    reauthorization_required: 'La autorización ya no es válida',
    revoked: 'La autorización fue revocada',
    error: 'No fue posible validar la conexión',
  }
  if (connection.status === 'connected' && !connection.has_refresh_token) {
    return { value: 'Requiere reconexión', hint: 'No hay token de actualización disponible', status: connection.status }
  }
  const labels = {
    connected: 'Vinculada',
    reauthorization_required: 'Requiere reconexión',
    revoked: 'Revocada',
    error: 'Error de conexión',
  }
  return {
    value: labels[connection.status] || 'Requiere reconexión',
    hint: connection.google_email || hints[connection.status] || 'Estado de conexión desconocido',
    status: connection.status,
  }
}

function policyState(connection, policy) {
  if (!policy) return { value: 'Sin publicar', hint: 'No existe una versión institucional vigente' }
  if (!connection || connection.policy_consent_version !== policy.version) {
    return { value: 'Pendiente', hint: `Versión vigente ${policy.version}` }
  }
  return { value: 'Aceptada', hint: `Versión vigente ${policy.version}` }
}

export default function WorkerHome() {
  const { user } = useAuth()
  const [drive, setDrive] = useState(null)
  const [jobs, setJobs] = useState(null)
  const [summary, setSummary] = useState(undefined)
  const [error, setError] = useState('')
  const lastRealtimeRef = useRef(0)
  const realtimeSeenRef = useRef(false)

  useRealtimeChannel('worker.dashboard', (message) => {
    if (message.type !== 'worker.dashboard.snapshot' && message.type !== 'worker.dashboard.metrics') return
    const generated = Date.parse(message.data?.generated_at || message.at || '')
    if (Number.isFinite(generated) && generated < lastRealtimeRef.current) return
    if (Number.isFinite(generated)) lastRealtimeRef.current = generated
    realtimeSeenRef.current = true
    setSummary(message.data?.summary ?? null)
    const recent = message.data?.recent || []
    setJobs([...new Map(recent.map((job) => [job.id, job])).values()].slice(0, 5))
  })

  useEffect(() => {
    let active = true
    api
      .get('/me/drive/connection')
      .then((data) => active && setDrive(data))
      .catch((err) => active && setError(err.message))
    api
      .get('/download-jobs?page_size=5')
      .then((data) => active && !realtimeSeenRef.current && setJobs(data.data || []))
      .catch((err) => active && setError(err.message))
    api
      .get('/download-jobs/summary')
      .then((data) => active && !realtimeSeenRef.current && setSummary(data))
      .catch(() => active && !realtimeSeenRef.current && setSummary(null))
    return () => {
      active = false
    }
  }, [])

  if (!drive && !jobs && summary === undefined) return <LoadingBlock />

  const connection = drive?.connection
  const policy = drive?.policy
  const connectionInfo = connectionState(connection)
  const policyInfo = policyState(connection, policy)
  const activeJobs = summary && typeof summary.active_jobs === 'number' ? summary.active_jobs : undefined

  return (
    <div>
      <PageHeader
        title={`Hola, ${user?.first_name || user?.display_name || 'bienvenido'}`}
        description="Consulte el estado de su conexión, sus descargas y la política institucional."
      />
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="grid gap-4 @sm:grid-cols-2 @3xl:grid-cols-3">
        <StatCard
          label="Conexión de Google Drive"
          value={connectionInfo.value}
          hint={connectionInfo.hint}
          icon={HardDrive}
          tone={connectionInfo.status === 'connected' ? 'text-brand-700' : 'text-amber-600'}
          to="/app/drive"
        />
        <StatCard
          label="Trabajos activos"
          value={summary === undefined ? '…' : summary === null ? 'No disponible' : activeJobs}
          hint={summary === null
            ? 'No fue posible consultar el resumen de trabajos.'
            : 'Descargas en curso o en cola de todo su historial'}
          icon={ListChecks}
          tone={summary === null ? 'text-amber-600' : 'text-brand-700'}
          to="/app/jobs?status=active"
        />
        <StatCard
          label="Política institucional"
          value={policyInfo.value}
          hint={policyInfo.hint}
          icon={ShieldCheck}
          tone={policyInfo.value === 'Aceptada' ? 'text-brand-700' : 'text-amber-600'}
          to="/app/drive"
        />
      </div>

      <div className="mt-6 grid gap-6 @3xl:grid-cols-3">
        <Card className="@3xl:col-span-2">
          <CardBody>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-slate-900">Descargas recientes</h2>
              <Link to="/app/jobs" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">
                Ver todas <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            {!jobs ? (
              <LoadingBlock label="Cargando descargas recientes…" />
            ) : jobs.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">Todavía no hay descargas asociadas a su cuenta.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <li key={job.id} className="flex flex-col gap-2 py-3 @md:flex-row @md:items-center @md:justify-between">
                    <div className="min-w-0">
                      <Link to={`/app/jobs/${job.id}`} className="truncate text-sm font-medium text-brand-800 hover:underline">
                        Trabajo {job.id.slice(0, 8).toUpperCase()}
                      </Link>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {formatDate(job.created_at)} · {job.total_items} elementos · {formatBytes(job.downloaded_bytes)}
                      </p>
                    </div>
                    <StatusBadge type="job" status={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <h2 className="font-semibold text-slate-900">Su cuenta</h2>
            <dl className="mt-3 space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Área</dt>
                <dd className="font-medium text-slate-800">{user?.area_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Cargo</dt>
                <dd className="font-medium text-slate-800">{user?.position_name || '—'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Correo</dt>
                <dd className="break-all font-medium text-slate-800">{user?.email || '—'}</dd>
              </div>
            </dl>
            <div className="mt-5 space-y-2">
              <Link to="/app/drive" className="btn-secondary w-full">
                <Cloud className="h-4 w-4" /> Gestionar Google Drive
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
