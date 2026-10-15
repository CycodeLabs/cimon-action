import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import path from 'node:path';

// Execute the action entry point with isolated runner/CLI/artifact boundaries.
// No downloads, signing services, credentials or workflow uploads are used.
async function runAction(inputs) {
    const uploads = [];
    const commands = [];
    const outputs = {};
    const failures = [];
    const defaults = {
        'release-path': '/fixture/cimon',
        subjects: 'dist/my-binary',
        'provenance-output': 'provenance.intoto.jsonl',
        'signed-provenance-output': 'provenance.intoto.jsonl.sig',
    };
    const values = { ...defaults, ...inputs };
    const core = {
        getInput: (name) => values[name] ?? '',
        getBooleanInput: (name) => values[name] === 'true',
        info() {},
        warning() {},
        addPath() {},
        exportVariable() {},
        setOutput: (name, value) => { outputs[name] = value; },
        setFailed: (message) => { failures.push(message); },
    };
    const dependencies = {
        '@actions/core': { default: core },
        '@actions/exec': { default: { async exec(command, args) {
            commands.push({ command, args });
            return 0;
        } } },
        '@actions/tool-cache': { default: {} },
        '@actions/artifact': { DefaultArtifactClient: class {
            async uploadArtifact(name, files, root, options) {
                uploads.push({ name, files, root, options });
                return { id: uploads.length, size: 1 };
            }
        } },
        '@actions/http-client': { HttpClient: class {} },
        path: { default: path },
        fs: { default: { existsSync: (file) => file === '/fixture/cimon' } },
        os: { default: { tmpdir: () => '/fixture/tmp' } },
    };
    const context = vm.createContext({ process: {
        platform: 'linux',
        env: { RUNNER_TEMP: '/fixture/tmp', GITHUB_JOB: 'fixture' },
    }, Math });
    const action = new vm.SourceTextModule(
        await readFile(new URL('./index.js', import.meta.url), 'utf8'),
        { context },
    );
    await action.link((specifier) => {
        const exports = dependencies[specifier];
        assert.ok(exports, `Unexpected dependency: ${specifier}`);
        return new vm.SyntheticModule(Object.keys(exports), function () {
            for (const [name, value] of Object.entries(exports)) {
                this.setExport(name, value);
            }
        }, { context });
    });
    await action.evaluate();
    assert.deepEqual(failures, []);
    assert.equal(outputs['cimon-path'], '/fixture/cimon');
    assert.equal(commands.length, 1);
    return { uploads, args: commands[0].args };
}

test('uploads unsigned and signed provenance for keyless signing', async () => {
    const { uploads, args } = await runAction({
        keyless: 'true', 'report-artifact': 'true',
        'allow-submit-data-to-public-sigstore': 'true',
    });
    assert.ok(args.includes('--keyless'));
    assert.equal(uploads.length, 2);
    assert.equal(uploads[0].files[0], 'provenance.intoto.jsonl');
    assert.equal(uploads[1].files[0], 'provenance.intoto.jsonl.sig');
});

test('preserves uploads for key-based signing and custom output paths', async () => {
    const { uploads, args } = await runAction({
        'sign-key': 'private-key.pem', 'report-artifact': 'true',
        'provenance-output': 'out/prov.jsonl',
        'signed-provenance-output': 'out/prov.sig',
    });
    assert.ok(args.includes('--key'));
    assert.equal(uploads.length, 2);
    assert.equal(uploads[1].files[0], 'out/prov.sig');
    assert.equal(uploads[1].root, 'out');
});

test('unsigned generation does not upload a nonexistent signature', async () => {
    const { uploads } = await runAction({ 'report-artifact': 'true' });
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].files[0], 'provenance.intoto.jsonl');
});

test('report-artifact false disables uploads for keyless signing', async () => {
    const { uploads } = await runAction({ keyless: 'true', 'report-artifact': 'false' });
    assert.equal(uploads.length, 0);
});
