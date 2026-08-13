import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import {
    SupportedLocaleSchema,
    type SupportedLocale
} from '@hapi/protocol'
import { withSettingsFileLock } from '@hapi/protocol/settingsFileLock'

const DEFAULT_LOCALE: SupportedLocale = 'en'

const NamespaceSettingsFileSchema = z.object({
    locales: z.record(z.string().min(1), SupportedLocaleSchema).optional()
})

type NamespaceSettingsFile = z.infer<typeof NamespaceSettingsFileSchema>

const updateChains = new Map<string, Promise<unknown>>()

export function getNamespaceSettingsFile(dataDir: string): string {
    return join(dataDir, 'namespace-settings.json')
}

async function readNamespaceSettingsOrThrow(settingsFile: string): Promise<NamespaceSettingsFile> {
    if (!existsSync(settingsFile)) {
        return {}
    }

    try {
        const content = await readFile(settingsFile, 'utf8')
        const parsed = NamespaceSettingsFileSchema.safeParse(JSON.parse(content))
        if (!parsed.success) {
            throw new Error(parsed.error.message)
        }
        return parsed.data
    } catch (error) {
        throw new Error(`Cannot read ${settingsFile}: ${error instanceof Error ? error.message : String(error)}`)
    }
}

async function withNamespaceSettingsFileLock<T>(
    settingsFile: string,
    work: () => Promise<T>
): Promise<T> {
    await mkdir(dirname(settingsFile), { recursive: true, mode: 0o700 })
    try {
        await writeFile(settingsFile, '{}', { flag: 'wx', mode: 0o600 })
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
            throw error
        }
    }
    return withSettingsFileLock(settingsFile, work)
}

async function withNamespaceSettingsLock<T>(settingsFile: string, work: () => Promise<T>): Promise<T> {
    const previous = updateChains.get(settingsFile) ?? Promise.resolve()
    const run = previous.catch(() => undefined).then(() => withNamespaceSettingsFileLock(settingsFile, work))
    updateChains.set(settingsFile, run.then(() => undefined, () => undefined))
    return run
}

async function writeNamespaceSettingsUnlocked(
    settingsFile: string,
    settings: NamespaceSettingsFile
): Promise<void> {
    const dir = dirname(settingsFile)
    if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true, mode: 0o700 })
    }
    await chmod(dir, 0o700).catch(() => {})

    const tmpFile = join(dir, `.namespace-settings.${randomUUID()}.tmp`)
    try {
        await writeFile(tmpFile, JSON.stringify(settings, null, 2), { mode: 0o600 })
        await chmod(tmpFile, 0o600).catch(() => {})
        await rename(tmpFile, settingsFile)
        await chmod(settingsFile, 0o600).catch(() => {})
    } catch (error) {
        await unlink(tmpFile).catch(() => {})
        throw error
    }
}

export async function readNamespaceLocale(dataDir: string, namespace: string): Promise<SupportedLocale> {
    const settings = await readNamespaceSettingsOrThrow(getNamespaceSettingsFile(dataDir))
    const locale = settings.locales && Object.prototype.hasOwnProperty.call(settings.locales, namespace)
        ? settings.locales[namespace]
        : undefined
    return locale ?? DEFAULT_LOCALE
}

export async function writeNamespaceLocale(
    dataDir: string,
    namespace: string,
    locale: SupportedLocale
): Promise<SupportedLocale> {
    const settingsFile = getNamespaceSettingsFile(dataDir)
    return withNamespaceSettingsLock(settingsFile, async () => {
        const current = await readNamespaceSettingsOrThrow(settingsFile)
        const locales: Record<string, SupportedLocale> = Object.create(null)
        Object.assign(locales, current.locales ?? {})
        locales[namespace] = locale
        await writeNamespaceSettingsUnlocked(settingsFile, { locales })
        return locale
    })
}
