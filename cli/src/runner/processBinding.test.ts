import { describe, expect, it, vi } from 'vitest';
import { captureProcessBinding } from './processBinding';

describe('asynchronous process binding guard', () => {
    it('preserves a replacement registered under the same PID while termination awaits descendants', async () => {
        const pid = 42;
        const original = { sessionId: 'old' };
        const replacement = { sessionId: 'new' };
        const tracked = new Map([[pid, original]]);
        const requested = new Map([[pid, 'old']]);
        const persisted = new Map([[pid, { generation: 'old' }]]);
        const unchanged = captureProcessBinding(() => [tracked.get(pid), requested.get(pid), persisted.get(pid)]);
        const mutateDedupe = vi.fn();
        let complete!: () => void;
        const stopped = (async () => {
            await new Promise<void>(resolve => { complete = resolve; });
            if (unchanged()) {
                mutateDedupe(); tracked.delete(pid); requested.delete(pid); persisted.delete(pid);
            }
            return 'stopped';
        })();
        tracked.delete(pid); requested.delete(pid); persisted.delete(pid);
        tracked.set(pid, replacement); requested.set(pid, 'new'); persisted.set(pid, { generation: 'new' });
        complete();
        expect(await stopped).toBe('stopped');
        expect(tracked.get(pid)).toBe(replacement);
        expect(requested.get(pid)).toBe('new');
        expect(persisted.get(pid)).toEqual({ generation: 'new' });
        expect(mutateDedupe).not.toHaveBeenCalled();
    });

    it('allows cleanup only while all captured bindings remain unchanged', () => {
        const values: unknown[] = [{}, 'requested', 'confirmed', {}, 'dedupe', 0];
        const unchanged = captureProcessBinding(() => [...values]);
        expect(unchanged()).toBe(true);
        for (let index = 0; index < values.length; index++) {
            const value = values[index]; values[index] = Symbol('replacement');
            expect(unchanged()).toBe(false); values[index] = value;
        }
        expect(unchanged()).toBe(true);
    });
});
