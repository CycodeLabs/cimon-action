import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { isConfigError } from './release.js';
import {
    checksumFor,
    cosignAsset,
    cosignVerifyEnv,
    installRelease,
    releaseAsset,
} from './install.js';

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

describe('releaseAsset', () => {
    it('names the asset for each supported runner', () => {
        assert.equal(releaseAsset('linux', 'x64').name, 'cimon_linux_x86_64.tar.gz');
        assert.equal(releaseAsset('linux', 'arm64').name, 'cimon_linux_arm64.tar.gz');
        assert.equal(releaseAsset('darwin', 'arm64').name, 'cimon_darwin_arm64.tar.gz');
        assert.equal(releaseAsset('darwin', 'x64').name, 'cimon_darwin_x86_64.tar.gz');
        assert.deepEqual(releaseAsset('win32', 'x64'), {
            name: 'cimon_windows_x86_64.zip',
            kind: 'zip',
            binary: 'cimon.exe',
        });
        assert.equal(releaseAsset('win32', 'arm64').name, 'cimon_windows_x86_64.zip');
    });

    it('rejects unsupported runners', () => {
        assert.throws(() => releaseAsset('freebsd', 'x64'), /No cimon release/);
        assert.throws(() => releaseAsset('linux', 'ia32'), /No cimon release/);
    });
});

describe('cosignAsset', () => {
    it('names the cosign binary for each supported runner', () => {
        assert.equal(cosignAsset('linux', 'x64'), 'cosign-linux-amd64');
        assert.equal(cosignAsset('darwin', 'arm64'), 'cosign-darwin-arm64');
        assert.equal(cosignAsset('win32', 'arm64'), 'cosign-windows-amd64.exe');
    });
});

describe('cosignVerifyEnv', () => {
    it('adds the CT log key file and keeps the given environment', () => {
        const env = cosignVerifyEnv('/k.pub', { PATH: '/bin', HOME: '/h' });
        assert.deepEqual(env, { PATH: '/bin', HOME: '/h', SIGSTORE_CT_LOG_PUBLIC_KEY_FILE: '/k.pub' });
    });
});

describe('checksumFor', () => {
    const text = [
        `${'a'.repeat(64)}  cimon_linux_x86_64.tar.gz`,
        `${'B'.repeat(64)}  cimon_windows_x86_64.zip`,
        `${'c'.repeat(64)} *cimon_darwin_arm64.tar.gz`,
        '',
    ].join('\r\n');

    it('returns the hash listed for the exact file name', () => {
        assert.equal(checksumFor(text, 'cimon_linux_x86_64.tar.gz'), 'a'.repeat(64));
        assert.equal(checksumFor(text, 'cimon_windows_x86_64.zip'), 'b'.repeat(64));
        assert.equal(checksumFor(text, 'cimon_darwin_arm64.tar.gz'), 'c'.repeat(64));
    });

    it('does not match a name that only contains the file name', () => {
        assert.equal(checksumFor(text, 'cimon_linux_x86_64.tar'), '');
        assert.equal(checksumFor(`${'a'.repeat(64)}  evil-cimon_linux_x86_64.tar.gz`, 'cimon_linux_x86_64.tar.gz'), '');
    });
});

