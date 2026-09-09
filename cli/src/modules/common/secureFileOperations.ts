import { constants, type Stats } from 'node:fs'
import { lstat, open, type FileHandle } from 'node:fs/promises'
import { basename, dirname } from 'node:path'

// Recycle-bin mutations must keep using the directory object selected during
// authorization. Node's path-based fs/promises mutations cannot express this;
// the CLI is shipped as Bun, so use Bun FFI only at the native mutation edge.

export type FileIdentity = {
    dev: string
    ino: string
}

export type SecureRenameOptions = {
    sourceDirectoryIdentity: string
    targetDirectoryIdentity: string
    sourceFileIdentity?: FileIdentity
}

const IS_WINDOWS = process.platform === 'win32'
const DIRECTORY_OPEN_FLAGS = constants.O_RDONLY
    | (constants.O_DIRECTORY ?? 0)
    | (constants.O_NOFOLLOW ?? 0)

function identityFromStats(stats: Stats): FileIdentity {
    return { dev: String(stats.dev), ino: String(stats.ino) }
}

function identityKey(identity: FileIdentity): string {
    return `${identity.dev}:${identity.ino}`
}

function isSimpleName(name: string): boolean {
    return name.length > 0 && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\')
}

function assertSiblingPaths(sourcePath: string, targetPath: string): { sourceDirectory: string; targetDirectory: string; sourceName: string; targetName: string } {
    const sourceDirectory = dirname(sourcePath)
    const targetDirectory = dirname(targetPath)
    const sourceName = basename(sourcePath)
    const targetName = basename(targetPath)
    if (!isSimpleName(sourceName) || !isSimpleName(targetName)) {
        throw new Error('Secure file operations require simple file names')
    }
    return { sourceDirectory, targetDirectory, sourceName, targetName }
}

function assertDirectoryIdentity(actual: string, expected: string): void {
    if (actual !== expected) throw new Error('Secure file operation parent changed during the operation')
}

async function assertFileIdentity(path: string, expected: FileIdentity | undefined): Promise<void> {
    if (!expected) return
    const stats = await lstat(path)
    if (!stats.isFile() || stats.isSymbolicLink() || identityKey(identityFromStats(stats)) !== identityKey(expected)) {
        throw new Error('Secure file operation source changed during the operation')
    }
}

type PosixDirectory = {
    kind: 'posix'
    handle: FileHandle
    identity: string
}

type WindowsNativeSymbols = {
    CreateFileW: (path: number, desiredAccess: number, shareMode: number, securityAttributes: number, creationDisposition: number, flagsAndAttributes: number, templateFile: number) => number
    CloseHandle: (handle: number) => number
    GetLastError: () => number
    GetFileInformationByHandle: (handle: number, information: number) => number
    NtSetInformationFile: (handle: number, ioStatusBlock: number, information: number, size: number, informationClass: number) => number
}

type BunFfi = {
    dlopen: (path: string, symbols: Record<string, unknown>) => { symbols: Record<string, (...args: (number | string)[]) => number> }
    ptr: (value: ArrayBufferView) => number
}

type WindowsDirectory = {
    kind: 'windows'
    handle: number
    identity: string
    symbols: WindowsNativeSymbols
}

type SecureDirectory = PosixDirectory | WindowsDirectory

let ffiModule: Promise<BunFfi> | null = null
let windowsSymbols: Promise<WindowsNativeSymbols> | null = null

async function loadFfi(): Promise<BunFfi> {
    if (!process.versions.bun) {
        throw new Error('Secure directory operations require the Bun runtime')
    }
    if (!ffiModule) ffiModule = import('bun:ffi') as unknown as Promise<BunFfi>
    return await ffiModule
}

