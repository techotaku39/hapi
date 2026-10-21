import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_SESSION_PROJECT_SORT_MODE,
    getInitialSessionProjectSortMode,
    getSessionProjectSortModeOptions,
    useSessionProjectSortMode,
} from './useSessionProjectSortMode'

describe('useSessionProjectSortMode', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('defaults to stable order and lists recent activity second', () => {
        expect(DEFAULT_SESSION_PROJECT_SORT_MODE).toBe('stable')
        expect(getInitialSessionProjectSortMode()).toBe('stable')
        expect(getSessionProjectSortModeOptions()).toEqual([
            { value: 'stable', labelKey: 'settings.display.projectSort.stable' },
            { value: 'recent', labelKey: 'settings.display.projectSort.recent' },
        ])
    })

    it('reads valid persisted mode and falls back for invalid values', () => {
        window.localStorage.setItem('hapi-session-project-sort-mode', 'recent')
        expect(getInitialSessionProjectSortMode()).toBe('recent')

        window.localStorage.setItem('hapi-session-project-sort-mode', 'invalid')
        expect(getInitialSessionProjectSortMode()).toBe('stable')
    })

    it('synchronizes mode changes between hook instances', () => {
        const first = renderHook(() => useSessionProjectSortMode())
        const second = renderHook(() => useSessionProjectSortMode())

        act(() => first.result.current.setSessionProjectSortMode('recent'))
        expect(second.result.current.sessionProjectSortMode).toBe('recent')
        expect(window.localStorage.getItem('hapi-session-project-sort-mode')).toBe('recent')

        act(() => second.result.current.setSessionProjectSortMode('stable'))
        expect(first.result.current.sessionProjectSortMode).toBe('stable')
        expect(window.localStorage.getItem('hapi-session-project-sort-mode')).toBeNull()
    })
})
