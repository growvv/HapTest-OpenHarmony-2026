import { afterEach, describe, expect, it, vi } from 'vitest';
const { spawnSyncMock } = vi.hoisted(() => ({ spawnSyncMock: vi.fn() }));
vi.mock('child_process', async (importOriginal) => ({
    ...await importOriginal<typeof import('child_process')>(),
    spawnSync: spawnSyncMock,
}));
import { Hdc } from '../../src/device/hdc';

afterEach(() => vi.restoreAllMocks());

describe('Hdc focused text input', () => {
    it('passes text as a literal argument without a shell', () => {
        spawnSyncMock.mockReturnValue({
            pid: 1,
            output: [],
            stdout: '',
            stderr: '',
            status: 0,
            signal: null,
        } as never);
        const text = 'hello; touch /tmp/not-run $() 世界';

        new Hdc('device-1').inputFocusedText(text);

        expect(spawnSyncMock).toHaveBeenCalledWith('hdc', ['-t', 'device-1', 'shell', 'uitest', 'uiInput', 'text', text], {
            encoding: 'utf-8',
            shell: false,
            timeout: 30000,
        });
    });
});