async function getWindowsSymbols(): Promise<WindowsNativeSymbols> {
    if (!windowsSymbols) {
        windowsSymbols = (async () => {
            const { dlopen } = await loadFfi()
            const { symbols } = dlopen('kernel32.dll', {
                CreateFileW: {
                    args: ['ptr', 'u32', 'u32', 'ptr', 'u32', 'u32', 'ptr'],
                    returns: 'ptr',
                },
                CloseHandle: { args: ['ptr'], returns: 'u32' },
                GetLastError: { args: [], returns: 'u32' },
                GetFileInformationByHandle: { args: ['ptr', 'ptr'], returns: 'u32' },
            })
            const { symbols: nativeSymbols } = dlopen('ntdll.dll', {
                NtSetInformationFile: { args: ['ptr', 'ptr', 'ptr', 'u32', 'u32'], returns: 'i32' },
            })
            return { ...symbols, ...nativeSymbols } as unknown as WindowsNativeSymbols
        })()
    }
    return await windowsSymbols
}

async function utf16Pointer(value: string): Promise<{ buffer: Buffer; pointer: number }> {
    const buffer = Buffer.from(`${value}\0`, 'utf16le')
    const { ptr } = await loadFfi()
    return { buffer, pointer: ptr(buffer) }
}

function isInvalidWindowsHandle(handle: number): boolean {
    return handle === 0 || handle === -1
}

function windowsError(symbols: WindowsNativeSymbols, operation: string): Error {
    const code = symbols.GetLastError()
    return new Error(`${operation} failed with Windows error ${code}`)
}

function readWindowsFileIdentity(symbols: WindowsNativeSymbols, handle: number, pointer: (value: ArrayBufferView) => number): { identity: string; attributes: number } {
    const information = Buffer.alloc(52)
    if (!symbols.GetFileInformationByHandle(handle, pointer(information))) {
        throw windowsError(symbols, 'GetFileInformationByHandle')
    }
    const attributes = information.readUInt32LE(0)
    const volumeSerial = information.readUInt32LE(28)
    const fileIndexHigh = information.readUInt32LE(44)
    const fileIndexLow = information.readUInt32LE(48)
    return {
        attributes,
        identity: `${volumeSerial}:${fileIndexHigh}:${fileIndexLow}`,
    }
}

async function openSecureDirectory(path: string, expectedIdentity?: string): Promise<SecureDirectory> {
    if (!IS_WINDOWS) {
        const handle = await open(path, DIRECTORY_OPEN_FLAGS)
        try {
            const stats = await handle.stat()
            if (!stats.isDirectory() || stats.isSymbolicLink()) throw new Error('Secure file operation parent is not a real directory')
            const identity = identityKey(identityFromStats(stats))
            assertDirectoryIdentity(identity, expectedIdentity ?? identity)
            return { kind: 'posix', handle, identity }
        } catch (error) {
            await handle.close()
            throw error
        }
    }

    const symbols = await getWindowsSymbols()
    const { ptr: pointer } = await loadFfi()
    const { buffer, pointer: pathPointer } = await utf16Pointer(path)
    void buffer
    const handle = symbols.CreateFileW(
        pathPointer,
        0x0001 | 0x0080,
        0x00000007,
        0,
        3,
        0x02000000 | 0x00200000,
        0,
    )
    if (isInvalidWindowsHandle(handle)) throw windowsError(symbols, 'CreateFileW directory')
    try {
        const information = readWindowsFileIdentity(symbols, handle, pointer)
        if ((information.attributes & 0x00000010) === 0 || (information.attributes & 0x00000400) !== 0) {
            throw new Error('Secure file operation parent is not a real directory')
        }
        assertDirectoryIdentity(information.identity, expectedIdentity ?? information.identity)
        return { kind: 'windows', handle, identity: information.identity, symbols }
    } catch (error) {
        symbols.CloseHandle(handle)
        throw error
    }
}

async function closeSecureDirectory(directory: SecureDirectory): Promise<void> {
    if (directory.kind === 'posix') {
        await directory.handle.close()
        return
    }
    if (!directory.symbols.CloseHandle(directory.handle)) throw windowsError(directory.symbols, 'CloseHandle')
}

