import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMinuteTick } from './useMinuteTick'

describe('useMinuteTick', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    it('refreshes enabled relative labels once a minute', () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useMinuteTick(true))

        expect(result.current).toBe(0)
        act(() => vi.advanceTimersByTime(60_000))
        expect(result.current).toBe(1)
    })

    it('does not schedule refreshes when disabled', () => {
        vi.useFakeTimers()
        const { result } = renderHook(() => useMinuteTick(false))

        act(() => vi.advanceTimersByTime(120_000))
        expect(result.current).toBe(0)
    })
})
