import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import { api, queryString } from '../../services/api'
import {
  Alert,
  Button,
  EmptyState,
  Input,
  LoadingBlock,
  Pagination,
  Select,
} from '../../components/ui'
import { StatusBadge } from '../../features/downloads/StatusBadge'
import { formatDate } from '../../utils/format'

export default function WorkersPanel() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const areaId = params.get('area_id') || ''
  const positionId = params.get('position_id') || ''
  const applied = params.get('q') || ''
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [users, setUsers] = useState(null)
  const [total, setTotal] = useState(0)
  const [search, setSearch] = useState(applied)
  const [areas, setAreas] = useState([])
  const [positions, setPositions] = useState([])
  const [positionsArea, setPositionsArea] = useState('')
  const [error, setError] = useState('')
  const pageSize = 20

  useEffect(() => {
    setSearch(applied)
  }, [applied])

  const updateParams = useCallback((changes, { resetPage = true } = {}) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value === '' || value === undefined || value === null) next.delete(key)
      else next.set(key, String(value))
    }
    if (resetPage) next.delete('page')
    setParams(next)
  }, [params, setParams])

  useEffect(() => {
    let active = true
    api
      .get('/admin/areas')
      .then((data) => active && setAreas(data.data || []))
      .catch((err) => active && setError(err.message))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!areaId) {
      setPositions([])
      setPositionsArea('')
      return undefined
    }
    let active = true
    api
      .get(`/admin/areas/${areaId}/positions`)
      .then((data) => {
        if (!active) return
        setPositions(data.data || [])
        setPositionsArea(areaId)
      })
      .catch((err) => {
        if (!active) return
        setPositions([])
        setPositionsArea(areaId)
        setError(err.message)
      })
    return () => { active = false }
  }, [areaId])

  useEffect(() => {
    if (positionId && !areaId) {
      updateParams({ position_id: '' }, { resetPage: false })
    }
  }, [positionId, areaId, updateParams])

  useEffect(() => {
    if (!positionId || !areaId || positionsArea !== areaId) return
    if (!positions.some((position) => position.id === positionId)) {
      updateParams({ position_id: '' }, { resetPage: false })
    }
  }, [positionId, areaId, positionsArea, positions, updateParams])

  useEffect(() => {
    let active = true
    setUsers(null)
    api
      .get(`/admin/users${queryString({
        page, page_size: pageSize, q: applied, status, area_id: areaId, position_id: positionId,
      })}`)
      .then((data) => {
        if (!active) return
        setUsers(data.data || [])
        setTotal(data.pagination?.total || 0)
        setError('')
      })
      .catch((err) => active && setError(err.message))
    return () => {
      active = false
    }
  }, [page, applied, status, areaId, positionId])

  return (
    <div>
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="mb-4 flex flex-col gap-2 @lg:flex-row">
        <form
          className="flex min-w-0 flex-1 gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            updateParams({ q: search.trim() })
          }}
        >
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nombre, correo, área o cargo"
            aria-label="Buscar trabajadores"
          />
          <Button type="submit" variant="secondary">
            <Search className="h-4 w-4" /> Buscar
          </Button>
        </form>
        <Select value={status} onValueChange={(value) => updateParams({ status: value })} aria-label="Filtrar por estado" className="@lg:w-56">
          <option value="">Todos los estados</option>
          <option value="active">Activos</option>
          <option value="pending_profile">Perfil pendiente</option>
          <option value="suspended">Suspendidos</option>
          <option value="disabled">Desactivados</option>
        </Select>
      </div>

      <div className="mb-4 grid gap-2 @lg:grid-cols-2">
        <Select value={areaId} onValueChange={(value) => updateParams({ area_id: value, position_id: '' })} aria-label="Filtrar por área">
          <option value="">Todas las áreas</option>
          {areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
        </Select>
        <Select
          value={positionId}
          onValueChange={(value) => updateParams({ position_id: value })}
          aria-label="Filtrar por cargo"
          disabled={!areaId}
        >
          <option value="">Todos los cargos</option>
          {positions.map((position) => <option key={position.id} value={position.id}>{position.name}</option>)}
        </Select>
      </div>

      {!users && !error ? <LoadingBlock /> : null}
      {users && users.length === 0 ? (
        <EmptyState icon={Users} title="No hay trabajadores con este filtro" description="Ajuste la búsqueda o espere a que los trabajadores inicien sesión." />
      ) : null}
      {users && users.length > 0 ? (
        <>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Trabajador</th>
                  <th className="hidden sm:table-cell">Área / Cargo</th>
                  <th>Estado</th>
                  <th className="hidden md:table-cell">Último acceso</th>
                  <th className="sr-only">Abrir</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="hover:bg-muted">
                    <td>
                      <Link to={`/app/admin/workers/${user.id}`} className="font-medium text-brand-800 hover:underline">
                        {user.display_name || `${user.first_name} ${user.last_name}`}
                      </Link>
                      <p className="text-xs text-slate-500">{user.email || 'Sin correo'}</p>
                    </td>
                    <td className="hidden text-sm text-slate-600 sm:table-cell">
                      {user.area_name || <span className="text-amber-700">Sin área</span>}
                      <br />
                      <span className={user.position_name ? 'text-xs text-slate-500' : 'text-xs text-amber-700'}>
                        {user.position_name || 'Sin cargo'}
                      </span>
                    </td>
                    <td><StatusBadge type="user" status={user.status} /></td>
                    <td className="hidden whitespace-nowrap text-sm text-slate-500 md:table-cell">{formatDate(user.last_login_at)}</td>
                    <td className="text-right">
                      <Link to={`/app/admin/workers/${user.id}`} className="text-sm font-medium text-brand-700 hover:underline">
                        Ver
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPage={(next) => updateParams({ page: next === 1 ? '' : next }, { resetPage: false })}
          />
        </>
      ) : null}
    </div>
  )
}
