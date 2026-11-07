import fs from 'fs';
import path from 'path';
import initSqlJs from 'sql.js';

export interface FrameRow {
    id: number; ts: number; dur: number; ipid: number; type_desc: string; flag: number; frame_no: number;
}
export interface FrameOptions {
    refreshRate?: number;
    processId?: number;
    typeDesc?: string;
    startNs?: number;
    endNs?: number;
    jankFlags?: number[];
}

export function summarizeFrames(rows: FrameRow[], options: FrameOptions = {}) {
    const refreshRate = options.refreshRate ?? 60;
    if (!Number.isFinite(refreshRate) || refreshRate < 1 || refreshRate > 1000) throw new Error('refreshRate must be between 1 and 1000 Hz.');
    const budgetMs = 1000 / refreshRate;
    const filtered = rows.filter(row => (options.processId === undefined || row.ipid === options.processId) &&
        (options.typeDesc === undefined || row.type_desc === options.typeDesc) &&
        (options.startNs === undefined || row.ts >= options.startNs) && (options.endNs === undefined || row.ts < options.endNs));
    const valid = filtered.filter(row => Number.isSafeInteger(row.ts) && row.ts >= 0 && Number.isSafeInteger(row.dur) && row.dur >= 0);
    const values = valid.map(row => row.dur / 1e6).sort((a, b) => a - b);
    const percentile = (fraction: number) => values.length ? values[Math.max(0, Math.ceil(values.length * fraction) - 1)] : null;
    const flagSet = options.jankFlags === undefined ? undefined : new Set(options.jankFlags);
    const frames = valid.sort((a, b) => a.ts - b.ts || a.id - b.id).map(row => ({ ...row,
        durationMs: row.dur / 1e6, overBudget: row.dur / 1e6 > budgetMs,
        systemJank: flagSet ? flagSet.has(row.flag) : null }));
    const overBudgetCount = frames.filter(row => row.overBudget).length;
    return {
        schemaVersion: 1, refreshRate, budgetMs, filters: options,
        status: frames.length ? 'ok' : 'no_frames', frameCount: frames.length,
        invalidFrameCount: filtered.length - frames.length,
        overBudgetCount, overBudgetRatio: frames.length ? overBudgetCount / frames.length : null,
        meanDurationMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
        p50DurationMs: percentile(0.5), p95DurationMs: percentile(0.95), maxDurationMs: values.length ? values[values.length - 1] : null,
        systemJankCount: flagSet ? frames.filter(row => row.systemJank).length : null,
        observedFlags: [...new Set(valid.map(row => row.flag))].sort((a, b) => a - b),
        observedTypes: [...new Set(valid.map(row => row.type_desc))].sort(),
        interpretation: 'overBudget compares slice duration with 1000/refreshRate. It is not an FPS measurement or a universal system-jank classification. Filter by process and frame type to avoid mixing app and RenderService slices. System flags require a version-specific explicit mapping.',
        frames,
    };
}

export async function readFrameDatabase(file: string, options: FrameOptions = {}) {
    const SQL = await initSqlJs({ locateFile: name => path.join(path.dirname(require.resolve('sql.js')), name) });
    const database = new SQL.Database(fs.readFileSync(file));
    try {
        const columns = database.exec('PRAGMA table_info(frame_slice)')[0]?.values.map(row => String(row[1])) ?? [];
        const required = ['id', 'ts', 'dur', 'ipid', 'type_desc', 'flag', 'frame_no'];
        if (!required.every(column => columns.includes(column))) throw new Error('Unsupported trace database: frame_slice columns are missing.');
        const result = database.exec('SELECT id,ts,dur,ipid,type_desc,flag,frame_no FROM frame_slice');
        const numeric = (value: unknown) => typeof value === 'number' ? value : NaN;
        const rows = (result[0]?.values ?? []).map(row => ({ id: numeric(row[0]), ts: numeric(row[1]), dur: numeric(row[2]),
            ipid: Number(row[3]), type_desc: String(row[4] ?? ''), flag: Number(row[5]), frame_no: Number(row[6]) }));
        return summarizeFrames(rows, options);
    } finally { database.close(); }
}

export type FrameReport = ReturnType<typeof summarizeFrames>;
const escapeHtml = (value: unknown) => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]!));
const csv = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
export function writeFrameReport(report: FrameReport, output: string): void {
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, 'frames.json'), JSON.stringify(report, null, 2));
    const columns = ['id', 'ts', 'durationMs', 'ipid', 'type_desc', 'flag', 'frame_no', 'overBudget', 'systemJank'] as const;
    fs.writeFileSync(path.join(output, 'frames.csv'), '\ufeff' + [columns.join(','), ...report.frames.map(row => columns.map(key => csv(row[key])).join(','))].join('\n'));
    const rows = report.frames.slice(0, 10000).map(row => `<tr${row.overBudget ? ' class="slow"' : ''}>${columns.map(key => `<td>${escapeHtml(row[key] ?? '未映射')}</td>`).join('')}</tr>`).join('');
    fs.writeFileSync(path.join(output, 'frames.html'), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HapTest 逐帧耗时报告</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;color:#172334}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #ccd7df;text-align:left}.slow{background:#fff0e7}p{line-height:1.7}</style><h1>HapTest 逐帧耗时报告</h1><p>帧数 ${report.frameCount}，刷新率 ${report.refreshRate} Hz，预算 ${report.budgetMs.toFixed(3)} ms。超预算 ${report.overBudgetCount} 帧。P95 ${report.p95DurationMs?.toFixed(3) ?? '无数据'} ms。</p><p>${escapeHtml(report.interpretation)}</p><p>HTML 最多展示 10000 行，完整记录见 JSON / CSV。橙色表示耗时超预算。空帧表不代表无卡顿。</p><table><thead><tr>${columns.map(key => `<th>${key}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></html>`);
}
