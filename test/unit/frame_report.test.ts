import fs from 'fs';
import os from 'os';
import path from 'path';
import initSqlJs from 'sql.js';
import { describe, expect, it } from 'vitest';
import { readFrameDatabase, writeFrameReport } from '../../src/device/perf/frame_report';
import { runPerfCli } from '../../src/cli/perf_command';

describe('frame report', () => {
    it('reads real SQLite, filters frame types, and separates budget from explicit system flags', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-frame-'));
        try {
            const SQL = await initSqlJs();
            const db = new SQL.Database();
            db.run('CREATE TABLE frame_slice(id INT,ts INT,dur INT,ipid INT,type_desc TEXT,flag INT,frame_no INT)');
            db.run("INSERT INTO frame_slice VALUES(1,1000000000,10000000,10,'app',0,1),(2,1020000000,25000000,10,'app',7,2),(3,1040000000,-1,10,'app',0,3),(4,1000000000,90000000,20,'render',7,4)");
            const file = path.join(directory, 'fixture.db'); fs.writeFileSync(file, db.export()); db.close();
            const report = await readFrameDatabase(file, { processId: 10, typeDesc: 'app', refreshRate: 60 });
            expect(report.frameCount).toBe(2); expect(report.invalidFrameCount).toBe(1);
            expect(report.overBudgetCount).toBe(1); expect(report.p95DurationMs).toBe(25);
            expect(report.systemJankCount).toBeNull();
            const mapped = await readFrameDatabase(file, { processId: 10, jankFlags: [7] });
            expect(mapped.systemJankCount).toBe(1);
            writeFrameReport(mapped, directory);
            expect(JSON.parse(fs.readFileSync(path.join(directory, 'frames.json'), 'utf8')).frameCount).toBe(2);
            expect(fs.readFileSync(path.join(directory, 'frames.csv'), 'utf8')).toContain('"25"');
            expect(fs.readFileSync(path.join(directory, 'frames.html'), 'utf8')).toContain('class="slow"');
            const empty = await runPerfCli(['analyze', '--db', file, '--output', path.join(directory, 'empty'), '--ipid', '999']);
            expect(empty.exitCode).toBe(3); expect(JSON.parse(empty.stdout).status).toBe('no_frames');
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
    it('rejects missing schema rather than reporting zero jank', async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haptest-schema-'));
        try {
            const SQL = await initSqlJs(); const db = new SQL.Database();
            const file = path.join(directory, 'bad.db'); fs.writeFileSync(file, db.export()); db.close();
            await expect(readFrameDatabase(file)).rejects.toThrow('columns');
            const cli = await runPerfCli(['analyze', '--db', file, '--output', directory]);
            expect(cli.exitCode).toBe(2); expect(cli.stderr).toContain('columns');
        } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
});
