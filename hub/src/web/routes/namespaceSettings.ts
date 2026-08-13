import { Hono } from 'hono'
import {
    UpdateNamespaceSettingsRequestSchema,
    type NamespaceSettingsResponse
} from '@hapi/protocol'
import {
    readNamespaceLocale,
    writeNamespaceLocale
} from '../../config/namespaceSettings'
import type { WebAppEnv } from '../middleware/auth'

export function createNamespaceSettingsRoutes(dataDir: string): Hono<WebAppEnv> {
    const app = new Hono<WebAppEnv>()

    app.get('/namespace-settings', async (c) => {
        const response: NamespaceSettingsResponse = {
            locale: await readNamespaceLocale(dataDir, c.get('namespace'))
        }
        c.header('Cache-Control', 'no-store')
        return c.json(response)
    })

    app.put('/namespace-settings', async (c) => {
        const json = await c.req.json().catch(() => null)
        const parsed = UpdateNamespaceSettingsRequestSchema.safeParse(json)
        if (!parsed.success) {
            return c.json({ error: 'Invalid body' }, 400)
        }

        const locale = await writeNamespaceLocale(
            dataDir,
            c.get('namespace'),
            parsed.data.locale
        )
        c.header('Cache-Control', 'no-store')
        return c.json({ locale } satisfies NamespaceSettingsResponse)
    })

    return app
}
