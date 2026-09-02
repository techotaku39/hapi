import { describe, expect, it } from 'bun:test'
import type { Server } from 'socket.io'
import type { RpcRegistry } from '../socket/rpcRegistry'
import { RpcGateway, RpcTargetMissingError } from './rpcGateway'

function createGateway() {
    const timeouts: number[] = []
    const calls: Array<{ method: string; params: string }> = []
    const socket = {
        timeout(timeoutMs: number) {
            timeouts.push(timeoutMs)
            return {
                async emitWithAck(_event: string, payload: { method: string; params: string }) {
                    calls.push(payload)
                    if (payload.method.endsWith(':cursor-chat-store-status')) {
                        return JSON.stringify({ onDisk: false, store: null })
                    }
                    return JSON.stringify({
                        success: true,
                        method: payload.method,
                        params: JSON.parse(payload.params) as unknown
                    })
                }
            }
        }
    }

    const io = {
        of() {
            return {
                sockets: {
                    get() {
                        return socket
                    }
                }
            }
        }
    } as unknown as Server

    const rpcRegistry = {
        getSocketIdForMethod() {
            return 'socket-1'
        }
    } as unknown as RpcRegistry

    return {
        gateway: new RpcGateway(io, rpcRegistry),
        timeouts,
        calls
    }
}

describe('RpcGateway RPC timeouts', () => {
    it('uses the default RPC timeout for regular machine RPCs', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listMachineDirectory('machine-1', 'C:\\workspace')

        expect(timeouts).toEqual([30_000])
    })

    it('uses an extended RPC timeout when listing Codex models', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCodexModelsForMachine('machine-1')

        expect(timeouts).toEqual([120_000])
    })

    it('uses the session RPC for explicit Codex fallback discovery', async () => {
        const { gateway, calls, timeouts } = createGateway()

        await gateway.listCodexModelsForSession('session-1')

        expect(calls.map((call) => call.method)).toEqual(['session-1:listCodexModels'])
        expect(timeouts).toEqual([120_000])
    })

    it('uses an extended RPC timeout when listing Cursor models for a machine', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCursorModelsForMachine('machine-1')

        expect(timeouts).toEqual([120_000])
    })

    it('uses an extended RPC timeout when listing Copilot models', async () => {
        const { gateway, timeouts } = createGateway()

        await gateway.listCopilotModelsForCwd('machine-1', '/workspace')
        await gateway.listCopilotModelsForSession('session-1')

        expect(timeouts).toEqual([120_000, 120_000])
    })

    it('forwards the recorded session owner home to the Cursor store probe', async () => {
        const { gateway, calls } = createGateway()

        await gateway.getCursorChatStoreStatus(
            'machine-1',
            '/workspace/project',
            'cursor-session',
            '/home/recorded-owner'
        )

        expect(calls).toEqual([{
            method: 'machine-1:cursor-chat-store-status',
            params: JSON.stringify({
                workspacePath: '/workspace/project',
                cursorSessionId: 'cursor-session',
                homeDir: '/home/recorded-owner'
            })
        }])
    })

    it('uses machine-scoped RPCs for workspace file operations', async () => {
        const { gateway, calls } = createGateway()

        await gateway.readWorkspaceFile('machine-1', { cwd: '/workspace/project', path: 'src/index.ts' })
        await gateway.listWorkspaceDirectory('machine-1', { cwd: '/workspace/project', path: 'src' })
        await gateway.statWorkspaceFiles('machine-1', { cwd: '/workspace/project', paths: ['src/index.ts'] })
        await gateway.getWorkspaceGitStatus('machine-1', { cwd: '/workspace/project' })
        await gateway.getWorkspaceGitDiffNumstat('machine-1', { cwd: '/workspace/project', staged: true })
        await gateway.getWorkspaceGitDiffFile('machine-1', {
            cwd: '/workspace/project',
            filePath: 'src/index.ts',
            staged: false
        })
        await gateway.runWorkspaceRipgrep('machine-1', {
            args: ['--files'],
            cwd: '/workspace/project',
            fileSearch: { query: '*.ts', limit: 20 }
        })

        expect(calls.map((call) => call.method)).toEqual([
            'machine-1:workspace-read-file',
            'machine-1:workspace-list-directory',
            'machine-1:workspace-stat-files',
            'machine-1:workspace-git-status',
            'machine-1:workspace-git-diff-numstat',
            'machine-1:workspace-git-diff-file',
            'machine-1:workspace-ripgrep'
        ])
        expect(JSON.parse(calls[0].params)).toEqual({
            cwd: '/workspace/project',
            path: 'src/index.ts'
        })
        expect(JSON.parse(calls[5].params)).toEqual({
            cwd: '/workspace/project',
            filePath: 'src/index.ts',
            staged: false
        })
    })
})

