'use strict';

class E2eRunner {
    constructor(device) {
        this.device = device;
        this.results = [];
    }

    async step(name, run) {
        const started = Date.now();
        const value = await run();
        const ms = Date.now() - started;
        this.results.push({ name, ms });
        console.log(`PASS  ${name}  ${ms}ms`);
        return value;
    }

    observe(name = 'observe') {
        return this.step(name, () => this.device.observe());
    }

    report() {
        const total = this.results.reduce((sum, item) => sum + item.ms, 0);
        console.log('\nstep                              ms');
        for (const item of this.results) console.log(`${item.name.padEnd(32)}${item.ms}`);
        console.log(`${'TOTAL'.padEnd(32)}${total}`);
    }
}

function requireSerial() {
    const serial = process.env.HAPTEST_E2E_SERIAL;
    if (!serial) {
        console.log('SKIPPED: set HAPTEST_E2E_SERIAL to the target device serial.');
        console.log('Find it with: hdc list targets');
        process.exit(0);
    }
    return serial;
}

module.exports = { E2eRunner, requireSerial };
