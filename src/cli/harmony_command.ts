import fs from 'fs';
import { doctorHarmonyDevices, HarmonyDoctorReport } from '../device/harmony/doctor';
import { HarmonyDeviceError, HarmonyDeviceErrorCode } from '../device/harmony/errors';
import { HarmonyDevice, HarmonyObservation } from '../device/harmony/session';
import { HarmonySelector } from '../device/harmony/selectors';
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
    '  observe   read the current tree and optional screenshot',
    '  apps      list installed bundles, optionally filtered',
    '  tap       tap a selector or physical point',
    '  type      type text into the focused field',
    '  key       press a navigation or editing key',
    '  swipe     swipe between two physical points',
    '  launch    launch an installed bundle',
    '  stop      force-stop an installed bundle',
    '  serve     stay connected and answer JSON-lines requests',
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

const ALLOWED_FLAGS: Readonly<Record<string, readonly string[]>> = {
    doctor: ['serial'],
    devices: [],
    observe: ['serial', 'screenshot'],
    apps: ['serial', 'query'],
    tap: ['serial', 'id', 'text', 'text-contains', 'hint', 'name', 'index', 'x', 'y', 'expect-bundle', 'expect-sig'],
    type: ['serial', 'allow-newlines', 'expect-bundle', 'expect-sig'],
    key: ['serial', 'expect-bundle', 'expect-sig'],
    swipe: ['serial', 'from', 'to', 'speed', 'expect-bundle', 'expect-sig'],
    launch: ['serial', 'expect-bundle', 'expect-sig'],
    stop: ['serial', 'expect-bundle', 'expect-sig'],
    serve: ['serial'],
};

const POSITIONAL_ARITY: Readonly<Record<string, number>> = { type: 1, key: 1, launch: 1, stop: 1 };

type Flags = Record<string, string | true>;

interface ParsedArgs {
    flags: Flags;
    positionals: string[];
}

class CliUsageError extends Error {}

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

function numberFlag(flags: Flags, name: string): number | undefined {
    const raw = flags[name];
    if (raw === undefined) return undefined;
    if (typeof raw !== 'string' || !/^-?\d+$/.test(raw)) throw new CliUsageError(`--${name} requires an integer`);
    return Number(raw);
}

function pointFlag(flags: Flags, name: string): { x: number; y: number } {
    const match = stringFlag(flags, name)?.match(/^(-?\d+),(-?\d+)$/);
    if (!match) throw new CliUsageError(`--${name} requires <x>,<y>`);
    return { x: Number(match[1]), y: Number(match[2]) };
}

function selectorFrom(flags: Flags): HarmonySelector | undefined {
    const selector: HarmonySelector = {};
    const id = stringFlag(flags, 'id');
    const text = stringFlag(flags, 'text');
    const textContains = stringFlag(flags, 'text-contains');
    const hint = stringFlag(flags, 'hint');
    const name = stringFlag(flags, 'name');
    if (id !== undefined) selector.id = id;
    if (text !== undefined) selector.text = text;
    if (textContains !== undefined) selector.textContains = textContains;
    if (hint !== undefined) selector.hint = hint;
    if (name !== undefined) selector.name = name;
    return Object.keys(selector).length > 0 ? selector : undefined;
}

function assertExpectation(observation: HarmonyObservation, flags: Flags): void {
    const expectedBundle = stringFlag(flags, 'expect-bundle');
    if (expectedBundle && observation.bundleName !== expectedBundle) {
        throw new HarmonyDeviceError('STALE_OBSERVATION', 'The foreground app does not match --expect-bundle.', {
            expected: expectedBundle,
            actual: observation.bundleName,
        });
    }
    const expectedSig = stringFlag(flags, 'expect-sig');
    if (expectedSig && observation.tree?.getContentSig() !== expectedSig) {
        throw new HarmonyDeviceError('STALE_OBSERVATION', 'The screen changed since the observation you passed.', {
            expected: expectedSig,
            actual: observation.tree?.getContentSig(),
        });
    }
}

