import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { UsageQueryAgent, UsageQueryCredentialStatus } from '@hapi/protocol/usageQuery'

export type ResolvedUsageCredentials = {
    baseUrl: string
    apiKey: string
    baseUrlSource: UsageQueryCredentialStatus['source']
    apiKeySource: UsageQueryCredentialStatus['source']
}

type JsonObject = Record<string, unknown>

function nonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    return trimmed ? trimmed : null
}

async function readJsonObject(path: string): Promise<JsonObject | null> {
    try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? parsed as JsonObject
            : null
    } catch {
        return null
    }
}

function firstObjectString(object: JsonObject | null, keys: readonly string[]): string | null {
    if (!object) return null
    for (const key of keys) {
        const value = nonEmptyString(object[key])
        if (value) return value
    }
    return null
}

function stripTomlComment(line: string): string {
    let quote: '"' | "'" | null = null
    let escaped = false
    for (let index = 0; index < line.length; index += 1) {
        const char = line[index]
        if (quote === '"' && escaped) {
            escaped = false
            continue
        }
        if (quote === '"' && char === '\\') {
            escaped = true
            continue
        }
        if ((char === '"' || char === "'") && (quote === null || quote === char)) {
            quote = quote === null ? char : null
            continue
        }
        if (char === '#' && quote === null) return line.slice(0, index)
    }
    return line
}

function unquoteTomlString(value: string): string | null {
    const trimmed = value.trim()
    if (trimmed.length < 2) return null
    const quote = trimmed[0]
    if ((quote !== '"' && quote !== "'") || trimmed.at(-1) !== quote) return null
    if (quote === "'") return trimmed.slice(1, -1)
    try {
        return JSON.parse(trimmed) as string
    } catch {
        return trimmed.slice(1, -1)
    }
}

type KimiProviderConfig = {
    baseUrl?: string
    apiKey?: string
}

type KimiConfigSnapshot = {
    defaultModel: string | null
    providers: Map<string, KimiProviderConfig>
    modelProviders: Map<string, string>
}

function parseKimiToml(configText: string): KimiConfigSnapshot {
    let sectionType: 'root' | 'providers' | 'models' | null = 'root'
    let sectionName: string | null = null
    let defaultModel: string | null = null
    const providers = new Map<string, KimiProviderConfig>()
    const modelProviders = new Map<string, string>()

    for (const rawLine of configText.split(/\r?\n/)) {
        const line = stripTomlComment(rawLine).trim()
        if (!line) continue

        const section = /^\[(providers|models)(?:\."([^"]+)"|\.'([^']+)'|\.([A-Za-z0-9_.-]+))\]$/.exec(line)
        if (section) {
            sectionType = section[1] as 'providers' | 'models'
            sectionName = section[2] ?? section[3] ?? section[4] ?? null
            continue
        }
        if (line.startsWith('[')) {
            sectionType = null
            sectionName = null
            continue
        }

        const match = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line)
        if (!match) continue
        const key = match[1]
        const value = unquoteTomlString(match[2])
        if (sectionType === 'root' && key === 'default_model') {
            defaultModel = value
            continue
        }
        if (!sectionName || value === null) continue
        if (sectionType === 'providers') {
            const current = providers.get(sectionName) ?? {}
            if (key === 'base_url') current.baseUrl = value
            if (key === 'api_key') current.apiKey = value
            providers.set(sectionName, current)
        } else if (sectionType === 'models' && key === 'provider') {
            modelProviders.set(sectionName, value)
        }
    }

    return { defaultModel, providers, modelProviders }
}

