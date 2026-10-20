/** Capture all PID bindings before an asynchronous lifecycle operation. */
export function captureProcessBinding(readBinding: () => readonly unknown[]): () => boolean {
    const original = readBinding();
    return () => {
        const current = readBinding();
        return current.length === original.length && current.every((value, index) => value === original[index]);
    };
}
