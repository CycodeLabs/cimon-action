/**
 * Pure helpers for parsing and displaying SBOM results in the
 * GitHub Actions job summary.  Extracted so they can be unit-tested
 * independently of the @actions/* runtime.
 */

/**
 * Parses SBOM file entries from cimon agent stop output.
 * Each JSON log line that contains `"SBOM files written"` is expected
 * to carry `cyclonedx` and/or `spdx` path fields, and optionally
 * `components`, `relationships`, and `artifacts` counts.
 *
 * @param {string} output - Combined stdout+stderr from `cimon agent stop`.
 * @returns {Array<{cyclonedx: string, spdx: string, components: number, relationships: number, artifacts: number}>}
 */
export function parseSBOMEntries(output) {
    const entries = [];
    for (const line of output.split('\n')) {
        if (!line.includes('"SBOM files written"')) continue;
        try {
            const parsed = JSON.parse(line);
            if (parsed.cyclonedx || parsed.spdx) {
                entries.push({
                    cyclonedx: parsed.cyclonedx || '',
                    spdx: parsed.spdx || '',
                    components: parsed.components || 0,
                    relationships: parsed.relationships || 0,
                    artifacts: parsed.artifacts || 0,
                });
            }
        } catch {
            // Not valid JSON, skip.
        }
    }
    return entries;
}

/**
 * Checks whether the cimon stop output indicates that SBOM generation
 * was enabled (i.e. the feature was active, regardless of whether any
 * SBOMs were actually produced).
 *
 * @param {string} output - Combined stdout+stderr from `cimon agent stop`.
 * @returns {boolean}
 */
export function isSBOMEnabled(output) {
    // The SBOM feature logs at least one of these markers when active.
    return (
        output.includes('"SBOM files written"') ||
        output.includes('"SBOM generation"') ||
        output.includes('CIMON_SBOM_ENABLED')
    );
}

/**
 * Filters SBOM entries to only those with meaningful content
 * (at least 1 component or artifact).  Entries from CMake TryCompile
 * scratch directories and FetchContent subbuild-only sessions are
 * typically empty or contain a single synthetic component and should
 * be omitted from the summary.
 *
 * @param {Array<{cyclonedx: string, spdx: string, components: number, relationships: number, artifacts: number}>} entries
 * @returns {Array<{cyclonedx: string, spdx: string, components: number, relationships: number, artifacts: number}>}
 */
export function filterMeaningfulEntries(entries) {
    return entries.filter(
        (e) => e.components > 1 || e.relationships > 0 || e.artifacts > 0
    );
}

/**
 * Builds a GitHub Actions job summary with SBOM results.
 * Handles three scenarios:
 *   1. SBOMs generated   -> table with details per SBOM
 *   2. SBOM enabled but none generated -> informational notice
 *   3. SBOM not enabled  -> no summary (silent)
 *
 * Only entries with meaningful content are shown in the table.
 * The overview line reports the count of meaningful SBOMs.
 *
 * @param {import('@actions/core')} core - The @actions/core module.
 * @param {Array<{cyclonedx: string, spdx: string, components: number, relationships: number, artifacts: number}>} sbomEntries
 * @param {{sbomEnabled: boolean}} options
 */
export async function writeSBOMSummary(core, sbomEntries, options = {}) {
    const { sbomEnabled = false } = options;

    // Case 3: SBOM not enabled — nothing to report.
    if (sbomEntries.length === 0 && !sbomEnabled) return;

    // Case 2: SBOM was enabled but produced no output.
    if (sbomEntries.length === 0 && sbomEnabled) {
        await core.summary
            .addHeading('Cimon SBOM Report', 2)
            .addRaw(
                'SBOM generation was enabled but no SBOMs were produced. ' +
                    'This can happen when no build artifacts (executables or libraries) were detected during the build.\n'
            )
            .write();
        return;
    }

    // Filter out noise (TryCompile, empty subbuilds, etc.)
    const meaningful = filterMeaningfulEntries(sbomEntries);

    // If all entries were noise, show a notice instead.
    if (meaningful.length === 0 && sbomEnabled) {
        await core.summary
            .addHeading('Cimon SBOM Report', 2)
            .addRaw(
                'SBOM generation was enabled but no SBOMs with meaningful content were produced. ' +
                    `${sbomEntries.length} build session${sbomEntries.length !== 1 ? 's were' : ' was'} detected but ` +
                    'contained no components (e.g. CMake feature-detection tests or download-only sub-builds).\n'
            )
            .write();
        return;
    }

    // Case 1: SBOMs generated — build a rich summary.
    const totalComponents = meaningful.reduce(
        (sum, e) => sum + e.components,
        0
    );
    const totalRelationships = meaningful.reduce(
        (sum, e) => sum + e.relationships,
        0
    );

    // Overview line (uses HTML since addRaw renders HTML, not markdown).
    const parts = [
        `<strong>${meaningful.length}</strong> SBOM${meaningful.length > 1 ? 's' : ''} generated during build`,
    ];
    if (totalComponents > 0) {
        parts.push(
            `covering <strong>${totalComponents}</strong> component${totalComponents > 1 ? 's' : ''}` +
                ` and <strong>${totalRelationships}</strong> relationship${totalRelationships !== 1 ? 's' : ''}`
        );
    }
    // Note skipped entries if any were filtered out.
    const skipped = sbomEntries.length - meaningful.length;
    if (skipped > 0) {
        parts.push(
            `${skipped} empty build session${skipped !== 1 ? 's' : ''} omitted`
        );
    }

    // Detail table: one row per meaningful SBOM entry.
    const hasStats = totalComponents > 0;
    const header = hasStats
        ? ['#', 'CycloneDX', 'SPDX', 'Components', 'Relationships']
        : ['#', 'CycloneDX', 'SPDX'];

    const rows = [header];
    for (let i = 0; i < meaningful.length; i++) {
        const entry = meaningful[i];
        const row = [
            `${i + 1}`,
            entry.cyclonedx ? `<code>${entry.cyclonedx}</code>` : '-',
            entry.spdx ? `<code>${entry.spdx}</code>` : '-',
        ];
        if (hasStats) {
            row.push(`${entry.components}`);
            row.push(`${entry.relationships}`);
        }
        rows.push(row);
    }

    await core.summary
        .addHeading('Cimon SBOM Report', 2)
        .addRaw(parts.join(', ') + '.\n\n')
        .addTable(rows)
        .write();
}
