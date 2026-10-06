import { describe, expect, it } from 'vite-plus/test';
import { buildSequenceStartCommand, findStartedSequenceNumbers } from './watch-recording-progress';

describe('findStartedSequenceNumbers', () => {
  it('should find the sequences started in the plugin log', () => {
    const log = [
      '      "cmd": "echo CSDM_SEQUENCE_START 1",',
      '[1000] Executing: echo CSDM_SEQUENCE_START 1',
      '[1000] Executed: echo CSDM_SEQUENCE_START 1',
      '[1000] Executing: mirv_streams record start',
      '[20000] Executing: echo CSDM_SEQUENCE_START 12',
    ].join('\n');

    expect(findStartedSequenceNumbers(log)).toEqual([1, 12]);
    expect(findStartedSequenceNumbers('')).toEqual([]);
  });

  it('should build a command detected in the log', () => {
    expect(findStartedSequenceNumbers(`[1] Executing: ${buildSequenceStartCommand(7)}\n`)).toEqual([7]);
  });
});
