import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ExpandableErrorMessage } from './ExpandableErrorMessage'

const props = {
    expandLabel: 'Show full error',
    collapseLabel: 'Collapse error',
}

describe('ExpandableErrorMessage', () => {
    it.each([
        ['emoji', '😀'],
        ['combining-mark sequence', 'e\u0301'],
        ['ZWJ sequence', '👩‍💻'],
    ])('counts %s as one grapheme', (_, grapheme) => {
        const withinLimit = grapheme.repeat(160)
        const overLimit = `${withinLimit}TAIL`

        const { rerender } = render(<ExpandableErrorMessage {...props} message={withinLimit} />)
        expect(screen.queryByRole('button')).not.toBeInTheDocument()

        rerender(<ExpandableErrorMessage {...props} message={overLimit} />)
        const toggle = screen.getByRole('button', { name: /Show full error/ })
        expect(toggle).toHaveTextContent('…')
        expect(toggle).not.toHaveTextContent('TAIL')

        fireEvent.click(toggle)
        expect(toggle).toHaveTextContent(overLimit)
    })
})
