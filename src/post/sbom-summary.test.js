import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseSBOMEntries,
    isSBOMEnabled,
    writeSBOMSummary,
} from './sbom-summary.js';

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

    it('parses a single SBOM entry with both formats and stats', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
            components: 42,
            relationships: 18,
            artifacts: 1,
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.deepStrictEqual(entries[0], {
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
            components: 42,
            relationships: 18,
            artifacts: 1,
        });
    });

    it('parses entry without stats (older cimon version)', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].components, 0);
        assert.equal(entries[0].relationships, 0);
        assert.equal(entries[0].artifacts, 0);
    });

    it('parses a single SBOM entry with only CycloneDX', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].cyclonedx, '/build/sbom.cdx.json');
        assert.equal(entries[0].spdx, '');
    });

    it('parses a single SBOM entry with only SPDX', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].cyclonedx, '');
        assert.equal(entries[0].spdx, '/build/sbom.spdx.json');
    });

    it('parses multiple SBOM entries from multi-project builds', () => {
        const lines = [
            '{"level":"info","msg":"Starting SBOM generation"}',
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/app1/sbom.cdx.json',
                spdx: '/build/app1/sbom.spdx.json',
                components: 10,
                relationships: 5,
                artifacts: 1,
            }),
            JSON.stringify({
                level: 'info',
                msg: 'SBOM files written',
                cyclonedx: '/build/app2/sbom.cdx.json',
                spdx: '/build/app2/sbom.spdx.json',
                components: 20,
                relationships: 12,
                artifacts: 2,
            }),
        ].join('\n');

        const entries = parseSBOMEntries(lines);
        assert.equal(entries.length, 2);
        assert.equal(entries[0].components, 10);
        assert.equal(entries[1].components, 20);
    });

    it('skips JSON lines with SBOM marker but no cyclonedx/spdx fields', () => {
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
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
                components: 5,
                relationships: 3,
                artifacts: 1,
            }),
            'another "SBOM files written" non-json line',
            '{"level":"info","msg":"unrelated log"}',
        ].join('\n');

        const entries = parseSBOMEntries(lines);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].cyclonedx, '/build/sbom.cdx.json');
        assert.equal(entries[0].components, 5);
    });

    it('handles output from older cimon versions (no SBOM log lines)', () => {
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
        const output = JSON.stringify({
            level: 'info',
            time: '2026-03-09T15:35:00Z',
            caller: 'generator.go:520',
            msg: 'SBOM files written',
            cyclonedx:
                '/data/home/runner/work/proj/proj/sbom/build-myapp/sbom.cdx.json',
            spdx: '/data/home/runner/work/proj/proj/sbom/build-myapp/sbom.spdx.json',
            components: 42,
            relationships: 104,
            artifacts: 3,
        });

        const entries = parseSBOMEntries(output);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].components, 42);
        assert.equal(entries[0].relationships, 104);
        assert.equal(entries[0].artifacts, 3);
    });
});

// ---------------------------------------------------------------------------
// isSBOMEnabled
// ---------------------------------------------------------------------------
describe('isSBOMEnabled', () => {
    it('returns false for empty output', () => {
        assert.equal(isSBOMEnabled(''), false);
    });

    it('returns false for output without SBOM markers', () => {
        const output = '{"level":"info","msg":"Agent stopping"}';
        assert.equal(isSBOMEnabled(output), false);
    });

    it('returns true when SBOM files were written', () => {
        const output = '{"msg":"SBOM files written","cyclonedx":"/a.json"}';
        assert.equal(isSBOMEnabled(output), true);
    });

    it('returns true when SBOM generation marker is present', () => {
        const output = '{"msg":"SBOM generation","status":"starting"}';
        assert.equal(isSBOMEnabled(output), true);
    });

    it('returns true when CIMON_SBOM_ENABLED is in output', () => {
        const output = 'Config: CIMON_SBOM_ENABLED=true';
        assert.equal(isSBOMEnabled(output), true);
    });
});

