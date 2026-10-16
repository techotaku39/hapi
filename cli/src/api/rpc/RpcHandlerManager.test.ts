import { describe, expect, it, vi } from 'vitest'
import type { Socket } from 'socket.io-client'
import { RpcHandlerManager } from './RpcHandlerManager'

describe('RPC registration barrier', () => {
    it('waits for the Hub acknowledgement of the scoped handler', async () => {
        const manager = new RpcHandlerManager({ scopePrefix: 'session', logger() {} })
        let acknowledge!: (result: { ok: boolean }) => void
        const ack = new Promise(resolve => { acknowledge = resolve })
        const emitWithAck = vi.fn(() => ack)
        const socket = { connected: true, emit: vi.fn(), timeout: vi.fn(() => ({ emitWithAck })) } as unknown as Socket
        manager.registerHandler('config', async () => null)
        manager.onSocketConnect(socket)
        let ready = false
        const waiting = manager.waitForRegistration('config').then(() => { ready = true })
        await Promise.resolve()
        expect(ready).toBe(false)
        expect(emitWithAck).toHaveBeenCalledWith('rpc-register', { method: 'session:config' })
        acknowledge({ ok: true });await waiting
        expect(ready).toBe(true)
    })

    it('fails closed for a missing handler or a disconnected socket', async () => {
        const manager = new RpcHandlerManager({ scopePrefix: 'session', logger() {} })
        await expect(manager.waitForRegistration('config')).rejects.toThrow('connected handler')
    })

    it('does not report a rejected registration as ready', async () => {
        const manager = new RpcHandlerManager({ scopePrefix: 'session', logger() {} })
        manager.registerHandler('config', async () => null)
        manager.onSocketConnect({ connected: true, emit() {}, timeout: () => ({ emitWithAck: async () => ({ ok: false }) }) } as unknown as Socket)
        await expect(manager.waitForRegistration('config')).rejects.toThrow('Hub rejected')
    })
})
