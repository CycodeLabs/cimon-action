// Verified install of a cimon release. The release asset is checked against
// the release's checksums.txt, and checksums.txt against Cycode's cosign
// signature, before anything is extracted or run.
//
// This file uses Node built-ins only: attest/ bundles it without the root
// node_modules, so callers pass in the download, run and extract functions.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { CIMON_RELEASES_URL, ConfigError } from './release.js';

// Cycode's release signing key (the same key as cosign.pub at the root of
// this repository). It ships inside the action, never with the release, so a
// replaced release asset cannot bring its own key.
export const CIMON_COSIGN_PUBLIC_KEY = [
    '-----BEGIN PUBLIC KEY-----',
    'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEm1mmcCICdlB5j78efKNbPK8Q0UeO',
    'rDH1UNxhD2ibPuzUDV3OzpL8wVtTnWW1jLGMi7fKiZPfP+pB2BpdUPaMSg==',
    '-----END PUBLIC KEY-----',
    '',
].join('\n');

export const COSIGN_VERSION = 'v2.2.1';

// SHA256 of each cosign binary, from cosign_checksums.txt in the cosign
// v2.2.1 release. The verifier is checked before it runs.
export const COSIGN_SHA256 = {
    'cosign-linux-amd64':
        'f6c24066e7f75221c4b7f309b8322d7d42a1d96470e0440e6e357fe43661d81f',
    'cosign-linux-arm64':
        '8c04e9877fb6e3a96a3916d4dfa855a493c418ace5d5ec4dba6a249490f888d1',
    'cosign-darwin-amd64':
        'f1a948cded75e0858e739d90604e2a7e4d2f3fda15bfef12c0c03726567443bc',
    'cosign-darwin-arm64':
        'a9ca33020c41ad245ec595c7097c9280e29e5afdd95ab19359a65d6e1a756777',
    'cosign-windows-amd64.exe':
        '88eea88aff14bc42cc00b9212b4cee7a20779836731bf83768cc1d9006cf386d',
};

const RELEASE_OS = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
const RELEASE_ARCH = { x64: 'x86_64', arm64: 'arm64' };
const GO_ARCH = { x64: 'amd64', arm64: 'arm64' };

// releaseAsset names the cimon release asset for a Node platform and arch.
// Windows releases are x86_64 only, which Windows on Arm runs under
// emulation.
export function releaseAsset(platform, arch) {
    const os = RELEASE_OS[platform];
    if (os === 'windows') {
        return {
            name: 'cimon_windows_x86_64.zip',
            kind: 'zip',
            binary: 'cimon.exe',
        };
    }
    const releaseArch = RELEASE_ARCH[arch];
    if (!os || !releaseArch) {
        throw new Error(`No cimon release is published for ${platform}/${arch}.`);
    }
    return {
        name: `cimon_${os}_${releaseArch}.tar.gz`,
        kind: 'tar',
        binary: 'cimon',
    };
}

// cosignAsset names the cosign release binary for a Node platform and arch.
export function cosignAsset(platform, arch) {
    const os = RELEASE_OS[platform];
    if (os === 'windows') {
        return 'cosign-windows-amd64.exe';
    }
    const goArch = GO_ARCH[arch];
    if (!os || !goArch) {
        throw new Error(`No cosign binary is pinned for ${platform}/${arch}.`);
    }
    return `cosign-${os}-${goArch}`;
}

export function sha256File(file) {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('sha256');
        fs.createReadStream(file)
            .on('error', reject)
            .on('data', (chunk) => hash.update(chunk))
            .on('end', () => resolve(hash.digest('hex')));
    });
}

// checksumFor returns the SHA256 that a checksums.txt lists for name, or ''
// when there is no entry. The file name must match exactly.
export function checksumFor(checksumsText, name) {
    for (const line of checksumsText.split(/\r?\n/)) {
        const match = line.trim().match(/^([0-9a-fA-F]{64})\s+\*?(\S+)$/);
        if (match && match[2] === name) {
            return match[1].toLowerCase();
        }
    }
    return '';
}

function notFound(error) {
    return error && error.httpStatusCode === 404;
}

async function installCosign({ platform, arch, workDir, download, cosignSha256, log }) {
    const name = cosignAsset(platform, arch);
    const expected = cosignSha256[name];
    if (!expected) {
        throw new Error(`No SHA256 is pinned for ${name}.`);
    }
    const file = path.join(workDir, name);
    log(`Downloading cosign ${COSIGN_VERSION} (${name})`);
    await download(
        `https://github.com/sigstore/cosign/releases/download/${COSIGN_VERSION}/${name}`,
        file
    );
    const actual = await sha256File(file);
    if (actual !== expected) {
        throw new Error(
            `SHA256 mismatch for ${name} ${COSIGN_VERSION}: expected ` +
                `${expected}, got ${actual}. Refusing to run it.`
        );
    }
    if (platform !== 'win32') {
        fs.chmodSync(file, 0o755);
    }
    return file;
}