function parseKimiJson(config: JsonObject): KimiConfigSnapshot {
    const defaultModel = nonEmptyString(config.default_model)
    const providers = new Map<string, KimiProviderConfig>()
    const modelProviders = new Map<string, string>()
    const rawProviders = config.providers
    if (rawProviders && typeof rawProviders === 'object' && !Array.isArray(rawProviders)) {
        for (const [name, value] of Object.entries(rawProviders as JsonObject)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue
            const provider = value as JsonObject
            providers.set(name, {
                baseUrl: nonEmptyString(provider.base_url) ?? undefined,
                apiKey: nonEmptyString(provider.api_key) ?? undefined
            })
        }
    }
    const rawModels = config.models
    if (rawModels && typeof rawModels === 'object' && !Array.isArray(rawModels)) {
        for (const [name, value] of Object.entries(rawModels as JsonObject)) {
            if (!value || typeof value !== 'object' || Array.isArray(value)) continue
            const provider = nonEmptyString((value as JsonObject).provider)
            if (provider) modelProviders.set(name, provider)
        }
    }
    return { defaultModel, providers, modelProviders }
}

function chooseKimiProvider(snapshot: KimiConfigSnapshot): KimiProviderConfig | null {
    const activeProvider = snapshot.defaultModel
        ? snapshot.modelProviders.get(snapshot.defaultModel)
        : null
    if (activeProvider && snapshot.providers.has(activeProvider)) return snapshot.providers.get(activeProvider) ?? null
    return snapshot.providers.values().next().value ?? null
}

async function readKimiConfig(env: NodeJS.ProcessEnv, userHome = homedir()): Promise<KimiConfigSnapshot> {
    const explicitHome = nonEmptyString(env.KIMI_CODE_HOME) ?? nonEmptyString(env.KIMI_SHARE_DIR)
    const homes = [
        explicitHome,
        join(userHome, '.kimi-code'),
        join(userHome, '.kimi')
    ].filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)

    for (const home of homes) {
        const tomlPath = join(home, 'config.toml')
        try {
            return parseKimiToml(await readFile(tomlPath, 'utf8'))
        } catch {
            // Try the JSON migration format below.
        }
        const json = await readJsonObject(join(home, 'config.json'))
        if (json) return parseKimiJson(json)
    }
    return { defaultModel: null, providers: new Map(), modelProviders: new Map() }
}

/**
 * Read the active Codex model provider's base URL without a TOML dependency.
 * This intentionally supports the small stable subset needed for credentials:
 * `model_provider` and `[model_providers.<name>] base_url`.
 */
export function parseCodexBaseUrl(configText: string): string | null {
    let activeProvider: string | null = null
    let currentProvider: string | null = null
    let fallbackBaseUrl: string | null = null

    for (const rawLine of configText.split(/\r?\n/)) {
        const line = stripTomlComment(rawLine).trim()
        if (!line) continue

        const section = /^\[model_providers(?:\."([^"]+)"|\.'([^']+)'|\.([A-Za-z0-9_-]+))\]$/.exec(line)
        if (section) {
            currentProvider = section[1] ?? section[2] ?? section[3] ?? null
            continue
        }
        if (line.startsWith('[')) {
            currentProvider = null
            continue
        }

        const providerMatch = /^model_provider\s*=\s*(.+)$/.exec(line)
        if (providerMatch && currentProvider === null) {
            activeProvider = unquoteTomlString(providerMatch[1])
            continue
        }

        const baseUrlMatch = /^base_url\s*=\s*(.+)$/.exec(line)
        if (!baseUrlMatch || currentProvider === null) continue
        const baseUrl = nonEmptyString(unquoteTomlString(baseUrlMatch[1]))
        if (!baseUrl) continue
        if (fallbackBaseUrl === null) fallbackBaseUrl = baseUrl
        if (activeProvider !== null && currentProvider === activeProvider) return baseUrl
    }

    return activeProvider === null ? fallbackBaseUrl : null
}

