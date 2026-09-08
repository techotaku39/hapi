import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseCodexBaseUrl, resolveUsageCredentials } from './credentials'

describe('usage query credential resolution', () => {
    it('selects the active Codex provider and ignores comments', () => {
        expect(parseCodexBaseUrl(`
            model_provider = "OpenAI" # active provider
            [model_providers.Other]
            base_url = "https://other.example"
            [model_providers.OpenAI]
            base_url = "https://openai.example/v1"
        `)).toBe('https://openai.example/v1')
        expect(parseCodexBaseUrl(`
            model_provider = "Missing"
            [model_providers.Other]
            base_url = "https://other.example"
        `)).toBeNull()
    })

    it('prefers environment credentials and does not read config when they are complete', async () => {
        const result = await resolveUsageCredentials('claude', {
            ANTHROPIC_BASE_URL: 'https://env.example',
            ANTHROPIC_API_KEY: 'env-secret',
            CLAUDE_CONFIG_DIR: join(tmpdir(), 'missing-claude-config')
        })
        expect(result).toMatchObject({
            baseUrl: 'https://env.example',
            apiKey: 'env-secret',
            baseUrlSource: 'environment',
            apiKeySource: 'environment'
        })
    })

    it('reads Claude env entries and Codex config files without returning them to callers', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hapi-usage-credentials-'))
        try {
            const claudeDir = join(root, 'claude')
            const codexDir = join(root, 'codex')
            await mkdir(claudeDir)
            await mkdir(codexDir)
            await writeFile(join(claudeDir, 'settings.json'), JSON.stringify({
                env: {
                    ANTHROPIC_BASE_URL: 'https://claude.example/',
                    ANTHROPIC_AUTH_TOKEN: 'claude-secret'
                }
            }))
            await writeFile(join(codexDir, 'config.toml'), [
                'model_provider = "Gateway"',
                '[model_providers.Gateway]',
                'base_url = "https://codex.example/v1"'
            ].join('\n'))
            await writeFile(join(codexDir, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'codex-secret' }))

            const claude = await resolveUsageCredentials('claude', { CLAUDE_CONFIG_DIR: claudeDir })
            expect(claude).toMatchObject({ baseUrl: 'https://claude.example/', apiKey: 'claude-secret', baseUrlSource: 'config', apiKeySource: 'config' })

            const codex = await resolveUsageCredentials('codex', { CODEX_HOME: codexDir })
            expect(codex).toMatchObject({ baseUrl: 'https://codex.example/v1', apiKey: 'codex-secret', baseUrlSource: 'config', apiKeySource: 'config' })
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })

    it('reads the active Kimi provider from config.toml and environment overrides', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hapi-kimi-credentials-'))
        try {
            await mkdir(root, { recursive: true })
            await writeFile(join(root, 'config.toml'), [
                'default_model = "kimi-for-coding"',
                '[providers.kimi-for-coding]',
                'type = "kimi"',
                'base_url = "https://api.kimi.com/coding/v1"',
                'api_key = "config-kimi-secret"',
                '[models.kimi-for-coding]',
                'provider = "kimi-for-coding"'
            ].join('\n'))
            const configured = await resolveUsageCredentials('kimi', { KIMI_CODE_HOME: root })
            expect(configured).toMatchObject({
                baseUrl: 'https://api.kimi.com/coding/v1',
                apiKey: 'config-kimi-secret',
                baseUrlSource: 'config',
                apiKeySource: 'config'
            })

            const environment = await resolveUsageCredentials('kimi', {
                KIMI_CODE_HOME: root,
                KIMI_BASE_URL: 'https://env.kimi.example/v1',
                KIMI_API_KEY: 'env-kimi-secret'
            })
            expect(environment).toMatchObject({
                baseUrl: 'https://env.kimi.example/v1',
                apiKey: 'env-kimi-secret',
                baseUrlSource: 'environment',
                apiKeySource: 'environment'
            })
        } finally {
            await rm(root, { recursive: true, force: true })
        }
    })
})
