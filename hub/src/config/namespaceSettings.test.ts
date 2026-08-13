import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
    getNamespaceSettingsFile,
    readNamespaceLocale,
    writeNamespaceLocale
} from './namespaceSettings'

const directories: string[] = []

afterEach(async () => {
    await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('namespace locale persistence', () => {
    it('defaults to English and persists locale per namespace', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-namespace-locale-'))
        directories.push(dataDir)

        expect(await readNamespaceLocale(dataDir, 'default')).toBe('en')
        await writeNamespaceLocale(dataDir, 'default', 'zh-CN')
        await writeNamespaceLocale(dataDir, 'tenant', 'en')

        expect(await readNamespaceLocale(dataDir, 'default')).toBe('zh-CN')
        expect(await readNamespaceLocale(dataDir, 'tenant')).toBe('en')
        expect(await readNamespaceLocale(dataDir, 'other')).toBe('en')
    })

    it('serializes concurrent writes without losing namespaces', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-namespace-locale-race-'))
        directories.push(dataDir)

        await Promise.all([
            writeNamespaceLocale(dataDir, 'alpha', 'zh-CN'),
            writeNamespaceLocale(dataDir, 'beta', 'en'),
            writeNamespaceLocale(dataDir, 'gamma', 'zh-CN')
        ])

        expect(await readNamespaceLocale(dataDir, 'alpha')).toBe('zh-CN')
        expect(await readNamespaceLocale(dataDir, 'beta')).toBe('en')
        expect(await readNamespaceLocale(dataDir, 'gamma')).toBe('zh-CN')
        const raw = JSON.parse(await readFile(getNamespaceSettingsFile(dataDir), 'utf8')) as {
            locales?: Record<string, string>
        }
        expect(raw.locales).toEqual({ alpha: 'zh-CN', beta: 'en', gamma: 'zh-CN' })
    })

    it('preserves the first concurrent writes from independent module instances', async () => {
        const dataDir = await mkdtemp(join(tmpdir(), 'hapi-namespace-locale-independent-race-'))
        directories.push(dataDir)

        const moduleUrl = pathToFileURL(new URL('./namespaceSettings.ts', import.meta.url).pathname).href
        const firstModule = await import(`${moduleUrl}?instance=first`)
        const secondModule = await import(`${moduleUrl}?instance=second`)

        await Promise.all([
            firstModule.writeNamespaceLocale(dataDir, 'alpha', 'zh-CN'),
            secondModule.writeNamespaceLocale(dataDir, 'beta', 'en')
        ])

        expect(await readNamespaceLocale(dataDir, 'alpha')).toBe('zh-CN')
        expect(await readNamespaceLocale(dataDir, 'beta')).toBe('en')
    })
})