async function openWindowsFile(path: string, expectedIdentity?: FileIdentity): Promise<{ handle: number; symbols: WindowsNativeSymbols; identity: string }> {
    const symbols = await getWindowsSymbols()
    const { ptr: pointer } = await loadFfi()
    const { buffer, pointer: pathPointer } = await utf16Pointer(path)
    void buffer
    const handle = symbols.CreateFileW(
        pathPointer,
        0x00010000 | 0x00000080,
        0x00000007,
        0,
        3,
        0x00200000,
        0,
    )
    if (isInvalidWindowsHandle(handle)) throw windowsError(symbols, 'CreateFileW file')
    try {
        const information = readWindowsFileIdentity(symbols, handle, pointer)
        if ((information.attributes & 0x00000010) !== 0 || (information.attributes & 0x00000400) !== 0) {
            throw new Error('Secure file operation source is not a regular file')
        }
        await assertFileIdentity(path, expectedIdentity)
        return { handle, symbols, identity: information.identity }
    } catch (error) {
        symbols.CloseHandle(handle)
        throw error
    }
}

async function createWindowsRenameInformation(targetName: string, targetDirectoryHandle: number): Promise<{ buffer: Buffer; pointer: number }> {
    const fileName = Buffer.from(targetName, 'utf16le')
    const pointerSize = process.arch === 'ia32' ? 4 : 8
    const fileNameOffset = pointerSize === 4 ? 12 : 20
    const buffer = Buffer.alloc(fileNameOffset + fileName.length)
    buffer.writeUInt8(0, 0)
    if (pointerSize === 4) buffer.writeUInt32LE(targetDirectoryHandle, 4)
    else buffer.writeBigUInt64LE(BigInt(targetDirectoryHandle), 8)
    buffer.writeUInt32LE(fileName.length, pointerSize === 4 ? 8 : 16)
    fileName.copy(buffer, fileNameOffset)
    const { ptr } = await loadFfi()
    return { buffer, pointer: ptr(buffer) }
}

async function secureRenameWindows(
    sourcePath: string,
    targetName: string,
    targetDirectory: WindowsDirectory,
    sourceIdentity: FileIdentity | undefined,
): Promise<void> {
    // SetFileInformationByHandle does not reliably honor RootDirectory for a
    // relative rename on supported Windows filesystems. NtSetInformationFile
    // consumes the same FILE_RENAME_INFORMATION layout and preserves the
    // directory-handle-relative operation.
    const source = await openWindowsFile(sourcePath, sourceIdentity)
    try {
        const { buffer, pointer } = await createWindowsRenameInformation(targetName, targetDirectory.handle)
        void buffer
        const ioStatusBlock = Buffer.alloc(process.arch === 'ia32' ? 8 : 16)
        const status = source.symbols.NtSetInformationFile(source.handle, await bufferPointer(ioStatusBlock), pointer, buffer.length, 10)
        if (status < 0) {
            throw new Error(`NtSetInformationFile rename failed with status 0x${(status >>> 0).toString(16)}`)
        }
    } finally {
        if (!source.symbols.CloseHandle(source.handle)) throw windowsError(source.symbols, 'CloseHandle source')
    }
}

async function secureUnlinkWindows(path: string, expectedIdentity?: FileIdentity): Promise<void> {
    const file = await openWindowsFile(path, expectedIdentity)
    try {
        const information = Buffer.alloc(1)
        information.writeUInt8(1, 0)
        const ioStatusBlock = Buffer.alloc(process.arch === 'ia32' ? 8 : 16)
        const status = file.symbols.NtSetInformationFile(
            file.handle,
            await bufferPointer(ioStatusBlock),
            await bufferPointer(information),
            information.length,
            13,
        )
        if (status < 0) {
            throw new Error(`NtSetInformationFile delete failed with status 0x${(status >>> 0).toString(16)}`)
        }
    } finally {
        if (!file.symbols.CloseHandle(file.handle)) throw windowsError(file.symbols, 'CloseHandle delete')
    }
}

