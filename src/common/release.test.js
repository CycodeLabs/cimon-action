import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, resolveRelease } from './release.js';

describe('parseVersion', () => {
    it('treats empty and latest as the latest release', () => {
        for (const input of [undefined, '', '  ', 'latest', 'LATEST', ' latest ']) {
            assert.equal(parseVersion(input), '', `input ${JSON.stringify(input)}`);
        }
    });

    it('accepts release tags with or without the leading v', () => {
        assert.equal(parseVersion('v1.0.28'), 'v1.0.28');
        assert.equal(parseVersion('1.0.28'), 'v1.0.28');
        assert.equal(parseVersion(' v1.0.28 '), 'v1.0.28');
        assert.equal(parseVersion('v0.10.1'), 'v0.10.1');
    });

    it('accepts pre-release tags', () => {
        assert.equal(parseVersion('v1.0.30-rc-windows-1'), 'v1.0.30-rc-windows-1');
        assert.equal(parseVersion('1.0.16-rc.2'), 'v1.0.16-rc.2');
    });

    it('rejects anything that is not a release tag', () => {
        for (const input of [
            'v1',
            'v1.0',
            '1.0.x',
            'vv1.0.28',
            'v1.0.28-',
            'v1.0.28-/x',
            'v1.0.28/../../evil',
            'v1.0.28 v1.0.27',
            'v1.0.28;id',
            '$(id)',
            'main',
        ]) {
            assert.throws(() => parseVersion(input), /Invalid version/, `input ${input}`);
        }
    });
});

describe('resolveRelease', () => {
    it('returns the latest release when neither input is set', () => {
        assert.deepEqual(resolveRelease('', ''), { releasePath: '', version: '' });
    });

    it('returns the normalized version', () => {
        assert.deepEqual(resolveRelease('', '1.0.28'), { releasePath: '', version: 'v1.0.28' });
    });

    it('returns the release path', () => {
        assert.deepEqual(resolveRelease('/opt/cimon/cimon', ''), {
            releasePath: '/opt/cimon/cimon',
            version: '',
        });
        assert.deepEqual(resolveRelease('/opt/cimon/cimon', 'latest'), {
            releasePath: '/opt/cimon/cimon',
            version: '',
        });
    });

    it('rejects release-path together with a version', () => {
        assert.throws(
            () => resolveRelease('C:\\Tools\\cimon\\cimon.exe', 'v1.0.28'),
            /either release-path or version/
        );
    });
});
