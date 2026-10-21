import { describe, expect, it } from 'vitest'
import { beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { sortSessionGroupsByProjectOrder, useSessionProjectOrder } from './useSessionProjectOrder'

beforeEach(() => {
    window.localStorage.clear()
})

describe('sortSessionGroupsByProjectOrder', () => {
    it('keeps known projects stable and appends new projects', () => {
        const groups = [
            { key: 'new', value: 'new' },
            { key: 'mine', value: 'mine' },
            { key: 'hapi', value: 'hapi' },
        ]

        expect(sortSessionGroupsByProjectOrder(groups, ['mine', 'hapi'])).toEqual([
            { key: 'mine', value: 'mine' },
            { key: 'hapi', value: 'hapi' },
            { key: 'new', value: 'new' },
        ])
    })

    it('persists first-seen project order and appends newly discovered projects', () => {
        const hook = renderHook(({ keys }: { keys: string[] }) => useSessionProjectOrder(keys), {
            initialProps: { keys: ['mine', 'hapi'] },
        })

        expect(hook.result.current).toEqual(['mine', 'hapi'])
        expect(JSON.parse(window.localStorage.getItem('hapi-session-project-order')!)).toEqual(['mine', 'hapi'])

        hook.rerender({ keys: ['hapi', 'mine', 'new'] })
        expect(hook.result.current).toEqual(['mine', 'hapi', 'new'])
        expect(JSON.parse(window.localStorage.getItem('hapi-session-project-order')!)).toEqual(['mine', 'hapi', 'new'])
    })
})