// ---------------------------------------------------------------------------
// writeSBOMSummary
// ---------------------------------------------------------------------------
describe('writeSBOMSummary', () => {
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

    // -- Case 3: SBOM not enabled, no entries --
    it('does nothing when no entries and SBOM not enabled', async () => {
        const mockCore = createMockCore();
        await writeSBOMSummary(mockCore, []);
        assert.equal(mockCore.wasWritten(), false);
        assert.equal(mockCore.getCalls().length, 0);
    });

    it('does nothing when no entries and sbomEnabled not passed', async () => {
        const mockCore = createMockCore();
        await writeSBOMSummary(mockCore, [], {});
        assert.equal(mockCore.wasWritten(), false);
    });

    // -- Case 2: SBOM enabled but no entries --
    it('writes informational notice when SBOM enabled but no entries', async () => {
        const mockCore = createMockCore();
        await writeSBOMSummary(mockCore, [], { sbomEnabled: true });
        assert.equal(mockCore.wasWritten(), true);

        const calls = mockCore.getCalls();
        const heading = calls.find((c) => c.method === 'addHeading');
        assert.ok(heading);
        assert.equal(heading.text, 'Cimon SBOM Report');

        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw);
        assert.ok(raw.text.includes('no SBOMs were produced'));
    });

    // -- Case 1: SBOMs generated --
    it('writes rich summary for a single SBOM with stats', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '/build/sbom.spdx.json',
                components: 42,
                relationships: 18,
                artifacts: 1,
            },
        ];

        await writeSBOMSummary(mockCore, entries);
        assert.equal(mockCore.wasWritten(), true);

        const calls = mockCore.getCalls();

        // Heading
        const heading = calls.find((c) => c.method === 'addHeading');
        assert.equal(heading.text, 'Cimon SBOM Report');

        // Overview with stats
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw.text.includes('<strong>1</strong> SBOM generated'));
        assert.ok(raw.text.includes('<strong>42</strong> component'));
        assert.ok(raw.text.includes('<strong>18</strong> relationship'));

        // Table with stats columns
        const table = calls.find((c) => c.method === 'addTable');
        assert.ok(table);
        assert.deepStrictEqual(table.rows[0], [
            '#',
            'CycloneDX',
            'SPDX',
            'Components',
            'Relationships',
        ]);
        assert.equal(table.rows[1][0], '1');
        assert.ok(table.rows[1][1].includes('/build/sbom.cdx.json'));
        assert.ok(table.rows[1][2].includes('/build/sbom.spdx.json'));
        assert.equal(table.rows[1][3], '42');
        assert.equal(table.rows[1][4], '18');
    });

    it('writes summary for multiple entries (plural)', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/app1/sbom.cdx.json',
                spdx: '/build/app1/sbom.spdx.json',
                components: 10,
                relationships: 5,
                artifacts: 1,
            },
            {
                cyclonedx: '/build/app2/sbom.cdx.json',
                spdx: '/build/app2/sbom.spdx.json',
                components: 20,
                relationships: 12,
                artifacts: 2,
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw.text.includes('<strong>2</strong> SBOMs generated'));
        assert.ok(raw.text.includes('<strong>30</strong> component'));
        assert.ok(raw.text.includes('<strong>17</strong> relationship'));

        const table = calls.find((c) => c.method === 'addTable');
        // header + 2 data rows
        assert.equal(table.rows.length, 3);
    });

    it('omits stats columns when older cimon has no stats', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '/build/sbom.spdx.json',
                components: 0,
                relationships: 0,
                artifacts: 0,
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const raw = calls.find((c) => c.method === 'addRaw');
        // Should NOT contain component stats since totals are 0
        assert.ok(!raw.text.includes('components'));

        const table = calls.find((c) => c.method === 'addTable');
        // Only 3 columns: #, CycloneDX, SPDX (no stats columns)
        assert.deepStrictEqual(table.rows[0], ['#', 'CycloneDX', 'SPDX']);
    });

    it('handles entries with only CycloneDX', async () => {
        const mockCore = createMockCore();
        const entries = [
            {
                cyclonedx: '/build/sbom.cdx.json',
                spdx: '',
                components: 5,
                relationships: 2,
                artifacts: 1,
            },
        ];

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const table = calls.find((c) => c.method === 'addTable');
        assert.ok(table.rows[1][1].includes('sbom.cdx.json'));
        assert.equal(table.rows[1][2], '-');
    });

    it('handles 13 SBOM entries (real customer scenario)', async () => {
        const mockCore = createMockCore();
        const entries = [];
        for (let i = 1; i <= 13; i++) {
            entries.push({
                cyclonedx: `/sbom/build-sub${i}/sbom.cdx.json`,
                spdx: `/sbom/build-sub${i}/sbom.spdx.json`,
                components: 10 + i,
                relationships: 5 + i,
                artifacts: 1,
            });
        }

        await writeSBOMSummary(mockCore, entries);

        const calls = mockCore.getCalls();
        const raw = calls.find((c) => c.method === 'addRaw');
        assert.ok(raw.text.includes('<strong>13</strong> SBOMs generated'));

        // Total components: sum of (11..23) = 221
        assert.ok(raw.text.includes('<strong>221</strong> component'));

        const table = calls.find((c) => c.method === 'addTable');
        // header + 13 rows
        assert.equal(table.rows.length, 14);
    });
});

// ---------------------------------------------------------------------------
// Backward compatibility
// ---------------------------------------------------------------------------
describe('backward compatibility', () => {
    it('parseSBOMEntries handles output from cimon without SBOM support', () => {
        const output = `{"level":"info","time":"2024-06-01T12:00:00Z","msg":"Agent stopping"}
{"level":"info","time":"2024-06-01T12:00:01Z","msg":"eBPF programs detached"}
{"level":"info","time":"2024-06-01T12:00:02Z","msg":"Reports sent successfully","reports":3}
{"level":"info","time":"2024-06-01T12:00:03Z","msg":"Cimon agent stopped"}`;

        assert.deepStrictEqual(parseSBOMEntries(output), []);
        assert.equal(isSBOMEnabled(output), false);
    });

    it('gracefully handles completely empty stop output', () => {
        assert.deepStrictEqual(parseSBOMEntries(''), []);
        assert.equal(isSBOMEnabled(''), false);
    });

    it('gracefully handles binary/garbage output', () => {
        const output = '\x00\x01\x02\xff\xfe binary garbage';
        assert.deepStrictEqual(parseSBOMEntries(output), []);
    });

    it('writeSBOMSummary is a no-op when no entries and SBOM not running', async () => {
        const mockCore = {
            summary: {
                addHeading() {
                    throw new Error('should not be called');
                },
            },
        };
        // Should not throw — returns immediately
        await writeSBOMSummary(mockCore, []);
    });

    it('parseSBOMEntries returns 0 stats for older cimon log lines', () => {
        // Older cimon versions emit the log line without stats fields
        const output = JSON.stringify({
            level: 'info',
            msg: 'SBOM files written',
            cyclonedx: '/build/sbom.cdx.json',
            spdx: '/build/sbom.spdx.json',
        });
        const entries = parseSBOMEntries(output);
        assert.equal(entries[0].components, 0);
        assert.equal(entries[0].relationships, 0);
        assert.equal(entries[0].artifacts, 0);
    });
});
