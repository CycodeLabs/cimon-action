import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isConfigError, parseVersion, pickLatestV1, resolveRelease } from './release.js';

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
        assert.deepEqual(resolveRelease('/opt/cimon/cimon', '  '), {
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

    it('rejects release-path together with version: latest', () => {
        for (const latest of ['latest', 'LATEST']) {
            assert.throws(
                () => resolveRelease('/opt/cimon/cimon', latest),
                /either release-path or version/
            );
        }
    });
});

describe('pickLatestV1', () => {
    it('returns the newest stable v1 tag', () => {
        assert.equal(
            pickLatestV1([
                { tag_name: 'v1.0.30-rc-windows-1', prerelease: true },
                { tag_name: 'v0.12.5' },
                { tag_name: 'v1.0.29', draft: true },
                { tag_name: 'v1.0.28' },
                { tag_name: 'v1.0.27' },
            ]),
            'v1.0.28'
        );
    });

    it('returns empty when the page has no stable v1 tag', () => {
        assert.equal(pickLatestV1([{ tag_name: 'v0.12.4' }, { tag_name: 'v1.0.30-rc1' }]), '');
        assert.equal(pickLatestV1([]), '');
        assert.equal(pickLatestV1(null), '');
    });
});

describe('ConfigError', () => {
    it('marks input mistakes so they fail the step', () => {
        for (const bad of [() => parseVersion('v1.0'), () => resolveRelease('/opt/cimon/cimon', 'latest')]) {
            let caught;
            try {
                bad();
            } catch (error) {
                caught = error;
            }
            assert.ok(isConfigError(caught), String(caught));
        }
        assert.equal(isConfigError(new Error('network')), false);
        assert.equal(isConfigError(undefined), false);
    });
});
