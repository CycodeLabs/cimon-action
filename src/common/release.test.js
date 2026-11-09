import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    apiTokenFor,
    CIMON_RELEASES_API,
    isConfigError,
    latestV1Tag,
    parseVersion,
    pickLatestV1,
    resolveRelease,
} from './release.js';

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

describe('apiTokenFor', () => {
    it('uses the token on github.com', () => {
        assert.equal(apiTokenFor('ghs_x', 'https://github.com'), 'ghs_x');
        assert.equal(apiTokenFor('ghs_x', undefined), 'ghs_x');
        assert.equal(apiTokenFor('ghs_x', ''), 'ghs_x');
    });

    it('drops a token from another GitHub instance', () => {
        assert.equal(apiTokenFor('ghs_x', 'https://ghes.example.com'), '');
        assert.equal(apiTokenFor('ghs_x', 'https://acme.ghe.com'), '');
        assert.equal(apiTokenFor('ghs_x', 'not a url'), '');
    });

    it('returns empty without a token', () => {
        assert.equal(apiTokenFor('', 'https://github.com'), '');
        assert.equal(apiTokenFor(undefined, 'https://github.com'), '');
    });
});

describe('latestV1Tag', () => {
    const noSleep = async () => {};
    const page1 = [
        { tag_name: 'v1.0.30-rc-windows-2', draft: false },
        { tag_name: 'v1.0.29', draft: false },
    ];

    function httpError(status) {
        const error = new Error('API rate limit exceeded');
        error.statusCode = status;
        return error;
    }

    it('sends the token and returns the newest stable v1 tag', async () => {
        const calls = [];
        const tag = await latestV1Tag({
            getJson: async (url, headers) => {
                calls.push({ url, headers });
                return { result: page1 };
            },
            token: 'ghs_x',
            sleep: noSleep,
        });
        assert.equal(tag, 'v1.0.29');
        assert.equal(calls.length, 1);
        assert.equal(calls[0].url, `${CIMON_RELEASES_API}?per_page=100&page=1`);
        assert.equal(calls[0].headers.Authorization, 'Bearer ghs_x');
    });

    it('sends no Authorization header without a token', async () => {
        let sent;
        await latestV1Tag({
            getJson: async (url, headers) => {
                sent = headers;
                return { result: page1 };
            },
            sleep: noSleep,
        });
        assert.equal(sent.Authorization, undefined);
    });

    it('retries a rate limit and logs the status', async () => {
        const logged = [];
        let calls = 0;
        const tag = await latestV1Tag({
            getJson: async () => {
                calls++;
                if (calls === 1) {
                    throw httpError(429);
                }
                return { result: page1 };
            },
            log: (message) => logged.push(message),
            sleep: noSleep,
        });
        assert.equal(tag, 'v1.0.29');
        assert.equal(calls, 2);
        assert.match(logged[0], /HTTP 429 from https:\/\/api\.github\.com/);
    });

    it('names the status when the attempts run out', async () => {
        await assert.rejects(
            latestV1Tag({
                getJson: async () => {
                    throw httpError(403);
                },
                delays: [1, 1],
                sleep: noSleep,
            }),
            (error) => error.statusCode === 403 && /HTTP 403 from/.test(error.message)
        );
    });

    it('drops a token GitHub rejects and carries on without it', async () => {
        const warned = [];
        const sent = [];
        const tag = await latestV1Tag({
            getJson: async (url, headers) => {
                sent.push(headers.Authorization);
                if (headers.Authorization) {
                    throw httpError(401);
                }
                return { result: page1 };
            },
            token: 'expired',
            warn: (message) => warned.push(message),
            sleep: noSleep,
        });
        assert.equal(tag, 'v1.0.29');
        assert.deepEqual(sent, ['Bearer expired', undefined]);
        assert.equal(warned.length, 1);
    });

    it('fails on a 401 without a token', async () => {
        await assert.rejects(
            latestV1Tag({
                getJson: async () => {
                    throw httpError(401);
                },
                sleep: noSleep,
            }),
            /HTTP 401/
        );
    });

    it('pages until it finds a stable v1 release', async () => {
        const pages = {
            1: [{ tag_name: 'v1.0.30-rc-windows-2', draft: false }],
            2: [{ tag_name: 'v1.0.29', draft: false }],
        };
        const tag = await latestV1Tag({
            getJson: async (url) => ({
                result: pages[new URL(url).searchParams.get('page')] || [],
            }),
            sleep: noSleep,
        });
        assert.equal(tag, 'v1.0.29');
    });

    it('fails when there is no v1 release', async () => {
        await assert.rejects(
            latestV1Tag({
                getJson: async () => ({ result: [] }),
                sleep: noSleep,
            }),
            /No v1.x release found/
        );
    });
});
