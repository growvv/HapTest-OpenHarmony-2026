import { FrameOptions, readFrameDatabase, writeFrameReport } from '../device/perf/frame_report';
import { CliResult } from './harmony_command';

export async function runPerfCli(argv: string[]): Promise<CliResult> {
    try {
        if (argv[0] !== 'analyze') throw new Error('usage: haptest perf analyze --db <trace.db> --output <dir> [--refresh-rate 60] [--ipid n] [--type <type_desc>] [--jank-flags 1,2]');
        const flags: Record<string, string> = {};
        const allowed = ['db', 'output', 'refresh-rate', 'ipid', 'type', 'jank-flags', 'start-ns', 'end-ns'];
        for (let i = 1; i < argv.length; i += 2) {
            const name = argv[i].replace(/^--/, '');
            if (!argv[i].startsWith('--') || !allowed.includes(name) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error(`Invalid option: ${argv[i]}`);
            flags[name] = argv[i + 1];
        }
        if (!flags.db || !flags.output) throw new Error('--db and --output are required.');
        const numeric = (name: string) => {
            if (flags[name] === undefined) return undefined;
            const value = Number(flags[name]);
            if (!Number.isFinite(value)) throw new Error(`--${name} must be numeric.`);
            return value;
        };
        const options: FrameOptions = { refreshRate: numeric('refresh-rate'), processId: numeric('ipid'), typeDesc: flags.type,
            startNs: numeric('start-ns'), endNs: numeric('end-ns') };
        if (flags['jank-flags'] !== undefined) {
            if (!/^-?\d+(,-?\d+)*$/.test(flags['jank-flags'])) throw new Error('--jank-flags requires comma-separated integer flags.');
            options.jankFlags = flags['jank-flags'].split(',').map(Number);
        }
        if (options.startNs !== undefined && options.endNs !== undefined && options.startNs >= options.endNs) throw new Error('start-ns must be less than end-ns.');
        const report = await readFrameDatabase(flags.db, options);
        writeFrameReport(report, flags.output);
        return { exitCode: report.frameCount ? 0 : 3, stdout: JSON.stringify({ ok: Boolean(report.frameCount), output: flags.output,
            status: report.status, frameCount: report.frameCount, overBudgetCount: report.overBudgetCount, p95DurationMs: report.p95DurationMs }) + '\n', stderr: report.frameCount ? '' : 'No valid frames matched. Check trace categories, process and frame type.\n' };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { exitCode: 2, stdout: JSON.stringify({ ok: false, errorCode: 'PERF_ANALYSIS_FAILED', message }) + '\n', stderr: message + '\n' };
    }
}
