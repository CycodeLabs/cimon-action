// Release selection shared by the agent action (src/main) and the attest
// action (attest/). Both bundle this file with ncc.

import { httpStatus, withRetry } from './retry.js';

// A cimon-releases tag: v1.0.28, or a pre-release such as
// v1.0.30-rc-windows-1. The leading "v" is optional in the input. The
// pattern also keeps the value safe to place in a download URL.
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export const CIMON_RELEASES_URL =
    'https://github.com/CycodeLabs/cimon-releases/releases';

export const CIMON_RELEASES_API =
    'https://api.github.com/repos/CycodeLabs/cimon-releases/releases';

// ConfigError marks a mistake in the release selection: a version that is
// not a release tag, does not exist, or is set together with release-path.
// Both actions fail the step on it even with fail-on-error: false, which
// only covers errors at run time (network, the agent itself), so a typo can
// never leave the step green with Cimon not running.
export class ConfigError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ConfigError';
    }
}

export function isConfigError(error) {
    return Boolean(error) && error.name === 'ConfigError';
}

// parseVersion turns the `version` input into a cimon-releases tag. An empty
// input or "latest" returns '' (install the latest release). Anything that is
// not a release tag throws, so a typo fails the step instead of silently
// installing the latest release.
export function parseVersion(input) {
    const value = (input || '').trim();
    if (value === '' || value.toLowerCase() === 'latest') {
        return '';
    }
    if (!TAG_PATTERN.test(value)) {
        throw new ConfigError(
            `Invalid version "${value}". Use a tag from ${CIMON_RELEASES_URL} ` +
                `(for example v1.0.28), or "latest".`
        );
    }
    return value.startsWith('v') ? value : `v${value}`;
}

// resolveRelease reads the release-path and version inputs together and
// returns { releasePath, version }, where version is a normalized tag or ''
// for the latest release. The two inputs select the binary in different ways,
// so setting both is an error rather than a silent precedence rule. That
// includes `version: latest`, which asks for a download as much as a tag does.
export function resolveRelease(releasePathInput, versionInput) {
    const releasePath = (releasePathInput || '').trim();
    const version = parseVersion(versionInput);
    const versionSet = (versionInput || '').trim() !== '';
    if (releasePath !== '' && versionSet) {
        throw new ConfigError(
            'Set either release-path or version, not both. release-path runs ' +
                'a binary already on the runner; version downloads that release.'
        );
    }
    return { releasePath, version };
}

// A stable v1 tag: v1.x.y with no pre-release suffix.
const STABLE_V1_TAG = /^v1\.\d+\.\d+$/;

// pickLatestV1 returns the first stable v1 tag in a page of the GitHub
// releases API (newest first), or ''. "Latest" is not taken from GitHub's
// /releases/latest, because v0 releases are still published from the v0
// line and GitHub marks the newest one as latest.
export function pickLatestV1(releases) {
    for (const release of releases || []) {
        if (
            release &&
            !release.draft &&
            typeof release.tag_name === 'string' &&
            STABLE_V1_TAG.test(release.tag_name)
        ) {
            return release.tag_name;
        }
    }
    return '';
}

// apiTokenFor returns githubToken when it is a github.com token, and ''
// otherwise. On GitHub Enterprise Server (or GHE.com) the token belongs to
// that instance and api.github.com would reject it. serverUrl is the
// workflow's GITHUB_SERVER_URL.
export function apiTokenFor(githubToken, serverUrl) {
    if (!githubToken) {
        return '';
    }
    let host;
    try {
        host = new URL(serverUrl || 'https://github.com').hostname;
    } catch (error) {
        return '';
    }
    return host === 'github.com' ? githubToken : '';
}

// latestV1Tag looks up the newest stable v1 release on api.github.com (see
// pickLatestV1 for why GitHub's own "latest" is not used).
//
//   getJson(url, headers): @actions/http-client's getJson. It resolves to
//     { result } and throws an error carrying statusCode on an HTTP error.
//   token: from apiTokenFor. With a token the lookup gets the job's own rate
//     limit; without one it shares the anonymous limit of the runner's IP
//     address, which hosted and busy self-hosted runners can run out of.
//   log, warn: for retries and a token GitHub rejects.
//
// Each request is retried on rate limits, server errors and network
// failures (see withRetry). A token GitHub rejects (401) is dropped and the
// lookup carries on without it, so an expired token cannot stop the install.
export async function latestV1Tag({
    getJson,
    token = '',
    log = () => {},
    warn = () => {},
    delays,
    sleep,
}) {
    let headers = withToken(token);
    for (let page = 1; page <= 5; page++) {
        const url = `${CIMON_RELEASES_API}?per_page=100&page=${page}`;
        const get = () =>
            withRetry(() => getReleases(getJson, url, headers), {
                what: 'Looking up the latest cimon release',
                log,
                delays,
                sleep,
            });
        let releases;
        try {
            releases = await get();
        } catch (error) {
            if (httpStatus(error) !== 401 || !headers.Authorization) {
                throw error;
            }
            warn(
                'GitHub rejected the github-token input (HTTP 401); looking up ' +
                    'the latest cimon release without it.'
            );
            headers = withToken('');
            releases = await get();
        }
        if (!Array.isArray(releases) || releases.length === 0) {
            break;
        }
        const tag = pickLatestV1(releases);
        if (tag) {
            return tag;
        }
    }
    throw new Error(`No v1.x release found at ${CIMON_RELEASES_URL}`);
}

function withToken(token) {
    const headers = { 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) {
        headers.Authorization = `Bearer ${token}`;
    }
    return headers;
}

// getReleases fetches one page of the releases API. A failure names the URL
// and the HTTP status, which GitHub's error body leaves out.
async function getReleases(getJson, url, headers) {
    try {
        const response = await getJson(url, headers);
        return response.result;
    } catch (error) {
        const status = httpStatus(error);
        const wrapped = new Error(
            status
                ? `HTTP ${status} from ${url}: ${error.message}`
                : `${url}: ${error.message}`
        );
        wrapped.statusCode = status;
        throw wrapped;
    }
}