async function resolveClaudeCredentials(env: NodeJS.ProcessEnv): Promise<ResolvedUsageCredentials> {
    let baseUrl = nonEmptyString(env.ANTHROPIC_BASE_URL)
    let apiKey = nonEmptyString(env.CLAUDE_CODE_OAUTH_TOKEN)
        ?? nonEmptyString(env.ANTHROPIC_AUTH_TOKEN)
        ?? nonEmptyString(env.ANTHROPIC_API_KEY)
    let baseUrlSource: UsageQueryCredentialStatus['source'] = baseUrl ? 'environment' : 'none'
    let apiKeySource: UsageQueryCredentialStatus['source'] = apiKey ? 'environment' : 'none'

    const configDir = nonEmptyString(env.CLAUDE_CONFIG_DIR) ?? join(homedir(), '.claude')
    const settings = await readJsonObject(join(configDir, 'settings.json'))
    const settingsEnv = settings?.env && typeof settings.env === 'object' && !Array.isArray(settings.env)
        ? settings.env as JsonObject
        : settings
    if (!baseUrl) {
        baseUrl = firstObjectString(settingsEnv, ['ANTHROPIC_BASE_URL']) ?? ''
        if (baseUrl) baseUrlSource = 'config'
    }
    if (!apiKey) {
        apiKey = firstObjectString(settingsEnv, ['CLAUDE_CODE_OAUTH_TOKEN', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY']) ?? ''
        if (apiKey) apiKeySource = 'config'
    }

    return {
        baseUrl: baseUrl ?? '',
        apiKey: apiKey ?? '',
        baseUrlSource,
        apiKeySource
    }
}

async function resolveCodexCredentials(env: NodeJS.ProcessEnv): Promise<ResolvedUsageCredentials> {
    let baseUrl = nonEmptyString(env.OPENAI_BASE_URL)
    let apiKey = nonEmptyString(env.OPENAI_API_KEY)
    let baseUrlSource: UsageQueryCredentialStatus['source'] = baseUrl ? 'environment' : 'none'
    let apiKeySource: UsageQueryCredentialStatus['source'] = apiKey ? 'environment' : 'none'

    const codexHome = nonEmptyString(env.CODEX_HOME) ?? join(homedir(), '.codex')
    if (!baseUrl) {
        try {
            baseUrl = parseCodexBaseUrl(await readFile(join(codexHome, 'config.toml'), 'utf8')) ?? ''
        } catch {
            baseUrl = ''
        }
        if (baseUrl) baseUrlSource = 'config'
    }
    if (!apiKey) {
        const auth = await readJsonObject(join(codexHome, 'auth.json'))
        apiKey = firstObjectString(auth, ['OPENAI_API_KEY', 'openai_api_key', 'api_key', 'apiKey']) ?? ''
        if (apiKey) apiKeySource = 'config'
    }

    return {
        baseUrl: baseUrl ?? '',
        apiKey: apiKey ?? '',
        baseUrlSource,
        apiKeySource
    }
}

async function resolveKimiCredentials(env: NodeJS.ProcessEnv, userHome = homedir()): Promise<ResolvedUsageCredentials> {
    let baseUrl = nonEmptyString(env.KIMI_BASE_URL)
    let apiKey = nonEmptyString(env.KIMI_API_KEY)
    let baseUrlSource: UsageQueryCredentialStatus['source'] = baseUrl ? 'environment' : 'none'
    let apiKeySource: UsageQueryCredentialStatus['source'] = apiKey ? 'environment' : 'none'

    const provider = chooseKimiProvider(await readKimiConfig(env, userHome))
    if (!baseUrl) {
        baseUrl = provider?.baseUrl ?? ''
        if (baseUrl) baseUrlSource = 'config'
    }
    if (!apiKey) {
        apiKey = provider?.apiKey ?? ''
        if (apiKey) apiKeySource = 'config'
    }

    return {
        baseUrl: baseUrl ?? '',
        apiKey: apiKey ?? '',
        baseUrlSource,
        apiKeySource
    }
}

export async function resolveUsageCredentials(
    agent: UsageQueryAgent,
    env: NodeJS.ProcessEnv = process.env,
    userHome = homedir()
): Promise<ResolvedUsageCredentials> {
    if (agent === 'claude') return await resolveClaudeCredentials(env)
    if (agent === 'codex') return await resolveCodexCredentials(env)
    return await resolveKimiCredentials(env, userHome)
}
