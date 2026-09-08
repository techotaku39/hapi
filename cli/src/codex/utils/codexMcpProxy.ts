import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CodexMcpServersConfig } from './codexMcpServers';

const WINDOWS_COMMAND_SHIMS = new Set([
    'bunx',
    'npx',
    'npm',
    'pnpm',
    'uv',
    'uvx',
    'yarn'
]);

type StdioProxySpec = {
    command: string;
    args: string[];
    env_vars?: string[];
};

export const NODE_STDIO_PROXY_SCRIPT = `
const { readFileSync } = require('node:fs');
const { spawn, execFileSync } = require('node:child_process');
const spec = JSON.parse(readFileSync(process.argv[1], 'utf8'));
if (typeof spec.command !== 'string' || !Array.isArray(spec.args) || spec.args.some((arg) => typeof arg !== 'string')) {
    throw new Error('Invalid MCP proxy spec');
}

const env = { ...process.env };
const envVars = Array.isArray(spec.env_vars)
    ? spec.env_vars.filter((name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
    : [];
for (const name of envVars) {
    if (env[name]) continue;
    try {
        const command = '[Environment]::GetEnvironmentVariable(' + JSON.stringify(name) + ', "User")';
        const value = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).trim();
        if (value) env[name] = value;
    } catch {}
}

const resolveWindowsCommand = (command) => {
    if (process.platform !== 'win32' || /[\\/]/.test(command) || /\\.(exe|cmd|bat)$/i.test(command)) {
        return command;
    }
    try {
        const entries = execFileSync('where.exe', [command], {
            encoding: 'utf8',
            windowsHide: true
        })
            .split(/\\r?\\n/)
            .map((entry) => entry.trim())
            .filter(Boolean);
        return entries.find((entry) => /\\.(exe|cmd|bat)$/i.test(entry)) ?? entries[0] ?? command;
    } catch {
        return command;
    }
};

const resolvedCommand = resolveWindowsCommand(spec.command);
const child = spawn(resolvedCommand, spec.args, {
    cwd: process.cwd(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: process.platform === 'win32' && /\\.(cmd|bat)$/i.test(resolvedCommand),
    windowsHide: process.platform === 'win32'
});
process.stdin.on('data', (chunk) => child.stdin.write(chunk));
child.stdout.on('data', (chunk) => process.stdout.write(chunk));
child.stderr.on('data', () => {});
child.on('error', (error) => {
    process.stderr.write('[hapi-mcp-proxy] ' + error.message + '\\n');
    process.exitCode = 1;
});
child.on('close', (code) => process.exit(code == null ? 1 : code));
`;

export type PreparedCodexMcpServers = {
    servers: CodexMcpServersConfig;
    proxiedServerNames: string[];
    cleanup: () => Promise<void>;
};

function commandBaseName(command: string): string {
    const normalized = command.trim().replace(/[\\/]+$/, '');
    const lastSeparator = Math.max(normalized.lastIndexOf('\\'), normalized.lastIndexOf('/'));
    return (lastSeparator >= 0 ? normalized.slice(lastSeparator + 1) : normalized).toLowerCase();
}

/**
 * Codex currently launches Windows MCP commands verbatim. Package-manager
 * shims can close before returning the initialize response when launched by
 * the Rust stdio launcher, while the same process works through a native
 * HAPI child process. Keep the workaround narrow to known command shims.
 */
export function shouldProxyCodexMcpStdio(command: string, platform = process.platform): boolean {
    if (platform !== 'win32') {
        return false;
    }

    const baseName = commandBaseName(command);
    const executableName = baseName.endsWith('.exe') ? baseName.slice(0, -4) : baseName;
    return WINDOWS_COMMAND_SHIMS.has(baseName)
        || WINDOWS_COMMAND_SHIMS.has(executableName)
        || baseName.endsWith('.cmd')
        || baseName.endsWith('.bat');
}

async function writeProxySpec(spec: StdioProxySpec): Promise<{ directory: string; path: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'hapi-codex-mcp-'));
    const path = join(directory, `${randomUUID()}.json`);
    await writeFile(path, JSON.stringify(spec), { encoding: 'utf8', mode: 0o600 });
    return { directory, path };
}

/**
 * Prepare user MCP entries for a Codex session.
 *
 * Only Windows package-manager shims are proxied. All other entries, URL
 * transports, environment fields, and newer Codex fields remain unchanged.
 */
export async function prepareCodexMcpServers(
    servers: CodexMcpServersConfig,
    platform = process.platform
): Promise<PreparedCodexMcpServers> {
    const prepared: CodexMcpServersConfig = {};
    const proxiedServerNames: string[] = [];
    const temporaryDirectories: string[] = [];

    try {
        for (const [name, server] of Object.entries(servers)) {
            if (typeof server.command !== 'string' || !shouldProxyCodexMcpStdio(server.command, platform)) {
                prepared[name] = server;
                continue;
            }

            const spec = await writeProxySpec({
                command: server.command,
                args: Array.isArray(server.args)
                    ? server.args.filter((arg): arg is string => typeof arg === 'string')
                    : [],
                ...(Array.isArray(server.env_vars)
                    ? { env_vars: server.env_vars.filter((name): name is string => typeof name === 'string') }
                    : {})
            });
            temporaryDirectories.push(spec.directory);

            prepared[name] = {
                ...server,
                command: 'node',
                args: ['-e', NODE_STDIO_PROXY_SCRIPT, spec.path]
            };
            proxiedServerNames.push(name);
        }
    } catch (error) {
        await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
        throw error;
    }

    let cleaned = false;
    const cleanup = async () => {
        if (cleaned) {
            return;
        }
        cleaned = true;
        await Promise.all(temporaryDirectories.map((directory) => rm(directory, { force: true, recursive: true })));
    };

    return { servers: prepared, proxiedServerNames, cleanup };
}
