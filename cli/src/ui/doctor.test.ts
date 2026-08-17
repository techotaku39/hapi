import { describe, expect, it } from 'vitest'
import { redactSettingsForDisplay } from './doctor'

describe('redactSettingsForDisplay', () => {
    it('redacts tokens and extra headers from diagnostic output', () => {
        const displaySettings = redactSettingsForDisplay({
            apiUrl: 'https://hapi.example.com',
            cliApiToken: 'cli-secret',
            extraHeaders: {
                'CF-Access-Client-Id': 'client-id',
                'CF-Access-Client-Secret': 'client-secret'
            },
            titleProvider: {
                baseUrl: 'https://provider.example.com/v1',
                apiKey: 'title-provider-secret',
                model: 'small-model'
            }
        })

        expect(displaySettings).toEqual({
            apiUrl: 'https://hapi.example.com',
            cliApiToken: '***',
            extraHeaders: '***',
            titleProvider: {
                baseUrl: 'https://provider.example.com/v1',
                apiKey: '***',
                model: 'small-model'
            }
        })
        expect(JSON.stringify(displaySettings)).not.toContain('cli-secret')
        expect(JSON.stringify(displaySettings)).not.toContain('client-secret')
        expect(JSON.stringify(displaySettings)).not.toContain('title-provider-secret')
    })
})
