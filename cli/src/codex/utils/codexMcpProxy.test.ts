import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import {
    prepareCodexMcpServers,
    shouldProxyCodexMcpStdio
} from './codexMcpProxy';

describe('codexMcpProxy', () => {
    it('limits the compatibility proxy to Windows command shims', () => {
        expect(shouldProxyCodexMcpStdio('uvx', 'win32')).toBe(true);
        expect(shouldProxyCodexMcpStdio('C:\\Tools\\uvx.exe', 'win32')).toBe(true);
        expect(shouldProxyCodexMcpStdio('C:\\Tools\\server.cmd', 'win32')).toBe(true);
        expect(shouldProxyCodexMcpStdio('node', 'win32')).toBe(false);
        expect(shouldProxyCodexMcpStdio('uvx', 'linux')).toBe(false);
    });

    it('preserves server fields while replacing only the Windows shim launcher', async () => {
        const prepared = await prepareCodexMcpServers({
            'package-manager': {
                command: 'uvx',
                args: ['--from', 'example-mcp==1.0.0', 'example-mcp', 'serve'],
                env_vars: ['EXAMPLE_TOKEN'],
                enabled: true,
                tool_timeout_sec: 60
            },
            nodeServer: {
                command: 'node',
                args: ['server.js'],
                enabled: true
            },
            remote: {
                url: 'https://example.test/mcp',
                bearer_token_env_var: 'REMOTE_MCP_TOKEN'
            }
        }, 'win32');

        try {
            const proxied = prepared.servers['package-manager'] as {
                command: string;
                args: string[];
                [key: string]: unknown;
            };
            expect(proxied).toEqual(expect.objectContaining({
                env_vars: ['EXAMPLE_TOKEN'],
                enabled: true,
                tool_timeout_sec: 60
            }));
            expect(proxied.command).toBe('node');
            expect(proxied.args[0]).toBe('-e');

            const specPath = proxied.args.at(-1);
            expect(typeof specPath).toBe('string');
            if (!specPath) {
                throw new Error('Expected a proxy spec path');
            }
            expect(existsSync(specPath)).toBe(true);
            await expect(readFile(specPath, 'utf8')).resolves.toBe(JSON.stringify({
                command: 'uvx',
                args: ['--from', 'example-mcp==1.0.0', 'example-mcp', 'serve'],
                env_vars: ['EXAMPLE_TOKEN']
            }));

            expect(prepared.servers.nodeServer).toEqual({
                command: 'node',
                args: ['server.js'],
                enabled: true
            });
            expect(prepared.servers.remote).toEqual({
                url: 'https://example.test/mcp',
                bearer_token_env_var: 'REMOTE_MCP_TOKEN'
            });
        } finally {
            await prepared.cleanup();
        }

        const cleanedProxy = prepared.servers['package-manager'] as { args: string[] };
        expect(existsSync(cleanedProxy.args.at(-1) as string)).toBe(false);
        await prepared.cleanup();
    });
});
