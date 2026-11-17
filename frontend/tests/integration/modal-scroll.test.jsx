import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Modal, Textarea } from '../../src/components/ui'

describe('Contenedores desplazables propios', () => {
  it('oculta la scrollbar del cuerpo del modal sin retirar overflow-y-auto', () => {
    render(
      <Modal open title="Detalle" onClose={vi.fn()}>
        <p>Contenido extenso</p>
      </Modal>,
    )

    const body = screen.getByTestId('modal-body')
    expect(body).toHaveClass('scrollbar-hidden')
    expect(body).toHaveClass('overflow-y-auto')
    expect(body).toHaveClass('min-h-0')
  })

  it('oculta la scrollbar del textarea conservando su edición', () => {
    render(<Textarea aria-label="Contenido aprobado" />)
    const textarea = screen.getByRole('textbox', { name: 'Contenido aprobado' })
    expect(textarea).toHaveClass('scrollbar-hidden')
    expect(textarea).toHaveClass('input')
  })
})
