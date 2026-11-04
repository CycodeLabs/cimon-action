// Release selection shared by the agent action (src/main) and the attest
// action (attest/). Both bundle this file with ncc.

// A cimon-releases tag: v1.0.28, or a pre-release such as
// v1.0.30-rc-windows-1. The leading "v" is optional in the input. The
// pattern also keeps the value safe to place in a download URL and to pass
// as an install.sh argument.
const TAG_PATTERN = /^v?\d+\.\d+\.\d+(-[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

export const CIMON_RELEASES_URL =
    'https://github.com/CycodeLabs/cimon-releases/releases';

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
        throw new Error(
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
        throw new Error(
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
