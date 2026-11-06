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
                    // Track whether stats were actually present in the log line.
                    // Older cimon versions may not emit these fields — we should
                    // NOT filter those entries since we can't tell if they're empty.
                    hasStats: 'components' in parsed,
                });
            }
        } catch {
            // Not valid JSON, skip.
        }
    }
    return entries;
}

/**
 * Parses the Windows agent's SBOM diagnosis from cimon agent stop output:
 * its hint, which says why a job has no SBOM or what to check (empty when
 * everything worked), what each build it followed came to, and examples of
 * linker runs no followed build observed.
 *
 * @param {string} output - Combined stdout+stderr from `cimon agent stop`.
 * @returns {{hint: string, builds: Array<{buildSystem: string, dir: string, outcome: string, detail: string}>, linkerExamples: string[]} | null}
 *   null when the agent logged no diagnosis (Linux, or older cimon versions).
 */
export function parseSBOMDiagnosis(output) {
    let hint = null;
    const builds = [];
    let linkerExamples = [];
    for (const line of output.split('\n')) {
        if (!line.includes('"SBOM diagnosis')) continue;
        let parsed;
        try {
            parsed = JSON.parse(line);
        } catch {
            continue;
        }
        const message = parsed.message ?? parsed.msg;
        if (message === 'SBOM diagnosis') {
            hint = parsed.hint || '';
        } else if (message === 'SBOM diagnosis: build') {
            builds.push({
                buildSystem: parsed.buildSystem || '',
                dir: parsed.dir || '',
                outcome: parsed.outcome || '',
                detail: parsed.detail || '',
            });
        } else if (message === 'SBOM diagnosis: linker runs') {
            linkerExamples = parsed.examples || [];
        }
    }
    if (hint === null) return null;
    return { hint, builds, linkerExamples };
}

function escapeHTML(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

/**
 * Renders the agent's diagnosis for the job summary: its hint, the builds
 * that got no SBOM and why, and the linker runs no followed build observed.
 */
function diagnosisHTML(diagnosis) {
    let html = `<p><strong>Why:</strong> ${escapeHTML(diagnosis.hint)}</p>\n`;
    const unwritten = diagnosis.builds.filter((b) => b.outcome !== 'sbom written');
    if (unwritten.length > 0) {
        html += '<p>Builds without an SBOM:</p>\n<ul>\n';
        for (const b of unwritten) {
            html += `<li>${escapeHTML(b.buildSystem)} build in <code>${escapeHTML(b.dir)}</code>: ${escapeHTML(b.outcome)} (${escapeHTML(b.detail)})</li>\n`;
        }
        html += '</ul>\n';
    }
    if (diagnosis.linkerExamples.length > 0) {
        html += '<p>Linker runs outside the builds the agent followed:</p>\n<ul>\n';
        for (const example of diagnosis.linkerExamples) {
            html += `<li><code>${escapeHTML(example)}</code></li>\n`;
        }
        html += '</ul>\n';
    }
    return html;
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
    return entries.filter((e) => {
        // If stats weren't present in the log line (older cimon), keep the
        // entry — we can't determine whether it's meaningful or noise.
        if (e.hasStats === false) return true;
        return e.components > 1 || e.relationships > 0 || e.artifacts > 0;
    });
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
    const { sbomEnabled = false, diagnosis = null } = options;
    const explain = diagnosis && diagnosis.hint ? diagnosisHTML(diagnosis) : '';

    // Case 3: SBOM not enabled — nothing to report.
    if (sbomEntries.length === 0 && !sbomEnabled) return;

    // Case 2: SBOM was enabled but produced no output.
    if (sbomEntries.length === 0 && sbomEnabled) {
        await core.summary
            .addHeading('Cimon SBOM Report', 2)
            .addRaw(
                explain
                    ? 'SBOM generation was enabled but no SBOMs were produced.\n' + explain
                    : 'SBOM generation was enabled but no SBOMs were produced. ' +
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

    const summary = core.summary
        .addHeading('Cimon SBOM Report', 2)
        .addRaw(parts.join(', ') + '.\n\n')
        .addTable(rows);
    if (explain) summary.addRaw(explain);
    await summary.write();
}
