import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SelectMenu } from './select-menu'

const options = [
    { value: 'kimi', label: 'Kimi Coding Plan' },
    { value: 'generic', label: 'Generic rate-limit windows' },
    { value: 'custom', label: 'Custom JSON paths' }
]

describe('SelectMenu', () => {
    it('renders a themed button and listbox instead of a native select', () => {
        render(<SelectMenu aria-label="Template" value="generic" options={options} onChange={vi.fn()} />)

        const trigger = screen.getByRole('combobox', { name: 'Template' })
        expect(trigger).toHaveTextContent('Generic rate-limit windows')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
        expect(screen.queryByRole('combobox', { hidden: true })).toBe(trigger)
        expect(document.querySelector('select')).not.toBeInTheDocument()

        fireEvent.click(trigger)
        expect(screen.getByRole('listbox', { name: 'Template' })).toBeInTheDocument()
        expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
            'Kimi Coding Plan',
            'Generic rate-limit windows',
            'Custom JSON paths'
        ])
    })

    it('selects with pointer and keyboard interaction', () => {
        const onChange = vi.fn()
        render(<SelectMenu aria-label="Template" value="kimi" options={options} onChange={onChange} />)

        const trigger = screen.getByRole('combobox', { name: 'Template' })
        fireEvent.click(trigger)
        fireEvent.click(screen.getByRole('option', { name: 'Custom JSON paths' }))
        expect(onChange).toHaveBeenCalledWith('custom')
        expect(screen.queryByRole('listbox')).not.toBeInTheDocument()

        fireEvent.click(trigger)
        const selected = screen.getByRole('option', { name: 'Kimi Coding Plan' })
        fireEvent.keyDown(selected, { key: 'ArrowDown' })
        fireEvent.keyDown(screen.getByRole('option', { name: 'Generic rate-limit windows' }), { key: 'Enter' })
        expect(onChange).toHaveBeenLastCalledWith('generic')
    })
})
