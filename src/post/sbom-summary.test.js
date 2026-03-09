import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseSBOMEntries, writeSBOMSummary } from './sbom-summary.js';

// ---------------------------------------------------------------------------
// parseSBOMEntries
// ---------------------------------------------------------------------------
describe('parseSBOMEntries', () => {
    it('returns empty array for empty output', () => {
        assert.deepStrictEqual(parseSBOMEntries(''), []);
    });

    it('returns empty array for output without SBOM markers', () => {
        const output = [
            '{"level":"info","msg":"Cimon agent stopping"}',
            '{"level":"info","msg":"Shutdown complete"}',
        ].join('\n');
        assert.deepStrictEqual(parseSBOMEntries(output), []);
    });

    it('returns empty array for non-JSON lines even with SBOM marker text', () => {
        const output = 'This line mentions "SBOM files written" but is not JSON';
        assert.deepStrictEqual(parseSBOMEntries(output), []);
    });

    it('parses a single SBOM entry with both formats', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.deepStrictEqual(entries[0], {
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
        });
    });

    it('parses a single SBOM entry with only CycloneDX', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.deepStrictEqual(entries[0], {
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '',
        });
    });

    it('parses a single SBOM entry with only SPDX', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.deepStrictEqual(entries[0], {
            cyclonedx: '',
            spdx: '/build/sbom.spdx.json',
        });
    });

    it('parses multiple SBOM entries from multi-project builds', () => {
        const lines = [
            '{"level":"info","msg":"Starting SBOM generation"}',
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/app1/sbom.cdx.json',
                spdx: '/build/app1/sbom.spdx.json',
            }),
            '{"level":"info","msg":"Processing next artifact"}',
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/app2/sbom.cdx.json',
                spdx: '/build/app2/sbom.spdx.json',
            }),
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/app3/sbom.cdx.json',
                spdx: '/build/app3/sbom.spdx.json',
            }),
        ].join('\n');

        const entries = parseSBOMEntries(lines);
        assert.equal(entries.length, 3);
        assert.equal(entries[0].cyclonedx, '/build/app1/sbom.cdx.json');
        assert.equal(entries[1].cyclonedx, '/build/app2/sbom.cdx.json');
        assert.equal(entries[2].cyclonedx, '/build/app3/sbom.cdx.json');
    });

    it('skips JSON lines with SBOM marker but no cyclonedx/spdx fields', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            // No cyclonedx or spdx fields
            count: 0,
        });
        assert.deepStrictEqual(parseSBOMEntries(output), []);
    });

    it('handles mixed valid and invalid lines', () => {
        const lines = [
            'not json at all',
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '/build/sbom.spdx.json',
            }),
            'another "SBOM files written" non-json line',
            '{"level":"info","msg":"unrelated log"}',
        ].join('\n');

        const entries = parseSBOMEntries(lines);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].cyclonedx, '/build/sbom.cdx.json');
    });

    it('handles output from older cimon versions (no SBOM log lines)', () => {
        // Older cimon versions that do not support SBOM generation
        // will not emit "SBOM files written" log lines.
        // The parser should return an empty array — backward compatible.
        const olderCimonOutput = [
            '{"level":"info","time":"2024-01-01T00:00:00Z","msg":"Agent stopping"}',
            '{"level":"info","time":"2024-01-01T00:00:01Z","msg":"eBPF programs detached"}',
            '{"level":"info","time":"2024-01-01T00:00:02Z","msg":"Shutdown complete"}',
        ].join('\n');

        assert.deepStrictEqual(parseSBOMEntries(olderCimonOutput), []);
    });

    it('handles Windows-style line endings (CRLF)', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output + '\r\n');
        assert.equal(entries.length, 1);
    });

    it('handles real-world cimon log format with extra fields', () => {
        // This mirrors the actual log format from cimon agent stop
        const output = JSON.stringify({
            level: 'info',
            time: '2026-03-09T15:35:00Z',
            caller: 'generator.go:520',
            msg: 'SBOM files written',
            cyclonedx:
                '/data/home/runner/work/proj/proj/build-myapp/sbom.cdx.json',
            spdx: '/data/home/runner/work/proj/proj/build-myapp/sbom.spdx.json',
            artifact: 'myapp',
            components: 42,
        });

        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.equal(
            entries[0].cyclonedx,
            '/data/home/runner/work/proj/proj/build-myapp/sbom.cdx.json'
        );
        assert.equal(
            entries[0].spdx,
            '/data/home/runner/work/proj/proj/build-myapp/sbom.spdx.json'
        );
    });
});

