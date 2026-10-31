import { Hdc, HdcTargetInfo } from '../hdc';
import { UitestAgent, UitestAgentDiagnostic } from '../uidriver/uitest_agent';
import { HarmonyDeviceError } from './errors';
import { discoverHarmonyDevices } from './session';

export interface HarmonyDoctorReport {
    hdcVersion: string;
    devices: HdcTargetInfo[];
    device?: { serial: string; deviceType: string; agent: UitestAgentDiagnostic };
    issues: string[];
}

export function doctorHarmonyDevices(options: {
    serial?: string;
    getHdcVersion?: () => string;
    listTargets?: () => HdcTargetInfo[];
    diagnoseAgent?: (serial: string) => { deviceType: string; agent: UitestAgentDiagnostic };
} = {}): HarmonyDoctorReport {
    let hdcVersion: string;
    try {
        hdcVersion = (options.getHdcVersion ?? Hdc.getVersion)();
    } catch (error) {
        throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not report its version; check PATH and DevEco Command Line Tools.', undefined, error);
    }

    const devices = discoverHarmonyDevices({ listTargets: options.listTargets ?? Hdc.listTargets });
    const connected = devices.filter((item) => item.state.toLowerCase() === 'connected');
    const selected = options.serial ? devices.find((item) => item.serial === options.serial) : connected.length === 1 ? connected[0] : undefined;
    const issues: string[] = [];
    if (options.serial && !selected) issues.push(`Serial ${options.serial} is not visible to HDC.`);
    if (selected && selected.state.toLowerCase() !== 'connected') issues.push(`Serial ${selected.serial} is ${selected.state}.`);
    if (!options.serial && connected.length > 1) issues.push('Select a serial to inspect agent compatibility for one device.');
    if (connected.length === 0) issues.push('No connected HarmonyOS device is available.');
    if (!selected || selected.state.toLowerCase() !== 'connected') return { hdcVersion, devices, issues };

    try {
        const detail = (options.diagnoseAgent ?? ((serial) => {
            const hdc = new Hdc(serial);
            return { deviceType: hdc.getDeviceType(), agent: UitestAgent.diagnose(hdc) };
        }))(selected.serial);
        if (!detail.agent.installedAgent.compatible) issues.push('The installed uitest agent does not match the selected agent profile; ready may replace /data/local/tmp/agent.so.');
        if (!detail.agent.daemon.expectedEndpointRunning) issues.push('The compatible uitest daemon endpoint is not running; ready will attempt to start it.');
        return { hdcVersion, devices, device: { serial: selected.serial, ...detail }, issues };
    } catch (error) {
        throw new HarmonyDeviceError('AGENT_DIAGNOSTIC_FAILED', `Could not inspect uitest compatibility on ${selected.serial}.`, {
            serial: selected.serial,
        }, error);
    }
}
