/**
 * Pure helpers for parsing and displaying SBOM results in the
 * GitHub Actions job summary.  Extracted so they can be unit-tested
 * independently of the @actions/* runtime.
 */

/**
 * Parses SBOM file entries from cimon agent stop output.
 * Each JSON log line that contains `"SBOM files written"` is expected
 * to carry `cyclonedx` and/or `spdx` path fields.
 *
 * @param {string} output - Combined stdout+stderr from `cimon agent stop`.
 * @returns {Array<{cyclonedx: string, spdx: string}>}
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
                });
            }
        } catch {
            // Not valid JSON, skip.
        }
    }
    return entries;
}

/**
 * Builds a GitHub Actions job summary table from SBOM entries.
 *
 * @param {import('@actions/core')} core - The @actions/core module.
 * @param {Array<{cyclonedx: string, spdx: string}>} sbomEntries
 */
export async function writeSBOMSummary(core, sbomEntries) {
    if (sbomEntries.length === 0) return;

    const rows = [['Format', 'Path']];
    for (const entry of sbomEntries) {
        if (entry.cyclonedx) {
            rows.push(['CycloneDX', `\`${entry.cyclonedx}\``]);
        }
        if (entry.spdx) {
            rows.push(['SPDX', `\`${entry.spdx}\``]);
        }
    }

    await core.summary
        .addHeading('Cimon SBOM Report', 2)
        .addRaw(
            `**${sbomEntries.length}** SBOM${sbomEntries.length > 1 ? 's' : ''} generated during build.\n\n`
        )
        .addTable(rows)
        .write();
}
