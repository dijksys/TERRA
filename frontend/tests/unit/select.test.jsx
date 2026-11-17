import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { Select } from '../../src/components/select'

const options = [
  { value: '', label: 'Todos' },
  { value: 'active', label: 'Activos' },
  { value: 'disabled', label: 'Desactivados', disabled: true },
]

function ControlledSelect({ onChange }) {
  const [value, setValue] = useState('')
  return (
    <Select
      aria-label="Filtro"
      value={value}
      options={options}
      onValueChange={(next) => {
        setValue(next)
        onChange(next)
      }}
    />
  )
}

describe('Select global', () => {
  it('abre el panel, selecciona un valor y actualiza el control', async () => {
    const onChange = vi.fn()
    render(<ControlledSelect onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Filtro' })
    expect(trigger).toHaveTextContent('Todos')

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    const option = await screen.findByRole('option', { name: 'Activos' })
    fireEvent.click(option)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('active'))
    expect(trigger).toHaveTextContent('Activos')
  })

  it('conserva el valor vacío y el placeholder', async () => {
    const onChange = vi.fn()
    render(<ControlledSelect onChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Filtro' })

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: 'Activos' }))
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('active'))
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    fireEvent.click(await screen.findByRole('option', { name: 'Todos' }))
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(''))
    expect(trigger).toHaveTextContent('Todos')

    render(<Select aria-label="Vacío" placeholder="Seleccione un valor" options={options.slice(1)} />)
    expect(screen.getByRole('combobox', { name: 'Vacío' })).toHaveTextContent('Seleccione un valor')
  })

  it('admite deshabilitados, errores y opciones actualizadas', async () => {
    const { rerender } = render(
      <Select aria-label="Estado" value="active" error="Campo inválido" options={options} disabled />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Estado' })
    expect(trigger).toBeDisabled()
    expect(trigger).toHaveAttribute('aria-invalid', 'true')

    rerender(<Select aria-label="Estado" value="active" options={[...options, { value: 'new', label: 'Nuevo' }]} />)
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    expect(await screen.findByRole('option', { name: 'Nuevo' })).toBeInTheDocument()
  })

  it('mantiene el viewport desplazable con la scrollbar oculta', async () => {
    const manyOptions = Array.from({ length: 30 }, (_, index) => ({
      value: `option-${index}`,
      label: `Opción ${index + 1}`,
    }))
    render(<Select aria-label="Extenso" options={manyOptions} />)
    const trigger = screen.getByRole('combobox', { name: 'Extenso' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)

    await screen.findByRole('option', { name: 'Opción 1' })
    const viewport = document.querySelector('.select-viewport')
    expect(viewport).toHaveClass('scrollbar-hidden')
    expect(screen.getByRole('option', { name: 'Opción 30' })).toBeInTheDocument()
  })

  it('no selecciona opciones deshabilitadas', async () => {
    const onChange = vi.fn()
    render(<Select aria-label="Estados" value="" options={options} onValueChange={onChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Estados' })
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
    fireEvent.click(trigger)
    const disabledOption = await screen.findByRole('option', { name: 'Desactivados' })
    expect(disabledOption).toHaveAttribute('data-disabled')
    fireEvent.click(disabledOption)
    expect(onChange).not.toHaveBeenCalled()
  })
})
