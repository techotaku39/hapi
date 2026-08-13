import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { WebAppEnv } from '../middleware/auth'
import { createNamespaceSettingsRoutes } from './namespaceSettings'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('GET/PUT /api/namespace-settings', () => {
    async function createApp(namespace = 'default') {
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-namespace-settings-'))
        directories.push(dataDir)
        const app = new Hono<WebAppEnv>()
        app.use('*', async (c, next) => {
            c.set('namespace', namespace)
            await next()
        })
        app.route('/api', createNamespaceSettingsRoutes(dataDir))
        return { app, dataDir }
    }

    it('returns English by default and does not cache the response', async () => {
        const { app } = await createApp()
        const response = await app.request('/api/namespace-settings')
        expect(response.status).toBe(200)
        expect(response.headers.get('cache-control')).toBe('no-store')
        expect(await response.json()).toEqual({ locale: 'en' })
    })

    it('persists a locale only for the authenticated namespace', async () => {
        const { app, dataDir } = await createApp('alpha')
        const put = await app.request('/api/namespace-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ locale: 'zh-CN' })
        })
        expect(put.status).toBe(200)
        expect(await put.json()).toEqual({ locale: 'zh-CN' })

        const other = new Hono<WebAppEnv>()
        other.use('*', async (c, next) => {
            c.set('namespace', 'beta')
            await next()
        })
        other.route('/api', createNamespaceSettingsRoutes(dataDir))

        expect(await (await app.request('/api/namespace-settings')).json()).toEqual({ locale: 'zh-CN' })
        expect(await (await other.request('/api/namespace-settings')).json()).toEqual({ locale: 'en' })
    })

    it('rejects unsupported locales', async () => {
        const { app } = await createApp()
        const response = await app.request('/api/namespace-settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ locale: 'fr' })
        })
        expect(response.status).toBe(400)
    })
})
