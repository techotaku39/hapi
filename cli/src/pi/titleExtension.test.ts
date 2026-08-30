import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { materializePiTitleExtension, PI_TITLE_EXTENSION_SOURCE } from './titleExtension';

describe('pi title extension source', () => {
    it('registers a namespaced hapi_change_title tool and applies it via setTitle', () => {
        expect(PI_TITLE_EXTENSION_SOURCE).toContain("name: TOOL_NAME");
        expect(PI_TITLE_EXTENSION_SOURCE).toContain("'hapi_change_title'");
        expect(PI_TITLE_EXTENSION_SOURCE).toContain('ctx.ui.setTitle');
    });

    it('injects a first-turn title instruction, matching the other launchers', () => {
        expect(PI_TITLE_EXTENSION_SOURCE).toContain('## Session title');
        expect(PI_TITLE_EXTENSION_SOURCE).toContain('tool once');
        expect(PI_TITLE_EXTENSION_SOURCE).toContain('before_agent_start');
    });
});

describe('materializePiTitleExtension', () => {
    it('writes the extension into the target dir and returns its path', async () => {
        const dir = await mkdtemp(join(tmpdir(), 'hapi-pi-title-'));
        const file = await materializePiTitleExtension(dir);

        expect(file).toBe(join(dir, 'hapi-title-extension.ts'));
        const content = await readFile(file, 'utf8');
        expect(content).toContain('hapiTitleExtension');
        expect(content).toContain('hapi_change_title');
    });

    it('creates missing directories and is idempotent', async () => {
        const root = await mkdtemp(join(tmpdir(), 'hapi-pi-title-'));
        const dir = join(root, 'runtime', '0.0.0-test', 'pi');

        const first = await materializePiTitleExtension(dir);
        const second = await materializePiTitleExtension(dir);

        expect(first).toBe(second);
    });
});