describe('RpcGateway Recycle Bin methods', () => {
    it('uses session-scoped RPC names and forwards recycle-bin payloads', async () => {
        const { gateway, calls, timeouts } = createGateway()
        const entryId = '00000000-0000-4000-8000-000000000001'

        await gateway.moveFileToRecycleBin('session-1', 'src/notes.md')
        await gateway.listRecycleBin('session-1')
        await gateway.readRecycleBinEntry('session-1', entryId)
        await gateway.restoreRecycleBinEntry('session-1', entryId, 'overwrite')
        await gateway.purgeRecycleBinEntry('session-1', entryId)
        await gateway.emptyRecycleBin('session-1', [entryId])

        expect(calls).toEqual([
            { method: 'session-1:moveFileToRecycleBin', params: JSON.stringify({ path: 'src/notes.md' }) },
            { method: 'session-1:listRecycleBin', params: JSON.stringify({}) },
            { method: 'session-1:readRecycleBinEntry', params: JSON.stringify({ entryId }) },
            { method: 'session-1:restoreRecycleBinEntry', params: JSON.stringify({ entryId, conflict: 'overwrite' }) },
            { method: 'session-1:purgeRecycleBinEntry', params: JSON.stringify({ entryId }) },
            { method: 'session-1:emptyRecycleBin', params: JSON.stringify({ entryIds: [entryId] }) },
        ])
        expect(timeouts).toEqual([600_000, 30_000, 30_000, 600_000, 600_000, 600_000])
    })
})

// tiann/hapi#916: rpcCall throws a typed `RpcTargetMissingError` when the
// target CLI is unreachable, so syncEngine.archiveSession can narrow on it
// and treat the kill as a benign no-op.
describe('RpcGateway no-target diagnostics (tiann/hapi#916)', () => {
    it('throws RpcTargetMissingError(handler-not-registered) when no socket is registered for the method', async () => {
        const io = {
            of() {
                return {
                    sockets: {
                        get() { return undefined }
                    }
                }
            }
        } as unknown as Server
        const rpcRegistry = {
            getSocketIdForMethod() { return undefined }
        } as unknown as RpcRegistry
        const gateway = new RpcGateway(io, rpcRegistry)

        const error = await gateway.killSession('session-1').catch((e: unknown) => e)
        expect(error).toBeInstanceOf(RpcTargetMissingError)
        expect((error as RpcTargetMissingError).code).toBe('handler-not-registered')
    })

    it('throws RpcTargetMissingError(socket-disconnected) when the socket id is registered but no socket exists', async () => {
        const io = {
            of() {
                return {
                    sockets: {
                        get() { return undefined }
                    }
                }
            }
        } as unknown as Server
        const rpcRegistry = {
            getSocketIdForMethod() { return 'socket-1' }
        } as unknown as RpcRegistry
        const gateway = new RpcGateway(io, rpcRegistry)

        const error = await gateway.killSession('session-1').catch((e: unknown) => e)
        expect(error).toBeInstanceOf(RpcTargetMissingError)
        expect((error as RpcTargetMissingError).code).toBe('socket-disconnected')
    })
})

describe('RpcGateway cancellation', () => {
    it('sends a cancel event and rejects the aborted RPC', async () => {
        const emitted: Array<{ event: string; data: unknown }> = []
        let resolveAck!: (value: string) => void
        const socket = {
            emit(event: string, data: unknown) {
                emitted.push({ event, data })
            },
            timeout() {
                return {
                    emitWithAck: () => new Promise<string>((resolve) => {
                        resolveAck = resolve
                    })
                }
            }
        }
        const io = {
            of() {
                return { sockets: { get: () => socket } }
            }
        } as unknown as Server
        const rpcRegistry = {
            getSocketIdForMethod() { return 'socket-1' }
        } as unknown as RpcRegistry
        const gateway = new RpcGateway(io, rpcRegistry)
        const controller = new AbortController()

        const pending = gateway.runRipgrep(
            'session-1',
            ['--files'],
            '/workspace',
            { query: 'src', limit: 200 },
            controller.signal,
        )
        controller.abort()

        await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
        expect(emitted).toHaveLength(1)
        expect(emitted[0]).toMatchObject({
            event: 'rpc-cancel',
            data: { requestId: expect.any(String) },
        })

        // Let the underlying ack promise settle too; the caller has already
        // observed the abort, but the socket operation remains in flight until
        // the CLI finishes handling the cancellation.
        resolveAck(JSON.stringify({ success: true }))
    })
})
