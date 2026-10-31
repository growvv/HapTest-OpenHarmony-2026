import fs from 'fs';
import { doctorHarmonyDevices, HarmonyDoctorReport } from '../device/harmony/doctor';
import { HarmonyDeviceError, HarmonyDeviceErrorCode } from '../device/harmony/errors';
import { HarmonyDevice, HarmonyObservation } from '../device/harmony/session';
import { Hdc, HdcTargetInfo } from '../device/hdc';

export interface CliResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface HarmonyCliDeps {
    doctor(options: { serial?: string }): HarmonyDoctorReport;
    devices(): HdcTargetInfo[];
    connect(options: { serial?: string }): Promise<HarmonyDevice>;
}

const defaultDeps: HarmonyCliDeps = {
    doctor: (options) => doctorHarmonyDevices(options),
    devices: () => Hdc.listTargets(),
    connect: (options) => HarmonyDevice.connect(options),
};

const USAGE = [
    'usage: haptest harmony <command> [options]',
    '',
    '  doctor    check HDC, devices and uitest agent readiness',
    '  devices   list HarmonyOS devices visible to HDC',
].join('\n');

const HDC_HELP = [
    'hdc was not found on PATH.',
    '',
    'Install DevEco Studio or the DevEco Command Line Tools, then add its',
    'toolchains directory to PATH, for example:',
    '  export PATH="$HOME/Library/Huawei/Sdk/openharmony/<version>/toolchains:$PATH"',
    '',
    'Verify with: hdc version && hdc list targets',
].join('\n');

const PRECONDITION_CODES: ReadonlySet<HarmonyDeviceErrorCode> = new Set<HarmonyDeviceErrorCode>([
    'HDC_UNAVAILABLE',
    'NO_DEVICE',
    'MULTIPLE_DEVICES',
    'DEVICE_OFFLINE',
    'DEVICE_BUSY',
    'SESSION_CLOSED',
    'ACTION_PRECONDITION_FAILED',
    'STALE_OBSERVATION',
    'INPUT_FOCUS_REQUIRED',
    'SENSITIVE_FIELD',
]);

const NEXT_STEP: Partial<Record<HarmonyDeviceErrorCode, string>> = {
    HDC_UNAVAILABLE: 'Install DevEco Command Line Tools and add hdc to PATH, then run doctor again.',
    NO_DEVICE: 'Connect and authorize one HarmonyOS device, then run devices.',
    MULTIPLE_DEVICES: 'Pass --serial to select the intended device.',
    DEVICE_OFFLINE: 'Reconnect and authorize the requested serial, then run devices.',
    DEVICE_BUSY: 'Close the other HapTest process that owns this device.',
    ACTION_PRECONDITION_FAILED: 'Observe the current screen; unlock the device directly if it is locked.',
    STALE_OBSERVATION: 'Observe the current screen again and retry with the new observation.',
    INPUT_FOCUS_REQUIRED: 'Tap the intended ordinary editable field, then run type.',
    SENSITIVE_FIELD: 'Enter authentication data directly on the device.',
};

type Flags = Record<string, string | true>;

interface ParsedArgs {
    flags: Flags;
    positionals: string[];
}

function parseArgs(args: string[]): ParsedArgs {
    const flags: Flags = {};
    const positionals: string[] = [];
    for (let index = 0; index < args.length; index++) {
        const arg = args[index];
        if (!arg.startsWith('--')) {
            positionals.push(arg);
            continue;
        }
        const name = arg.slice(2);
        const next = args[index + 1];
        if (next === undefined || next.startsWith('--')) {
            flags[name] = true;
        } else {
            flags[name] = next;
            index++;
        }
    }
    return { flags, positionals };
}

function ok(value: unknown): CliResult {
    return { exitCode: 0, stdout: `${JSON.stringify(value)}\n`, stderr: '' };
}

function usage(message: string): CliResult {
    return { exitCode: 2, stdout: `${JSON.stringify({ ok: false, errorCode: 'USAGE', message })}\n`, stderr: `${message}\n${USAGE}\n` };
}

function fail(error: unknown): CliResult {
    if (!(error instanceof HarmonyDeviceError)) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 1, stdout: `${JSON.stringify({ ok: false, errorCode: 'INTERNAL_ERROR', message })}\n`, stderr: `${message}\n` };
    }
    const nextStep = NEXT_STEP[error.code];
    const payload = {
        ok: false,
        errorCode: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
        ...(nextStep ? { nextStep } : {}),
    };
    const help = error.code === 'HDC_UNAVAILABLE' ? `${HDC_HELP}\n` : `${error.message}${nextStep ? `\n${nextStep}` : ''}\n`;
    return {
        exitCode: PRECONDITION_CODES.has(error.code) ? 3 : 1,
        stdout: `${JSON.stringify(payload)}\n`,
        stderr: help,
    };
}

function serialFlag(flags: Flags): string | undefined {
    const serial = flags.serial;
    return typeof serial === 'string' ? serial : undefined;
}

function stringFlag(flags: Flags, name: string): string | undefined {
    const value = flags[name];
    return typeof value === 'string' ? value : undefined;
}

async function withDevice<T>(deps: HarmonyCliDeps, flags: Flags, run: (device: HarmonyDevice) => Promise<T>): Promise<T> {
    const device = await deps.connect({ serial: serialFlag(flags) });
    try {
        return await run(device);
    } finally {
        await device.close();
    }
}

function summarizeObservation(observation: HarmonyObservation, screenshotPath?: string) {
    return {
        observationId: observation.observationId,
        observedAt: observation.observedAt,
        serial: observation.serial,
        width: observation.width,
        height: observation.height,
        coordinateSpace: observation.coordinateSpace,
        ...(observation.bundleName ? { bundleName: observation.bundleName } : {}),
        locked: observation.locked,
        ...(observation.tree ? { contentSig: observation.tree.getContentSig(), tree: observation.tree.toJson() } : {}),
        ...(observation.screenshot ? {
            screenshot: {
                mimeType: observation.screenshot.mimeType,
                width: observation.screenshot.width,
                height: observation.screenshot.height,
                pixelToDeviceScale: observation.screenshot.pixelToDeviceScale,
                ...(screenshotPath ? { path: screenshotPath } : {}),
            },
        } : {}),
    };
}

export async function runHarmonyCli(argv: string[], deps: HarmonyCliDeps = defaultDeps): Promise<CliResult> {
    const [command, ...rest] = argv;
    const { flags } = parseArgs(rest);
    try {
        switch (command) {
            case 'doctor': {
                const report = deps.doctor({ serial: serialFlag(flags) });
                const result = ok({ ok: true, ...report });
                return report.issues.length > 0 ? { ...result, exitCode: 3 } : result;
            }
            case 'devices':
                return ok({ ok: true, devices: deps.devices() });
            case 'observe':
                return await withDevice(deps, flags, async (device) => {
                    const screenshotPath = stringFlag(flags, 'screenshot');
                    const observation = await device.observe({ screenshot: screenshotPath !== undefined });
                    if (screenshotPath && observation.screenshot) {
                        fs.writeFileSync(screenshotPath, observation.screenshot.data);
                    }
                    return ok({ ok: true, observation: summarizeObservation(observation, screenshotPath) });
                });
            case 'apps':
                return await withDevice(deps, flags, async (device) =>
                    ok({ ok: true, apps: device.findApps(stringFlag(flags, 'query') ?? '') }));
            default:
                return usage(command ? `unknown command: ${command}` : 'a command is required');
        }
    } catch (error) {
        return fail(error);
    }
}
