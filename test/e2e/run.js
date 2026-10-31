'use strict';

// Exercises the built package (lib/), the same artifact a consumer loads.
const { HarmonyDevice } = require('../../lib');
const { E2eRunner, requireSerial } = require('./harness');

async function main() {
    const serial = requireSerial();
    const device = await HarmonyDevice.connect({ serial });
    const runner = new E2eRunner(device);
    try {
        const first = await runner.observe('observe(tree)');
        if (first.locked) throw new Error('Device is locked; unlock it and rerun.');

        await runner.step('apps(list)', async () => {
            const apps = device.findApps();
            if (apps.length < 10) throw new Error(`Unexpectedly small app catalog: ${apps.length}`);
            return apps.length;
        });

        const target = process.env.HAPTEST_E2E_BUNDLE ?? 'com.huawei.hmos.settings';
        await runner.step(`launch_app(${target})`, () => device.launchApp(target));

        const afterLaunch = await runner.observe('observe(after launch)');
        if (afterLaunch.bundleName !== target) {
            throw new Error(`Foreground is ${afterLaunch.bundleName}, expected ${target}`);
        }

        const search = afterLaunch.tree?.getComponents()
            .find((component) => component.type === 'SearchField' && component.bounds && component.id);
        if (search?.id) {
            await runner.step('tap(search field)', () => device.tap({ selector: { id: search.id } }));
        } else {
            console.log('SKIP  tap(search field)  no uniquely identified SearchField on this screen');
        }

        await runner.step('press_key(BACK)', () => device.pressKey('BACK'));
        await runner.observe('observe(final)');
        runner.report();
    } finally {
        await device.close();
    }
}

void main().catch((error) => {
    console.error('E2E FAILED:', error instanceof Error ? error.message : error);
    process.exit(1);
});
