import { describe, expect, it } from 'vitest';
import {
  assignSegmentState,
  createDefaultSegments,
  createPreviewSampleTimes,
  estimateCappedFrameCount,
  getSourcePreviewBounds,
  type SegmentDraft,
} from '../video';

const segment: SegmentDraft = {
  state: 'answering',
  label: 'AI 输出',
  start: 2,
  end: 5,
  fps: 8,
  stride: 2,
  loop: true,
  color: '#F2B84B',
};

describe('createPreviewSampleTimes', () => {
  it('samples representative times inside the uploaded video segment', () => {
    expect(createPreviewSampleTimes(segment, 4)).toEqual([2, 3, 4, 5]);
  });

  it('returns one safe sample for very short segments', () => {
    expect(createPreviewSampleTimes({ ...segment, start: 1, end: 1.01 }, 4)).toEqual([1]);
  });
});

describe('estimateCappedFrameCount', () => {
  it('shows the frame count after applying the export cap', () => {
    expect(estimateCappedFrameCount({ ...segment, start: 0, end: 10, stride: 1 }, 36)).toBe(36);
    expect(estimateCappedFrameCount({ ...segment, start: 0, end: 1, stride: 2 }, 36)).toBe(15);
  });
});

describe('createDefaultSegments', () => {
  it('defaults every segment to extracting one frame every two source frames', () => {
    expect(createDefaultSegments(8).map((item) => item.stride)).toEqual([2, 2, 2, 2]);
  });
});

describe('assignSegmentState', () => {
  it('swaps target states so every Cloak state remains assigned once', () => {
    const segments = createDefaultSegments(8);
    const next = assignSegmentState(segments, 2, 'playing');

    expect(next.map((item) => item.state)).toEqual([
      'sleeping',
      'answering',
      'playing',
      'interacting',
    ]);
    expect(next[2]).toMatchObject({
      label: '输入中',
      fps: 10,
      loop: true,
      color: '#27AE60',
      start: 4,
      end: 6,
    });
    expect(next[1]).toMatchObject({
      label: 'AI 输出',
      start: 2,
      end: 4,
    });
  });
});

describe('getSourcePreviewBounds', () => {
  it('clamps the selected segment preview range inside the source video duration', () => {
    expect(getSourcePreviewBounds({ ...segment, start: -1, end: 12 }, 8)).toEqual({
      start: 0,
      end: 8,
    });
  });

  it('keeps a visible preview range when the segment is nearly empty', () => {
    expect(getSourcePreviewBounds({ ...segment, start: 7.98, end: 7.99 }, 8)).toEqual({
      start: 7.95,
      end: 8,
    });
  });
});