// ---------------------------------------------------------------------------
// writeSBOMSummary
// ---------------------------------------------------------------------------
describe('writeSBOMSummary', () => {
    /**
     * Creates a mock @actions/core object that records the summary chain
     * calls so we can assert on them.
     */
    function createMockCore() {
        const calls = [];
        let written = false;

        const summaryBuilder = {
            addHeading(text, level) {
                calls.push({ method: 'addHeading', text, level });
                return summaryBuilder;
            },
            addRaw(text) {
                calls.push({ method: 'addRaw', text });
                return summaryBuilder;
            },
            addTable(rows) {
                calls.push({ method: 'addTable', rows });
                return summaryBuilder;
            },
            async write() {
                written = true;
                calls.push({ method: 'write' });
            },
        };

        return {
            summary: summaryBuilder,
            getCalls: () => calls,
            wasWritten: () => written,
        };
    }

    it('does nothing when entries array is empty', async () => {
        const mockCore = createMockCore();
        await writeSBOMSummary(mockCore, []);
        assert.equal(mockCore.wasWritten(), false);
        assert.equal(mockCore.getCalls().length, 0);
    });

    it('writes summary for a single SBOM entry with both formats', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '/build/sbom.spdx.json',
            },
        ];

        await writeSBOMSummary(mockCore, entries);
        assert.equal(mockCore.wasWritten(), true);

        const calls = mockCore.getCalls();

        // Heading
        const heading = calls.find((c) => c.method === 'addHeading');
        assert.ok(heading);
        assert.equal(heading.text, 'Cimon SBOM Report');
        assert.equal(heading.level, 2);

        // Count text (singular)
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw);
        assert.ok(raw.text.includes('**1** SBOM generated'));
        assert.ok(!raw.text.includes('SBOMs'));

        // Table with header + 2 format rows
        const table = calls.find((c) => c.method === 'addTable');
        assert.ok(table);
        assert.equal(table.rows.length, 3); // header + CycloneDX + SPDX
        assert.deepStrictEqual(table.rows[0], ['Format', 'Path']);
        assert.equal(table.rows[1][0], 'CycloneDX');
        assert.ok(table.rows[1][1].includes('/build/sbom.cdx.json'));
        assert.equal(table.rows[2][0], 'SPDX');
        assert.ok(table.rows[2][1].includes('/build/sbom.spdx.json'));
    });

    it('writes summary for multiple SBOM entries (plural)', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/app1/sbom.cdx.json',
                spdx: '/build/app1/sbom.spdx.json',
            },
            {
                cyclonedx: '/build/app2/sbom.cdx.json',
                spdx: '/build/app2/sbom.spdx.json',
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw.text.includes('**2** SBOMs generated'));

        const table = calls.find((c) => c.method === 'addTable');
        // header + 2 CycloneDX + 2 SPDX = 5 rows
        assert.equal(table.rows.length, 5);
    });

    it('handles entries with only CycloneDX (no SPDX row)', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '',
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const table = calls.find((c) => c.method === 'addTable');
        // header + 1 CycloneDX row only (spdx is empty string, skipped)
        assert.equal(table.rows.length, 2);
        assert.equal(table.rows[1][0], 'CycloneDX');
    });

    it('handles entries with only SPDX (no CycloneDX row)', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '',
                spdx: '/build/sbom.spdx.json',
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const table = calls.find((c) => c.method === 'addTable');
        // header + 1 SPDX row only
        assert.equal(table.rows.length, 2);
        assert.equal(table.rows[1][0], 'SPDX');
    });

    it('handles 13 SBOM entries (real customer scenario)', async () => {
        const mockCore = createMockCore();
        const entries = [];
        for (let i = 1; i <= 13; i++) {
            entries.push({
                cyclonedx: `/build/sub${i}/sbom.cdx.json`,
                spdx: `/build/sub${i}/sbom.spdx.json`,
            });
        }

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw.text.includes('**13** SBOMs generated'));

        const table = calls.find((c) => c.method === 'addTable');
        // header + 13 CycloneDX + 13 SPDX = 27 rows
        assert.equal(table.rows.length, 27);
    });
});

// ---------------------------------------------------------------------------
// Backward compatibility: parseSBOMEntries with older cimon output
// ---------------------------------------------------------------------------
describe('backward compatibility', () => {
    it('gracefully handles output from cimon versions without SBOM support', () => {
        // Older cimon versions just print the standard shutdown messages.
        // No "SBOM files written" lines at all.
        const output = `{"level":"info","time":"2024-06-01T12:00:00Z","msg":"Stopping cimon agent"}
{"level":"info","time":"2024-06-01T12:00:01Z","msg":"eBPF programs detached"}
{"level":"info","time":"2024-06-01T12:00:02Z","msg":"Reports sent successfully","reports":3}
{"level":"info","time":"2024-06-01T12:00:03Z","msg":"Cimon agent stopped"}`;

        const entries = parseSBOMEntries(output);
        assert.deepStrictEqual(entries, []);
    });

    it('gracefully handles completely empty stop output', () => {
        // Edge case: cimon crashes immediately with no output
        assert.deepStrictEqual(parseSBOMEntries(''), []);
    });

    it('gracefully handles binary/garbage output', () => {
        // Edge case: corrupted output
        const output = '\x00\x01\x02\xff\xfe binary garbage';
        assert.deepStrictEqual(parseSBOMEntries(output), []);
    });

    it('writeSBOMSummary is a no-op when no entries (older cimon)', async () => {
        const mockCore = {
            summary: {
                addHeading() {
                    throw new Error('should not be called');
                },
            },
        };
        // Should not throw — returns immediately for empty array
        await writeSBOMSummary(mockCore, []);
    });
});
