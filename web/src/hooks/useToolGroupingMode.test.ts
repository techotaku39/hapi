import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_TOOL_GROUPING_MODE,
    getInitialToolGroupingMode,
    getToolGroupingModeOptions,
} from './useToolGroupingMode'

describe('useToolGroupingMode helpers', () => {
    beforeEach(() => {
        window.localStorage.clear()
    })

    it('returns grouped and classified options', () => {
        expect(getToolGroupingModeOptions()).toEqual([
            { value: 'grouped', labelKey: 'settings.chat.toolGrouping.grouped' },
            { value: 'classified', labelKey: 'settings.chat.toolGrouping.classified' },
        ])
    })

    it('defaults to grouped for missing or invalid values', () => {
        expect(getInitialToolGroupingMode()).toBe(DEFAULT_TOOL_GROUPING_MODE)
        window.localStorage.setItem('hapi-tool-grouping-mode', 'invalid')
        expect(getInitialToolGroupingMode()).toBe(DEFAULT_TOOL_GROUPING_MODE)
    })

    it('reads the classified preference', () => {
        window.localStorage.setItem('hapi-tool-grouping-mode', 'classified')
        expect(getInitialToolGroupingMode()).toBe('classified')
    })
})
