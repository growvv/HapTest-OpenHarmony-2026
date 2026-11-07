import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { FrameOptions, readFrameDatabase, summarizeFrames, writeFrameReport } from './frame_report';

const execute = promisify(execFile);
async function hdc(serial: string, args: string[]) {
    const result = await execute('hdc', ['-t', serial, ...args], { timeout: 30000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    if (/\b(error|failed|permission denied|not found)\b/i.test(result.stdout + result.stderr)) throw new Error(`HDC trace operation failed: ${(result.stdout + result.stderr).trim()}`);
}

export interface TraceCaptureDependencies {
    hdc(serial: string, args: string[]): Promise<void>;
    convert(executable: string, trace: string, database: string): Promise<void>;
}
const defaults: TraceCaptureDependencies = {
    hdc,
    convert: async (executable, trace, database) => {
        await execute(executable, [trace, '-e', database], { timeout: 120000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    },
};

/** Stops tracing in finally even when the measured action fails. Never replays actions. */
export async function captureTrace<T>(serial: string, output: string, action: () => Promise<T>, options: FrameOptions & { traceStreamer?: string } = {}, deps: TraceCaptureDependencies = defaults) {
    summarizeFrames([], options); // Validate the budget before tracing or executing an action.
    fs.mkdirSync(output, { recursive: true });
    const token = `${Date.now()}-${randomBytes(4).toString('hex')}`;
    const remote = `/data/local/tmp/haptest-${token}.htrace`;
    const localTrace = path.resolve(output, `trace-${token}.htrace`);
    const database = path.resolve(output, `trace-${token}.db`);
    await deps.hdc(serial, ['shell', 'hitrace', '--trace_begin', 'graphic', 'ability', 'app']);
    let result: T | undefined;
    let actionError: unknown;
    let captureError: unknown;
    try { result = await action(); } catch (error) { actionError = error; }
    finally {
        try {
            await deps.hdc(serial, ['shell', 'hitrace', '--trace_finish', '-o', remote]);
            await deps.hdc(serial, ['file', 'recv', remote, localTrace]);
        } catch (error) { captureError = error; }
        // Only the unique file created by this capture is removed from the device.
        await deps.hdc(serial, ['shell', 'rm', '-f', remote]).catch(() => {});
    }
    const metadata = { serial, trace: localTrace, database: options.traceStreamer ? database : null,
        actionOutcome: actionError ? 'uncertain_or_failed' : 'completed', captureOutcome: captureError ? 'failed' : 'completed' };
    fs.writeFileSync(path.join(output, 'capture.json'), JSON.stringify(metadata, null, 2));
    if (actionError) throw actionError;
    if (captureError) throw captureError;
    if (options.traceStreamer) {
        await deps.convert(options.traceStreamer, localTrace, database);
        const report = await readFrameDatabase(database, options);
        writeFrameReport(report, output);
        return { result, ...metadata, report: { status: report.status, frameCount: report.frameCount, overBudgetCount: report.overBudgetCount } };
    }
    return { result, ...metadata, nextStep: 'Convert the trace using trace_streamer <trace> -e <database>, then run haptest perf analyze.' };
}