describe('installRelease', () => {
    const TAG = 'v1.0.28';
    const ASSET = 'cimon_darwin_arm64.tar.gz';
    const COSIGN = 'cosign-darwin-arm64';
    let workDir;
    let files;
    let calls;

    beforeEach(() => {
        workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cimon-install-test-'));
        files = {
            [ASSET]: 'archive-bytes',
            'checksums.txt': `${sha('archive-bytes')}  ${ASSET}\n`,
            'checksums.txt.sig': 'signature',
            [COSIGN]: 'cosign-bytes',
        };
        calls = [];
    });

    afterEach(() => fs.rmSync(workDir, { recursive: true, force: true }));

    function options(overrides = {}) {
        return {
            tag: TAG,
            workDir,
            platform: 'darwin',
            arch: 'arm64',
            cosignSha256: { [COSIGN]: sha('cosign-bytes') },
            download: async (url, dest) => {
                calls.push(url);
                const name = url.split('/').pop();
                if (!(name in files)) {
                    const error = new Error('Not Found');
                    error.httpStatusCode = 404;
                    throw error;
                }
                fs.writeFileSync(dest, files[name]);
            },
            run: async (command, args) => {
                calls.push(['run', path.basename(command), ...args.map((a) => path.basename(a))]);
                return 0;
            },
            extract: async (archive, dest, kind) => {
                calls.push(['extract', path.basename(archive), kind]);
                fs.writeFileSync(path.join(dest, 'cimon'), 'binary');
            },
            ...overrides,
        };
    }

    it('verifies, then extracts, and returns the binary', async () => {
        const binary = await installRelease(options());
        assert.equal(binary, path.join(workDir, 'cimon', 'cimon'));
        assert.equal(fs.statSync(binary).mode & 0o111, 0o111);
        assert.deepEqual(calls, [
            `https://github.com/CycodeLabs/cimon-releases/releases/download/${TAG}/${ASSET}`,
            `https://github.com/CycodeLabs/cimon-releases/releases/download/${TAG}/checksums.txt`,
            `https://github.com/CycodeLabs/cimon-releases/releases/download/${TAG}/checksums.txt.sig`,
            `https://github.com/sigstore/cosign/releases/download/v2.2.1/${COSIGN}`,
            ['run', COSIGN, 'verify-blob', '--key', 'cimon-cosign.pub', '--signature',
                'checksums.txt.sig', '--insecure-ignore-tlog', 'checksums.txt'],
            ['extract', ASSET, 'tar'],
        ]);
    });

    it('runs cosign with the key as its CT log key, so it needs no network', async () => {
        let env;
        await installRelease(options({
            run: async (command, args, opts = {}) => {
                env = opts.env;
                return 0;
            },
        }));
        assert.ok(env, 'cosign gets an environment');
        assert.equal(env.SIGSTORE_CT_LOG_PUBLIC_KEY_FILE, path.join(workDir, 'cimon-cosign.pub'));
        assert.equal(env.PATH, process.env.PATH, 'the rest of the environment is kept');
    });

    it('refuses a release whose signature does not verify', async () => {
        await assert.rejects(
            installRelease(options({ run: async () => 1 })),
            /Signature check failed for cimon v1.0.28/
        );
        assert.ok(!fs.existsSync(path.join(workDir, 'cimon', 'cimon')));
    });

    it('refuses an asset that does not match checksums.txt', async () => {
        files[ASSET] = 'tampered-bytes';
        await assert.rejects(installRelease(options()), /SHA256 mismatch for cimon_darwin_arm64/);
        assert.ok(!calls.some((c) => Array.isArray(c) && c[0] === 'extract'));
    });

    it('refuses a checksums.txt without an entry for the asset', async () => {
        files['checksums.txt'] = `${sha('archive-bytes')}  other.tar.gz\n`;
        await assert.rejects(installRelease(options()), /no entry for cimon_darwin_arm64/);
    });

    it('refuses a cosign binary that does not match its pinned hash', async () => {
        files[COSIGN] = 'other-cosign';
        await assert.rejects(installRelease(options()), /SHA256 mismatch for cosign-darwin-arm64/);
        assert.ok(!calls.some((c) => Array.isArray(c) && c[0] === 'run'));
    });

    it('refuses an unsigned release', async () => {
        delete files['checksums.txt.sig'];
        await assert.rejects(installRelease(options()), /no checksums.txt.sig/);
    });

    it('explains a missing asset', async () => {
        delete files[ASSET];
        await assert.rejects(installRelease(options()), (error) => {
            assert.match(error.message, /cimon v1.0.28 has no cimon_darwin_arm64.tar.gz/);
            assert.equal(isConfigError(error), false);
            return true;
        });
    });

    it('treats a missing asset for a pinned version as an input mistake', async () => {
        delete files[ASSET];
        await assert.rejects(installRelease(options({ pinned: true })), (error) => {
            assert.ok(isConfigError(error));
            return true;
        });
    });

    it('installs cimon.exe on Windows', async () => {
        files['cimon_windows_x86_64.zip'] = 'zip-bytes';
        files['checksums.txt'] = `${sha('zip-bytes')}  cimon_windows_x86_64.zip\n`;
        files['cosign-windows-amd64.exe'] = 'cosign-bytes';
        const binary = await installRelease(options({
            platform: 'win32',
            arch: 'x64',
            cosignSha256: { 'cosign-windows-amd64.exe': sha('cosign-bytes') },
            extract: async (archive, dest, kind) => {
                assert.equal(kind, 'zip');
                fs.writeFileSync(path.join(dest, 'cimon.exe'), 'binary');
            },
        }));
        assert.equal(path.basename(binary), 'cimon.exe');
    });
});
