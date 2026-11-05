import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stopBinary } from './stop-binary.js';

describe('stopBinary', () => {
    it('skips when the main step saved no binary', () => {
        const exists = () => {
            throw new Error('must not look at the disk');
        };
        assert.match(stopBinary('', exists).skip, /did not install Cimon/);
        assert.match(stopBinary(undefined, exists).skip, /did not install Cimon/);
    });

    it('stops with the binary the main step ran', () => {
        assert.deepEqual(stopBinary('/tmp/cimon-v1/cimon', () => true), {
            path: '/tmp/cimon-v1/cimon',
        });
    });

    it('fails instead of falling back when that binary is gone', () => {
        assert.throws(
            () => stopBinary('/tmp/cimon-v1/cimon', () => false),
            /no longer exists/
        );
    });
});
