import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConfigError } from './release.js';
import { httpStatus, isRetryable, rateLimitWait, withRetry } from './retry.js';

function httpError(status, field = 'httpStatusCode') {
    const error = new Error(`HTTP ${status}`);
    error[field] = status;
    return error;
}

describe('httpStatus', () => {
    it('reads the status from downloads and from lookup errors', () => {
        assert.equal(httpStatus(httpError(429)), 429);
        assert.equal(httpStatus(httpError(503, 'statusCode')), 503);
        assert.equal(httpStatus(new Error('socket hang up')), 0);
        assert.equal(httpStatus(undefined), 0);
    });
});

describe('rateLimitWait', () => {
    const now = 1_000_000_000_000;

    it('uses retry-after, in seconds or as a date', () => {
        assert.equal(rateLimitWait(429, { 'retry-after': '30' }, '', now), 30000);
        assert.equal(rateLimitWait(403, { 'retry-after': '0' }, '', now), 0);
        const date = new Date(now + 45000).toUTCString();
        assert.equal(rateLimitWait(429, { 'retry-after': date }, '', now), 45000);
    });

    it('waits past the reset when the limit is used up', () => {
        const headers = {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(now / 1000 + 90),
        };
        assert.equal(rateLimitWait(403, headers, '', now), 91000);
    });

    it('waits a minute for a rate limit that names no time', () => {
        assert.equal(rateLimitWait(429, {}, '', now), 60000);
        assert.equal(
            rateLimitWait(403, {}, 'You have exceeded a secondary rate limit', now),
            60000
        );
    });

    it('is not a rate limit for other responses', () => {
        assert.equal(rateLimitWait(403, {}, 'Resource not accessible', now), -1);
        assert.equal(rateLimitWait(403, { 'x-ratelimit-remaining': '12' }, '', now), -1);
        assert.equal(rateLimitWait(404, { 'retry-after': '30' }, '', now), -1);
        assert.equal(rateLimitWait(503, {}, '', now), -1);
    });
});

describe('isRetryable', () => {
    it('retries rate limits, timeouts and server errors', () => {
        for (const status of [408, 429, 500, 502, 503, 504]) {
            assert.equal(isRetryable(httpError(status)), true, `HTTP ${status}`);
        }
        const limited = httpError(403);
        limited.retryAfterMs = 60000;
        assert.equal(isRetryable(limited), true);
    });

    it('retries network failures', () => {
        const error = new Error('connect ECONNRESET');
        error.code = 'ECONNRESET';
        assert.equal(isRetryable(error), true);
        assert.equal(isRetryable(new Error('Request timeout: /x')), true);
    });

    it('does not retry other HTTP errors or input mistakes', () => {
        for (const status of [400, 401, 403, 404, 410, 422]) {
            assert.equal(isRetryable(httpError(status)), false, `HTTP ${status}`);
        }
        assert.equal(isRetryable(new ConfigError('bad version')), false);
    });
});

describe('withRetry', () => {
    const noSleep = async () => {};

    it('returns the first success without retrying', async () => {
        let calls = 0;
        const result = await withRetry(async () => {
            calls++;
            return 'ok';
        }, { what: 'x', sleep: noSleep });
        assert.equal(result, 'ok');
        assert.equal(calls, 1);
    });

    it('retries a retryable failure and logs its status', async () => {
        const failures = [httpError(429), httpError(502)];
        const slept = [];
        const logged = [];
        const result = await withRetry(
            async () => {
                const failure = failures.shift();
                if (failure) {
                    throw failure;
                }
                return 'v1.0.29';
            },
            {
                what: 'Lookup',
                log: (message) => logged.push(message),
                delays: [1000, 2000, 3000],
                sleep: async (ms) => slept.push(ms),
            }
        );
        assert.equal(result, 'v1.0.29');
        assert.deepEqual(slept, [1000, 2000]);
        assert.equal(logged.length, 2);
        assert.match(logged[0], /Lookup failed \(HTTP 429\); retrying in 1s \(attempt 2 of 4\)/);
        assert.match(logged[1], /HTTP 502/);
    });

    it('throws the last error once the attempts run out', async () => {
        let calls = 0;
        await assert.rejects(
            withRetry(
                async () => {
                    calls++;
                    throw httpError(503);
                },
                { what: 'x', delays: [1, 1], sleep: noSleep }
            ),
            /HTTP 503/
        );
        assert.equal(calls, 3);
    });

    it('waits as long as a rate-limited response asks', async () => {
        const slept = [];
        let calls = 0;
        await withRetry(
            async () => {
                calls++;
                if (calls === 1) {
                    const error = httpError(429);
                    error.retryAfterMs = 45000;
                    throw error;
                }
                return 'ok';
            },
            { what: 'x', delays: [1000], sleep: async (ms) => slept.push(ms) }
        );
        assert.deepEqual(slept, [45000]);
    });

    it('stops when a rate limit asks for longer than the action waits', async () => {
        let calls = 0;
        await assert.rejects(
            withRetry(
                async () => {
                    calls++;
                    const error = httpError(403);
                    error.retryAfterMs = 30 * 60 * 1000;
                    throw error;
                },
                { what: 'x', sleep: async () => {} }
            ),
            /HTTP 403 \(rate-limited: GitHub asks to wait 30 min, longer than the 2 min this action waits\)/
        );
        assert.equal(calls, 1);
    });

    it('does not retry an error that will not change', async () => {
        let calls = 0;
        await assert.rejects(
            withRetry(
                async () => {
                    calls++;
                    throw httpError(404);
                },
                { what: 'x', sleep: noSleep }
            ),
            /HTTP 404/
        );
        assert.equal(calls, 1);
    });
});