export function summarizeObservation(observation: HarmonyObservation, screenshotPath?: string) {
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

async function withDevice<T>(deps: HarmonyCliDeps, flags: Flags, run: (device: HarmonyDevice) => Promise<T>): Promise<T> {
    const device = await deps.connect({ serial: serialFlag(flags) });
    try {
        return await run(device);
    } finally {
        await device.close().catch(() => {});
    }
}

/** Re-reads the screen after an action so the caller can chain the next command without a separate observe. */
async function actedResult(device: HarmonyDevice, result: unknown): Promise<CliResult> {
    return ok({ ok: true, result, observation: summarizeObservation(await device.observe()) });
}

function validateArgs(command: string | undefined, flags: Flags, positionals: string[]): void {
    if (!command || !(command in ALLOWED_FLAGS)) return;
    const allowed = ALLOWED_FLAGS[command];
    for (const name of Object.keys(flags)) {
        if (!allowed.includes(name)) throw new CliUsageError(`unknown flag: --${name}`);
    }
    const expected = POSITIONAL_ARITY[command] ?? 0;
    if (positionals.length > expected) throw new CliUsageError(`unexpected argument: ${positionals[expected]}`);
    if (positionals.length < expected) throw new CliUsageError(`${command} expects ${expected} argument(s)`);
}

export async function runHarmonyCli(argv: string[], deps: HarmonyCliDeps = defaultDeps): Promise<CliResult> {
    const [command, ...rest] = argv;
    try {
        const { flags, positionals } = parseArgs(rest);
        validateArgs(command, flags, positionals);
        switch (command) {
            case 'doctor': {
                const report = deps.doctor({ serial: serialFlag(flags) });
                if (report.issues.length > 0) {
                    return {
                        exitCode: 3,
                        stdout: `${JSON.stringify({ ok: false, errorCode: 'DEVICE_NOT_READY', ...report })}\n`,
                        stderr: `${report.issues.join('\n')}\n`,
                    };
                }
                return ok({ ok: true, ...report });
            }
            case 'devices': {
                try {
                    return ok({ ok: true, devices: deps.devices() });
                } catch (error) {
                    throw new HarmonyDeviceError('HDC_UNAVAILABLE', 'HDC could not enumerate HarmonyOS devices.', undefined, error);
                }
            }
            case 'observe':
                return await withDevice(deps, flags, async (device) => {
                    const screenshotPath = stringFlag(flags, 'screenshot');
                    const observation = await device.observe({ screenshot: screenshotPath !== undefined });
                    if (screenshotPath && observation.screenshot) {
                        fs.writeFileSync(screenshotPath, observation.screenshot.data);
                    }
                    const result = ok({ ok: true, observation: summarizeObservation(observation, screenshotPath) });
                    if (screenshotPath && !observation.screenshot) result.stderr = 'screenshot skipped: the device is locked\n';
                    return result;
                });
            case 'apps':
                return await withDevice(deps, flags, async (device) =>
                    ok({ ok: true, apps: device.findApps(stringFlag(flags, 'query') ?? '') }));
            case 'tap': {
                const selector = selectorFrom(flags);
                const x = numberFlag(flags, 'x');
                const y = numberFlag(flags, 'y');
                const hasPoint = x !== undefined || y !== undefined;
                const index = numberFlag(flags, 'index');
                if (index !== undefined && !selector) throw new CliUsageError('--index requires a selector');
                if (Boolean(selector) === hasPoint) throw new CliUsageError('provide either selector flags or --x/--y, not both');
                if (hasPoint && (x === undefined || y === undefined)) throw new CliUsageError('--x and --y are required together');
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    const result = selector
                        ? await device.tap({ selector, index })
                        : await device.tap({ x, y, observationId: before.observationId });
                    return actedResult(device, result);
                });
            }
            case 'type': {
                const text = positionals[0];
                const allowNewlines = flags['allow-newlines'] === true;
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    return actedResult(device, await device.typeText(text, { allowNewlines }));
                });
            }
            case 'key': {
                const key = positionals[0].toUpperCase();
                if (!KEY_NAMES.includes(key as KeyName)) throw new CliUsageError(`unsupported key: ${key}`);
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    return actedResult(device, await device.pressKey(key as KeyName));
                });
            }
            case 'swipe': {
                const from = pointFlag(flags, 'from');
                const to = pointFlag(flags, 'to');
                const speed = numberFlag(flags, 'speed');
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    return actedResult(device, await device.swipe({ from, to, observationId: before.observationId, speed }));
                });
            }
            case 'launch': {
                const bundleName = positionals[0];
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    return actedResult(device, await device.launchApp(bundleName));
                });
            }
            case 'stop': {
                const bundleName = positionals[0];
                return await withDevice(deps, flags, async (device) => {
                    const before = await device.observe();
                    assertExpectation(before, flags);
                    return actedResult(device, await device.stopApp(bundleName));
                });
            }
            case 'serve': {
                const { runHarmonyServe } = await import('./harmony_serve');
                await runHarmonyServe({ serial: serialFlag(flags) });
                return { exitCode: 0, stdout: '', stderr: '' };
            }
            default:
                return usage(command ? `unknown command: ${command}` : 'a command is required');
        }
    } catch (error) {
        if (error instanceof CliUsageError) return usage(error.message);
        if (error instanceof HarmonyDeviceError && error.code === 'SELECTOR_INDEX_OUT_OF_RANGE') return usage(error.message);
        return fail(error);
    }
}

const KEY_NAMES = ['BACK', 'HOME', 'ENTER', 'DELETE', 'SPACE', 'TAB', 'ESCAPE', 'UP', 'DOWN', 'LEFT', 'RIGHT'] as const;
type KeyName = typeof KEY_NAMES[number];
