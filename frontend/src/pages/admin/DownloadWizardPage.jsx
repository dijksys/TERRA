import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertTriangle, ArrowRight, CheckCircle2, CloudDownload, HardDrive, Play, Search, ShieldAlert } from 'lucide-react'
import { api, queryString } from '../../services/api'
import {
  Alert,
  Button,
  Card,
  CardBody,
  Field,
  Input,
  PageHeader,
  Spinner,
} from '../../components/ui'
import { StatusBadge } from '../../features/downloads/StatusBadge'
import FolderPicker from '../../features/drive/FolderPicker'
import { formatDate, USER_STATUS } from '../../utils/format'

export default function DownloadWizardPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [workerResults, setWorkerResults] = useState([])
  const [workerTotal, setWorkerTotal] = useState(0)
  const [workerSearch, setWorkerSearch] = useState('')
  const [workerPage, setWorkerPage] = useState(1)
  const [workerLoading, setWorkerLoading] = useState(true)
  const [workerError, setWorkerError] = useState('')
  const [selectedWorker, setSelectedWorker] = useState(null)
  const [workerId, setWorkerId] = useState(params.get('worker') || '')
  const [connection, setConnection] = useState(undefined)
  const [policy, setPolicy] = useState(null)
  const [scope, setScope] = useState('my_drive_full')
  const [selection, setSelection] = useState({ folders: [], files: [] })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    let active = true
    let controller
    setWorkerLoading(true)
    setWorkerError('')
    const timer = setTimeout(() => {
      controller = new AbortController()
      api
        .get(`/admin/users${queryString({
          status: 'active', q: workerSearch.trim(), page: workerPage, page_size: 20,
        })}`, { signal: controller.signal })
        .then((data) => {
          if (!active) return
          setWorkerResults(data.data || [])
          setWorkerTotal(data.pagination?.total || 0)
          setWorkerLoading(false)
        })
        .catch((err) => {
          if (!active || err.name === 'AbortError') return
          setWorkerError(err.message)
          setWorkerLoading(false)
        })
    }, 300)
    return () => {
      active = false
      clearTimeout(timer)
      controller?.abort()
    }
  }, [workerSearch, workerPage])

  useEffect(() => {
    if (!workerId) {
      setSelectedWorker(null)
      return undefined
    }
    let active = true
    api
      .get(`/admin/users/${workerId}`)
      .then((data) => active && setSelectedWorker(data.user || null))
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [workerId])

  useEffect(() => {
    if (!workerId) {
      setConnection(undefined)
      setPolicy(null)
      return undefined
    }
    let active = true
    setConnection(undefined)
    api
      .get(`/admin/users/${workerId}/drive/connection`)
      .then((data) => {
        if (!active) return
        setConnection(data.connection || null)
        setPolicy(data.policy || null)
      })
      .catch((err) => {
        if (!active) return
        if (err.status === 404 || err.code === 'not_found') {
          setConnection(null)
          setPolicy(null)
        } else {
          setError(err.message)
        }
      })
    return () => {
      active = false
    }
  }, [workerId])

  const worker = selectedWorker
  const policyCurrent = Boolean(policy && connection?.policy_consent_version === policy.version)
  const ready = Boolean(connection && connection.status === 'connected' && connection.has_refresh_token && policyCurrent)
  const blockingReasons = []
  if (!workerId) blockingReasons.push('Seleccione un trabajador.')
  if (workerId && connection === null) blockingReasons.push('El trabajador no tiene una conexión de Google Drive.')
  if (connection && connection.status !== 'connected') blockingReasons.push('La conexión requiere que el trabajador la reconozca o reautorice.')
  if (connection && policy && !policyCurrent) blockingReasons.push('El trabajador debe aceptar la versión vigente de la política institucional.')
  if (connection && !policy) blockingReasons.push('No existe una política institucional publicada.')

  const create = async () => {
    setError('')
    setErrors({})
    if (!ready) return
    if (scope === 'selected_items' && selection.folders.length === 0 && selection.files.length === 0) {
      setError('Seleccione al menos una carpeta o archivo para respaldar.')
      return
    }
    setCreating(true)
    try {
      const body = scope === 'my_drive_full'
        ? { scope_type: 'my_drive_full', root_folder_ids: [], root_file_ids: [] }
        : {
            scope_type: 'selected_items',
            root_folder_ids: selection.folders.map((folder) => folder.id),
            root_file_ids: selection.files.map((file) => file.id),
          }
      const job = await api.post(`/admin/users/${workerId}/download-jobs`, body, {
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      })
      navigate(`/app/admin/jobs/${job.id}`)
    } catch (err) {
      setError(err.message)
      if (err.fields) setErrors(err.fields)
    } finally {
      setCreating(false)
    }
  }

  const selectionError = errors.root_folder_ids || errors.root_file_ids || errors.scope_type

  return (
    <div className="w-full min-w-0 max-w-none space-y-4">
      <PageHeader
        title="Nueva descarga institucional"
        description="Seleccione al propietario del Drive y el alcance. El trabajo se procesa de forma asíncrona y conserva la estructura original."
        descriptionClassName="max-w-4xl"
      />
      {error ? <Alert tone="error" onClose={() => setError('')}>{error}</Alert> : null}

      <Card>
        <CardBody>
          <section data-testid="worker-selector-section" className="min-w-0 space-y-4">
            <header data-testid="worker-selector-header">
              <h2 className="font-semibold text-slate-900">Trabajador</h2>
              <p className="mt-1 text-sm text-slate-500">Solo se muestran trabajadores activos con área y cargo asignados.</p>
            </header>

            <div data-testid="worker-search-area" className="w-full max-w-2xl">
              <Field label="Buscar trabajador" htmlFor="worker-search">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <Input
                    id="worker-search"
                    className="pl-9"
                    value={workerSearch}
                    onChange={(event) => { setWorkerSearch(event.target.value); setWorkerPage(1) }}
                    placeholder="Nombre, correo, área o cargo"
                    aria-label="Buscar trabajadores"
                  />
                </div>
              </Field>
            </div>

            {selectedWorker ? (
              <div data-testid="selected-worker" className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-brand-900">
                    {selectedWorker.display_name || `${selectedWorker.first_name || ''} ${selectedWorker.last_name || ''}`.trim() || selectedWorker.email}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-brand-800">
                    {selectedWorker.email} · {selectedWorker.area_name || 'Sin área'} / {selectedWorker.position_name || 'Sin cargo'}
                  </p>
                </div>
                <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" />
              </div>
            ) : workerId ? (
              <p className="text-xs text-slate-500">Cargando trabajador seleccionado…</p>
            ) : (
              <p className="text-xs text-rose-600">Seleccione un trabajador.</p>
            )}

            <div data-testid="worker-results" className="min-w-0 rounded-xl border border-border bg-surface-secondary p-2">
              {workerLoading ? (
                <div className="flex min-h-20 items-center justify-center gap-2 px-3 py-6 text-sm text-slate-500"><Spinner /> Buscando trabajadores…</div>
              ) : workerError ? (
                <p className="min-h-20 break-words px-3 py-6 text-sm text-red-700">{workerError}</p>
              ) : workerResults.length === 0 ? (
                <p className="min-h-20 px-3 py-6 text-center text-sm text-slate-500">No hay trabajadores que coincidan con la búsqueda.</p>
              ) : (
                <ul className="grid grid-cols-1 gap-2 @lg:grid-cols-2 @5xl:grid-cols-3" aria-label="Resultados de trabajadores">
                  {workerResults.map((user) => {
                    const name = user.display_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.email
                    const selected = user.id === workerId
                    return (
                      <li key={user.id} className="min-w-0">
                        <button
                          type="button"
                          className={`flex h-full w-full min-w-0 flex-col rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
                            selected
                              ? 'border-brand-600 bg-brand-50 ring-1 ring-brand-100'
                              : 'border-border bg-surface hover:border-slate-300 hover:bg-muted'
                          }`}
                          onClick={() => {
                            setWorkerId(user.id)
                            setSelectedWorker(user)
                            setSelection({ folders: [], files: [] })
                            setErrors({})
                            setError('')
                          }}
                          aria-pressed={selected}
                        >
                          <span className="flex min-w-0 items-start justify-between gap-2">
                            <span className="min-w-0">
                              <span className="block text-sm font-medium text-slate-800">{name}</span>
                              <span className="mt-0.5 block break-all text-xs text-slate-500">{user.email}</span>
                            </span>
                            {selected ? <CheckCircle2 className="h-4 w-4 shrink-0 text-brand-700" aria-hidden="true" /> : null}
                          </span>
                          <span className="mt-auto block pt-2 text-xs text-slate-500">
                            {user.area_name || 'Sin área'} / {user.position_name || 'Sin cargo'}
                            {user.status ? ` · ${USER_STATUS[user.status]?.label || user.status}` : ''}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div data-testid="worker-pagination" className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>{workerTotal} coincidencia(s) · página {workerPage} de {Math.max(1, Math.ceil(workerTotal / 20))}</span>
              <span className="flex flex-wrap gap-2">
                <Button variant="secondary" className="min-h-0 px-2 py-1 text-xs" disabled={workerPage <= 1 || workerLoading} onClick={() => setWorkerPage((value) => Math.max(1, value - 1))}>
                  Anterior
                </Button>
                <Button variant="secondary" className="min-h-0 px-2 py-1 text-xs" disabled={workerPage >= Math.max(1, Math.ceil(workerTotal / 20)) || workerLoading} onClick={() => setWorkerPage((value) => value + 1)}>
                  Siguiente
                </Button>
              </span>
            </div>
          </section>
        </CardBody>
      </Card>

      {workerId ? (
        <Card>
          <CardBody>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold text-slate-900">Estado de la conexión</h2>
                <p className="mt-1 text-sm text-slate-500">
                  {worker?.display_name || worker?.email || 'Trabajador'} · {worker?.area_name} {worker?.position_name ? `/ ${worker.position_name}` : ''}
                </p>
              </div>
              {connection === undefined ? (
                <Spinner />
              ) : (
                <StatusBadge type="connection" status={connection?.status || 'revoked'} />
              )}
            </div>

            {connection === null ? (
              <div className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
                El trabajador no ha conectado su cuenta de Google Drive. No es posible iniciar una descarga.
                <Button variant="secondary" className="mt-3" onClick={() => navigate(`/app/admin/workers/${workerId}`)}>
                  Revisar trabajador
                </Button>
              </div>
            ) : connection ? (
              <dl className="mt-4 grid gap-3 text-sm @xl:grid-cols-2 @6xl:grid-cols-4">
                <div>
                  <dt className="text-slate-500">Cuenta autorizada</dt>
                  <dd className="font-medium text-slate-800">{connection.google_email || '—'}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Conectada</dt>
                  <dd className="font-medium text-slate-800">{formatDate(connection.connected_at)}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Política aceptada</dt>
                  <dd className="font-medium text-slate-800">
                    {connection.policy_consent_version || 'Pendiente'} {policy ? `(vigente: ${policy.version})` : ''}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500">Token de actualización</dt>
                  <dd className="font-medium text-slate-800">{connection.has_refresh_token ? 'Disponible' : 'No disponible'}</dd>
                </div>
              </dl>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <h2 className="font-semibold text-slate-900">Alcance del snapshot</h2>
          <div className="mt-3 grid gap-3 @lg:grid-cols-2">
            <label className={`cursor-pointer rounded-xl border p-4 ${scope === 'my_drive_full' ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <input
                type="radio"
                name="scope"
                className="h-4 w-4 text-brand-700 accent-brand-700"
                value="my_drive_full"
                checked={scope === 'my_drive_full'}
                onChange={() => { setScope('my_drive_full'); setErrors({}) }}
              />
              <span className="ml-2 text-sm font-medium text-slate-900">Mi unidad completa</span>
              <p className="mt-2 text-xs text-slate-500">
                Recorre toda la raíz de Mi unidad, conserva carpetas vacías y excluye la papelera.
              </p>
            </label>
            <label className={`cursor-pointer rounded-xl border p-4 ${scope === 'selected_items' ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:border-slate-300'}`}>
              <input
                type="radio"
                name="scope"
                className="h-4 w-4 text-brand-700 accent-brand-700"
                value="selected_items"
                checked={scope === 'selected_items'}
                onChange={() => { setScope('selected_items'); setErrors({}) }}
              />
              <span className="ml-2 text-sm font-medium text-slate-900">Archivos y carpetas seleccionados</span>
              <p className="mt-2 text-xs text-slate-500">
                Seleccione carpetas completas o archivos individuales. Puede combinar ambos tipos y conservar la estructura original de Google Drive.
              </p>
            </label>
          </div>
          {scope === 'selected_items' ? (
            <div className="mt-4">
              <h3 className="mb-2 text-sm font-semibold text-slate-800">Selección de archivos y carpetas</h3>
              <FolderPicker
                userId={workerId}
                selected={selection}
                onChange={(next) => { setSelection(next); setErrors({}) }}
                disabled={!ready || creating}
              />
              {selectionError ? <p className="field-error">{selectionError}</p> : null}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <h2 className="font-semibold text-slate-900">Confirmación</h2>
          {blockingReasons.length > 0 ? (
            <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              <p className="flex items-center gap-2 font-medium">
                <ShieldAlert className="h-4 w-4" /> No es posible iniciar el trabajo todavía
              </p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {blockingReasons.map((reason) => <li key={reason}>{reason}</li>)}
              </ul>
            </div>
          ) : (
            <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              <CheckCircle2 className="mt-0.5 h-4 w-4" /> Conexión y política vigentes. Puede iniciar el snapshot.
            </div>
          )}

          <div className="mt-4 grid gap-3 text-sm @xl:grid-cols-2 @5xl:grid-cols-3 @6xl:grid-cols-5">
            <div className="rounded-xl bg-muted p-3">
              <p className="text-xs text-slate-500">Trabajador</p>
              <p className="font-medium text-slate-800">{worker?.display_name || '—'}</p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="text-xs text-slate-500">Alcance</p>
              <p className="font-medium text-slate-800">
                {scope === 'my_drive_full'
                  ? 'Mi unidad completa'
                  : `${selection.folders.length} carpeta(s) y ${selection.files.length} archivo(s)`}
              </p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="text-xs text-slate-500">Clasificación</p>
              <p className="font-medium text-slate-800">{worker?.area_name || '—'} / {worker?.position_name || '—'}</p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="text-xs text-slate-500">Elementos raíz</p>
              <p className="font-medium text-slate-800">
                {scope === 'my_drive_full'
                  ? 'Mi unidad completa'
                  : `${selection.folders.length + selection.files.length} seleccionado(s)`}
              </p>
            </div>
            <div className="rounded-xl bg-muted p-3">
              <p className="text-xs text-slate-500">Destino</p>
              <p className="break-all font-medium text-slate-800">Snapshot independiente por trabajo</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button onClick={create} disabled={!ready || creating || (scope === 'selected_items' && selection.folders.length === 0 && selection.files.length === 0)}>
              {creating ? <Spinner className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {creating ? 'Registrando trabajo…' : 'Iniciar descarga'}
            </Button>
            <p className="flex items-center gap-1 text-xs text-slate-500">
              <HardDrive className="h-3.5 w-3.5" /> El navegador puede cerrarse: el worker continúa en el servidor.
            </p>
          </div>
        </CardBody>
      </Card>

      {!policy ? (
        <div className="flex items-start gap-2 text-sm text-slate-500">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>
            No hay política publicada. Publique una versión aprobada en{' '}
            <button type="button" className="font-medium text-brand-700 underline" onClick={() => navigate('/app/admin/policy')}>
              Política institucional
            </button>.
          </span>
        </div>
      ) : null}

      <div className="flex items-center gap-2 text-xs text-slate-500">
        <CloudDownload className="h-4 w-4" /> Los archivos se descargan de forma asíncrona con límites de velocidad y
        capacidad configurados por la institución.
        <ArrowRight className="h-4 w-4" />
      </div>
    </div>
  )
}
