import { afterEach } from 'vitest';

// The geometry tests are long stretches of synchronous WebAssembly. Between
// tests vitest only awaits promises, which never lets the worker read the
// replies to its progress reports; after 60 s of that it reports a timeout
// even though every test passed. Yielding to the event loop after each test
// lets those replies through.
afterEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
