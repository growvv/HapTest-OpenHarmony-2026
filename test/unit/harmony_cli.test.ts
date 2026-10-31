import { describe, expect, it } from 'vitest';
import { HarmonyCliDeps, runHarmonyCli } from '../../src/cli/harmony_command';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';

const hdcMissing: HarmonyCliDeps = {
    doctor: () => { throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not report its version.'); },
    devices: () => [],
    connect: async () => { throw new Error('unused'); },
};

describe('harmony cli', () => {
    it('explains how to install HDC and exits 3', async () => {
        const result = await runHarmonyCli(['doctor'], hdcMissing);
        expect(result.exitCode).toBe(3);
        expect(result.stderr).toContain('DevEco');
        expect(JSON.parse(result.stdout)).toMatchObject({ ok: false, errorCode: 'HDC_UNAVAILABLE' });
    });

    it('exits 2 on an unknown command', async () => {
        const result = await runHarmonyCli(['bogus'], hdcMissing);
        expect(result.exitCode).toBe(2);
        expect(result.stderr).toContain('usage');
    });
});
