import { describe, expect, it, vi } from 'vitest';
import { HdcTargetInfo } from '../../src/device/hdc';
import { HarmonyDeviceError } from '../../src/device/harmony/errors';
import { doctorHarmonyDevices } from '../../src/device/harmony/doctor';
import { UitestAgentDiagnostic } from '../../src/device/uidriver/uitest_agent';

const device: HdcTargetInfo = { serial: 'serial-A', transport: 'USB', state: 'Connected', host: 'localhost', type: 'hdc' };
const agent: UitestAgentDiagnostic = {
    uitestVersion: '7.0.0.1',
    architecture: 'arm64',
    selectedAgent: { version: '1.2.2', architecture: 'arm64', transport: 'unix', endpoint: 'localabstract:uitest_socket' },
    installedAgent: { version: '1.2.2', fileInfo: 'ELF aarch64', compatible: true, replacementReasons: [] },
    daemon: {
        expectedEndpoint: 'localabstract:uitest_socket',
        expectedEndpointRunning: false,
        alternateEndpoint: 'tcp:8012',
        alternateEndpointRunning: false,
    },
};

describe('HarmonyOS doctor', () => {
    it('checks HDC, selects the only connected device, and reports read-only agent compatibility', () => {
        const diagnoseAgent = vi.fn(() => ({ deviceType: 'phone', agent }));
        const report = doctorHarmonyDevices({
            getHdcVersion: () => 'Ver: test',
            listTargets: () => [device],
            diagnoseAgent,
        });

        expect(report).toMatchObject({ hdcVersion: 'Ver: test', device: { serial: 'serial-A', deviceType: 'phone', agent }, issues: ['The compatible uitest daemon endpoint is not running; ready will attempt to start it.'] });
        expect(diagnoseAgent).toHaveBeenCalledWith('serial-A');
    });

    it('requires a serial to inspect agent status when multiple devices are online', () => {
        const diagnoseAgent = vi.fn();
        const report = doctorHarmonyDevices({
            getHdcVersion: () => 'Ver: test',
            listTargets: () => [device, { ...device, serial: 'serial-B' }],
            diagnoseAgent,
        });

        expect(report.device).toBeUndefined();
        expect(report.issues).toContain('Select a serial to inspect agent compatibility for one device.');
        expect(diagnoseAgent).not.toHaveBeenCalled();
    });

    it('returns domain errors for HDC and agent diagnostic failures', () => {
        expect(() => doctorHarmonyDevices({ getHdcVersion: () => { throw new Error('missing hdc'); } }))
            .toThrowError(expect.objectContaining({ code: 'HDC_UNAVAILABLE' }));
        expect(() => doctorHarmonyDevices({
            getHdcVersion: () => 'Ver: test',
            listTargets: () => [device],
            diagnoseAgent: () => { throw new Error('device query failed'); },
        })).toThrowError(expect.objectContaining({ code: 'AGENT_DIAGNOSTIC_FAILED' }));
    });

    it('preserves the underlying diagnostic cause', () => {
        const cause = new Error('diagnostic failed');
        try {
            doctorHarmonyDevices({ getHdcVersion: () => { throw cause; } });
        } catch (error) {
            expect(error).toBeInstanceOf(HarmonyDeviceError);
            expect((error as HarmonyDeviceError).cause).toBe(cause);
        }
    });
});
