import { applyColorKeyCutout, type CutoutOptions } from './cutout';
import { type CloakPetState } from './exporter';

export interface SegmentDraft {
  state: CloakPetState;
  label: string;
  start: number;
  end: number;
  fps: number;
  stride: number;
  loop: boolean;
  color: string;
}

export interface ProcessedFrame {
  id: string;
  state: CloakPetState;
  time: number;
  index: number;
  dataUrl: string;
}

export interface FrameCaptureOptions {
  frameSize: number;
  removeBackground: boolean;
  cutout: CutoutOptions;
}

export const SOURCE_FPS_ASSUMPTION = 30;

export function getSegmentStatePreset(state: CloakPetState): Pick<SegmentDraft, 'state' | 'label' | 'fps' | 'loop' | 'color'> {
  switch (state) {
    case 'sleeping':
      return { state, label: '休息', fps: 6, loop: true, color: '#2F80ED' };
    case 'playing':
      return { state, label: '输入中', fps: 10, loop: true, color: '#27AE60' };
    case 'answering':
      return { state, label: 'AI 输出', fps: 8, loop: true, color: '#F2B84B' };
    case 'interacting':
      return { state, label: '点击', fps: 12, loop: false, color: '#8A63D2' };
    default:
      return { state, label: state, fps: 6, loop: true, color: '#2F80ED' };
  }
}

export function createDefaultSegments(duration: number): SegmentDraft[] {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 10;
  const slice = safeDuration / 4;
  const states: CloakPetState[] = ['sleeping', 'playing', 'answering', 'interacting'];

  return states.map((state, index) => ({
    ...getSegmentStatePreset(state),
    start: Number((slice * index).toFixed(2)),
    end: Number((index === 3 ? safeDuration : slice * (index + 1)).toFixed(2)),
    stride: 2,
  }));
}

export function assignSegmentState(
  segments: SegmentDraft[],
  index: number,
  targetState: CloakPetState,
): SegmentDraft[] {
  const current = segments[index];
  if (!current || current.state === targetState) return segments;

  const currentPreset = getSegmentStatePreset(current.state);
  const targetPreset = getSegmentStatePreset(targetState);
  const displacedIndex = segments.findIndex((segment, segmentIndex) => (
    segmentIndex !== index && segment.state === targetState
  ));

  return segments.map((segment, segmentIndex) => {
    if (segmentIndex === index) return { ...segment, ...targetPreset };
    if (segmentIndex === displacedIndex) return { ...segment, ...currentPreset };
    return segment;
  });
}

export function estimateFrameCount(segment: Pick<SegmentDraft, 'start' | 'end' | 'stride'>): number {
  const duration = Math.max(0.05, segment.end - segment.start);
  const stride = Math.max(1, segment.stride);
  return Math.max(1, Math.ceil((duration * SOURCE_FPS_ASSUMPTION) / stride));
}

export function estimateCappedFrameCount(
  segment: Pick<SegmentDraft, 'start' | 'end' | 'stride'>,
  maxFrames: number,
): number {
  return Math.min(Math.max(1, Math.floor(maxFrames)), estimateFrameCount(segment));
}

export function createPreviewSampleTimes(
  segment: Pick<SegmentDraft, 'start' | 'end'>,
  requestedCount = 4,
): number[] {
  const start = Math.max(0, segment.start);
  const end = Math.max(start, segment.end);
  const count = Math.max(1, Math.floor(requestedCount));

  if (end - start < 0.05 || count === 1) {
    return [Number(start.toFixed(3))];
  }

  return Array.from({ length: count }, (_, index) => (
    Number((start + ((end - start) * index) / (count - 1)).toFixed(3))
  ));
}

export function getSourcePreviewBounds(
  segment: Pick<SegmentDraft, 'start' | 'end'>,
  duration: number,
): { start: number; end: number } {
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : Math.max(0.05, segment.end);
  const minimumEnd = Math.max(segment.end, segment.start + 0.05);
  const end = Number(Math.max(0.05, Math.min(safeDuration, minimumEnd)).toFixed(3));
  const start = Number(Math.max(0, Math.min(segment.start, end - 0.05)).toFixed(3));

  return { start, end };
}

function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(video.duration || time, time));
  return new Promise((resolve) => {
    const done = () => resolve();
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      done();
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = target;
    window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      done();
    }, 750);
  });
}

function drawVideoFrameToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  frameSize: number,
): CanvasRenderingContext2D {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('无法创建 Canvas 上下文。');

  canvas.width = frameSize;
  canvas.height = frameSize;
  context.clearRect(0, 0, frameSize, frameSize);

  const videoWidth = video.videoWidth || frameSize;
  const videoHeight = video.videoHeight || frameSize;
  const scale = Math.min(frameSize / videoWidth, frameSize / videoHeight);
  const drawWidth = videoWidth * scale;
  const drawHeight = videoHeight * scale;
  const x = (frameSize - drawWidth) / 2;
  const y = (frameSize - drawHeight) / 2;
  context.drawImage(video, x, y, drawWidth, drawHeight);
  return context;
}

export async function captureVideoFrame(
  video: HTMLVideoElement,
  time: number,
  options: FrameCaptureOptions,
): Promise<string> {
  await seekVideo(video, time);
  const canvas = document.createElement('canvas');
  const context = drawVideoFrameToCanvas(video, canvas, options.frameSize);

  if (options.removeBackground) {
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
    const cutout = applyColorKeyCutout(imageData, options.cutout);
    context.putImageData(cutout as ImageData, 0, 0);
  }

  return canvas.toDataURL('image/png');
}

export async function extractSegmentFrames(
  video: HTMLVideoElement,
  segment: SegmentDraft,
  options: FrameCaptureOptions,
  maxFrames = 48,
): Promise<ProcessedFrame[]> {
  const step = Math.max(1, segment.stride) / SOURCE_FPS_ASSUMPTION;
  const frames: ProcessedFrame[] = [];
  const end = Math.max(segment.start + 0.05, segment.end);
  for (let time = segment.start; time <= end && frames.length < maxFrames; time += step) {
    const dataUrl = await captureVideoFrame(video, Math.min(time, end), options);
    frames.push({
      id: `${segment.state}-${frames.length}`,
      state: segment.state,
      time: Number(Math.min(time, end).toFixed(3)),
      index: frames.length,
      dataUrl,
    });
  }
  return frames.length > 0 ? frames : [
    {
      id: `${segment.state}-0`,
      state: segment.state,
      time: segment.start,
      index: 0,
      dataUrl: await captureVideoFrame(video, segment.start, options),
    },
  ];
}

export async function captureSegmentPreviewFrames(
  video: HTMLVideoElement,
  segment: SegmentDraft,
  options: FrameCaptureOptions,
  sampleCount = 4,
): Promise<ProcessedFrame[]> {
  const times = createPreviewSampleTimes(segment, sampleCount);
  const frames: ProcessedFrame[] = [];

  for (const time of times) {
    frames.push({
      id: `${segment.state}-preview-${frames.length}`,
      state: segment.state,
      time,
      index: frames.length,
      dataUrl: await captureVideoFrame(video, time, options),
    });
  }

  return frames;
}