async function bufferPointer(buffer: ArrayBufferView): Promise<number> {
    const { ptr } = await loadFfi()
    return ptr(buffer)
}

async function getPosixSymbols() {
    const isDarwin = process.platform === 'darwin'
    const library = isDarwin ? 'libSystem.B.dylib' : 'libc.so.6'
    const { dlopen } = await loadFfi()
    if (isDarwin) {
        const { symbols } = dlopen(library, {
            renameatx_np: { args: ['i32', 'cstring', 'i32', 'cstring', 'u32'], returns: 'i32' },
            unlinkat: { args: ['i32', 'cstring', 'i32'], returns: 'i32' },
        })
        return {
            renameNoReplace: symbols.renameatx_np,
            unlinkat: symbols.unlinkat,
            noReplaceFlag: 0x00000004,
        }
    }
    const { symbols } = dlopen(library, {
        renameat2: { args: ['i32', 'cstring', 'i32', 'cstring', 'u32'], returns: 'i32' },
        unlinkat: { args: ['i32', 'cstring', 'i32'], returns: 'i32' },
    })
    return {
        renameNoReplace: symbols.renameat2,
        unlinkat: symbols.unlinkat,
        noReplaceFlag: 0x00000001,
    }
}

let posixSymbols: Promise<Awaited<ReturnType<typeof getPosixSymbols>>> | null = null

async function getCachedPosixSymbols() {
    if (!posixSymbols) posixSymbols = getPosixSymbols()
    return await posixSymbols
}

export async function getSecureDirectoryIdentity(path: string): Promise<string> {
    const directory = await openSecureDirectory(path)
    try {
        return directory.identity
    } finally {
        await closeSecureDirectory(directory)
    }
}

export async function secureRename(
    sourcePath: string,
    targetPath: string,
    options: SecureRenameOptions,
): Promise<void> {
    const { sourceDirectory, targetDirectory, sourceName, targetName } = assertSiblingPaths(sourcePath, targetPath)
    const sourceHandle = await openSecureDirectory(sourceDirectory, options.sourceDirectoryIdentity)
    let targetHandle: SecureDirectory | null = null
    try {
        targetHandle = await openSecureDirectory(targetDirectory, options.targetDirectoryIdentity)
        await assertFileIdentity(sourcePath, options.sourceFileIdentity)
        if (IS_WINDOWS) {
            await secureRenameWindows(sourcePath, targetName, targetHandle as WindowsDirectory, options.sourceFileIdentity)
            return
        }
        const symbols = await getCachedPosixSymbols()
        const sourcePosix = sourceHandle as PosixDirectory
        const targetPosix = targetHandle as PosixDirectory
        const result = symbols.renameNoReplace(
            sourcePosix.handle.fd,
            sourceName,
            targetPosix.handle.fd,
            targetName,
            symbols.noReplaceFlag,
        )
        if (result !== 0) throw new Error('Atomic no-replace rename failed')
    } finally {
        if (targetHandle) await closeSecureDirectory(targetHandle)
        await closeSecureDirectory(sourceHandle)
    }
}

export async function secureUnlink(path: string, directoryIdentity: string, fileIdentity?: FileIdentity): Promise<void> {
    const directoryPath = dirname(path)
    const name = basename(path)
    if (!isSimpleName(name)) throw new Error('Secure file operations require a simple file name')
    const directory = await openSecureDirectory(directoryPath, directoryIdentity)
    try {
        await assertFileIdentity(path, fileIdentity)
        if (IS_WINDOWS) {
            await secureUnlinkWindows(path, fileIdentity)
            return
        }
        const result = (await getCachedPosixSymbols()).unlinkat((directory as PosixDirectory).handle.fd, name, 0)
        if (result !== 0) throw new Error('Directory-relative unlink failed')
    } finally {
        await closeSecureDirectory(directory)
    }
}

export function fileIdentityFromStats(stats: Stats): FileIdentity {
    return identityFromStats(stats)
}