// cosignVerifyEnv is the environment for `cosign verify-blob --key`. cosign
// 2.2 loads the certificate transparency log keys whenever a key is given,
// from Sigstore's TUF repository unless SIGSTORE_CT_LOG_PUBLIC_KEY_FILE names
// a file to read them from. Those keys check the timestamps of keyless
// certificates and play no part in verifying a signature made with a key, so
// the key being checked stands in for them. The check then needs no network,
// which matters on runners that cannot reach tuf-repo-cdn.sigstore.dev, such
// as one where the Cimon agent's prevent mode does not allow it.
export function cosignVerifyEnv(keyPath, env = process.env) {
    return { ...env, SIGSTORE_CT_LOG_PUBLIC_KEY_FILE: keyPath };
}

// installRelease downloads cimon release `tag` into workDir, verifies it, and
// returns the path of the extracted binary. Any failed check throws before
// the archive is extracted.
//
//   download(url, destPath): resolves once the file is written; rejects with
//     an error carrying httpStatusCode on an HTTP error.
//   run(command, args, options): resolves to the exit code; options.env is
//     the environment to run the command with.
//   extract(archivePath, destDir, kind): kind is 'zip' or 'tar' (gzip).
//
// With pinned set (the tag came from the version input), a release without
// the asset is a ConfigError.
export async function installRelease({
    tag,
    pinned = false,
    workDir,
    download,
    run,
    extract,
    platform = process.platform,
    arch = process.arch,
    log = () => {},
    cosignSha256 = COSIGN_SHA256,
}) {
    const asset = releaseAsset(platform, arch);
    const base = `${CIMON_RELEASES_URL}/download/${tag}`;
    fs.mkdirSync(workDir, { recursive: true });
    const assetPath = path.join(workDir, asset.name);
    const checksumsPath = path.join(workDir, 'checksums.txt');
    const signaturePath = path.join(workDir, 'checksums.txt.sig');

    log(`Downloading cimon ${tag} (${asset.name})`);
    try {
        await download(`${base}/${asset.name}`, assetPath);
    } catch (error) {
        if (notFound(error)) {
            const Kind = pinned ? ConfigError : Error;
            throw new Kind(
                `cimon ${tag} has no ${asset.name}. Check that ${tag} is a ` +
                    `published release with that asset at ${CIMON_RELEASES_URL}.`
            );
        }
        throw error;
    }
    await download(`${base}/checksums.txt`, checksumsPath);
    try {
        await download(`${base}/checksums.txt.sig`, signaturePath);
    } catch (error) {
        if (notFound(error)) {
            throw new Error(
                `cimon ${tag} has no checksums.txt.sig, so it cannot be ` +
                    `verified. Refusing to run it.`
            );
        }
        throw error;
    }

    const cosign = await installCosign({
        platform,
        arch,
        workDir,
        download,
        cosignSha256,
        log,
    });
    const keyPath = path.join(workDir, 'cimon-cosign.pub');
    fs.writeFileSync(keyPath, CIMON_COSIGN_PUBLIC_KEY);

    // Release signatures are not in a transparency log, hence
    // --insecure-ignore-tlog; the key is what is being checked.
    log('Verifying the cosign signature on checksums.txt');
    const code = await run(
        cosign,
        [
            'verify-blob',
            '--key',
            keyPath,
            '--signature',
            signaturePath,
            '--insecure-ignore-tlog',
            checksumsPath,
        ],
        { env: cosignVerifyEnv(keyPath) }
    );
    if (code !== 0) {
        throw new Error(
            `Signature check failed for cimon ${tag}: checksums.txt is not ` +
                `signed by Cycode's release key. Refusing to run it.`
        );
    }

    const expected = checksumFor(fs.readFileSync(checksumsPath, 'utf8'), asset.name);
    if (!expected) {
        throw new Error(`checksums.txt for cimon ${tag} has no entry for ${asset.name}.`);
    }
    const actual = await sha256File(assetPath);
    if (actual !== expected) {
        throw new Error(
            `SHA256 mismatch for ${asset.name} in cimon ${tag}: expected ` +
                `${expected}, got ${actual}. Refusing to run it.`
        );
    }
    log(`Verified cimon ${tag}: signed checksums, SHA256 ${actual}`);

    const binDir = path.join(workDir, 'cimon');
    fs.rmSync(binDir, { recursive: true, force: true });
    fs.mkdirSync(binDir, { recursive: true });
    await extract(assetPath, binDir, asset.kind);
    const binary = path.join(binDir, asset.binary);
    if (!fs.existsSync(binary)) {
        throw new Error(`${asset.binary} not found in ${asset.name} for cimon ${tag}.`);
    }
    if (platform !== 'win32') {
        fs.chmodSync(binary, 0o755);
    }
    return binary;
}
