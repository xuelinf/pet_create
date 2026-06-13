import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileJson,
  Film,
  Grid2X2,
  HelpCircle,
  ImageDown,
  Loader2,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  Settings,
  Sparkles,
  Upload,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildCloakManifest,
  CLOAK_STATE_ORDER,
  STATE_LABELS,
  type CloakPetState,
  type PetStateFrameSet,
} from './lib/exporter';
import { type RgbColor } from './lib/cutout';
import {
  assignSegmentState,
  captureVideoFrame,
  captureSegmentPreviewFrames,
  createDefaultSegments,
  estimateCappedFrameCount,
  estimateFrameCount,
  extractSegmentFrames,
  getSourcePreviewBounds,
  type ProcessedFrame,
  type SegmentDraft,
} from './lib/video';
import { buildPetZip, downloadBlob } from './lib/package';

const FRAME_SIZE = 200;
const RENDER_SIZE = 128;
const MAX_FRAMES_PER_STATE = 36;
const PREVIEW_FRAMES_PER_STATE = 4;

type GeneratedFrames = Record<CloakPetState, ProcessedFrame[]>;
type DragHandle = { index: number; edge: 'start' | 'end' } | null;
type SourcePreview = { frame: ProcessedFrame; label: string } | null;

function createEmptyFrameRecord(): GeneratedFrames {
  return {
    sleeping: [],
    playing: [],
    answering: [],
    interacting: [],
  };
}

function formatTime(value: number): string {
  if (!Number.isFinite(value)) return '00:00.00';
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(2).padStart(5, '0')}`;
}

function rgbToHex(color: RgbColor): string {
  return `#${[color.r, color.g, color.b].map((item) => item.toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgb(hex: string): RgbColor {
  const normalized = hex.replace('#', '').trim();
  const value = normalized.length === 3
    ? normalized.split('').map((item) => item + item).join('')
    : normalized.padEnd(6, 'f').slice(0, 6);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function sanitizeProjectId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5-]+/gi, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'pet-sprite';
}

function makeFrameSets(
  segments: SegmentDraft[],
  generated: GeneratedFrames,
): PetStateFrameSet<ProcessedFrame | string>[] {
  return CLOAK_STATE_ORDER.map((state) => {
    const segment = segments.find((item) => item.state === state)!;
    const frames = generated[state].length > 0
      ? generated[state]
      : Array.from({ length: Math.min(estimateFrameCount(segment), MAX_FRAMES_PER_STATE) }, (_, index) => `${state}-${index}`);
    return {
      state,
      frames,
      fps: segment.fps,
      loop: segment.loop,
    };
  });
}

function hasAllGeneratedFrames(generated: GeneratedFrames): boolean {
  return CLOAK_STATE_ORDER.every((state) => generated[state].length > 0);
}

function getBoundaryLabel(edge: 'start' | 'end'): string {
  return edge === 'start' ? '开始' : '结束';
}

export function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const sourceVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragHandle>(null);
  const segmentsRef = useRef<SegmentDraft[]>([]);
  const previewRunRef = useRef(0);
  const sourcePreviewRunRef = useRef(0);
  const sourcePreviewTimerRef = useRef<number | null>(null);
  const [projectName, setProjectName] = useState('雪叶像素伙伴');
  const [description, setDescription] = useState('由视频生成的 Cloak 桌面宠物。');
  const [videoUrl, setVideoUrl] = useState('');
  const [videoName, setVideoName] = useState('尚未上传视频');
  const [videoDuration, setVideoDuration] = useState(10.47);
  const [segments, setSegments] = useState<SegmentDraft[]>(() => createDefaultSegments(10.47));
  const [selectedState, setSelectedState] = useState<CloakPetState>('answering');
  const [removeBackground, setRemoveBackground] = useState(false);
  const [background, setBackground] = useState<RgbColor>({ r: 248, g: 248, b: 248 });
  const [tolerance, setTolerance] = useState(38);
  const [feather, setFeather] = useState(18);
  const [edgeCleanup, setEdgeCleanup] = useState(28);
  const [zoom, setZoom] = useState(300);
  const [generated, setGenerated] = useState<GeneratedFrames>(() => createEmptyFrameRecord());
  const [previewFrames, setPreviewFrames] = useState<GeneratedFrames>(() => createEmptyFrameRecord());
  const [sourcePreview, setSourcePreview] = useState<SourcePreview>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractProgress, setExtractProgress] = useState('');
  const [previewFrameIndex, setPreviewFrameIndex] = useState(0);
  const [playingPreview, setPlayingPreview] = useState(true);
  const [sourceCurrentTime, setSourceCurrentTime] = useState(0);
  const [isSegmentPreviewing, setIsSegmentPreviewing] = useState(false);
  const [lastExportMessage, setLastExportMessage] = useState('等待生成');

  const selectedSegment = segments.find((item) => item.state === selectedState) ?? segments[0];
  const selectedGeneratedFrames = generated[selectedState];
  const selectedPreviewFrames = previewFrames[selectedState];
  const selectedFrames = selectedGeneratedFrames.length > 0 ? selectedGeneratedFrames : selectedPreviewFrames;
  const selectedFrame = selectedFrames[previewFrameIndex % Math.max(1, selectedFrames.length)];
  const selectedEstimatedFrameCount = estimateCappedFrameCount(selectedSegment, MAX_FRAMES_PER_STATE);
  const selectedSourceBounds = getSourcePreviewBounds(selectedSegment, videoDuration);
  const manifest = useMemo(() => buildCloakManifest({
    name: projectName,
    description,
    frameWidth: FRAME_SIZE,
    frameHeight: FRAME_SIZE,
    renderMaxSize: RENDER_SIZE,
    frameSets: makeFrameSets(segments, generated),
  }), [description, generated, projectName, segments]);
  const manifestJson = useMemo(() => JSON.stringify(manifest, null, 2), [manifest]);
  const projectId = sanitizeProjectId(projectName);
  const generatedCount = CLOAK_STATE_ORDER.reduce((total, state) => total + generated[state].length, 0);
  const estimatedTotalFrameCount = CLOAK_STATE_ORDER.reduce((total, state) => {
    const segment = segments.find((item) => item.state === state);
    return total + (segment ? estimateCappedFrameCount(segment, MAX_FRAMES_PER_STATE) : 0);
  }, 0);
  const estimatedSheetSize = `${manifest.cols * FRAME_SIZE}x${manifest.rows * FRAME_SIZE}`;
  const sourcePlayheadLeft = videoDuration > 0
    ? Math.max(0, Math.min(100, (sourceCurrentTime / videoDuration) * 100))
    : 0;

  useEffect(() => {
    if (!playingPreview || selectedFrames.length <= 1) return;
    const interval = window.setInterval(() => {
      setPreviewFrameIndex((index) => (index + 1) % selectedFrames.length);
    }, 1000 / Math.max(1, selectedSegment.fps));
    return () => window.clearInterval(interval);
  }, [playingPreview, selectedFrames.length, selectedSegment.fps]);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    setPreviewFrameIndex(0);
    setSourcePreview(null);
  }, [selectedState, generated]);

  useEffect(() => {
    setIsSegmentPreviewing(false);
    if (videoUrl) seekSourceVideo(selectedSourceBounds.start);
  }, [selectedState]);

  useEffect(() => () => {
    if (videoUrl) URL.revokeObjectURL(videoUrl);
  }, [videoUrl]);

  useEffect(() => () => {
    if (sourcePreviewTimerRef.current) {
      window.clearTimeout(sourcePreviewTimerRef.current);
    }
  }, []);

  function clearGeneratedForState(state: CloakPetState) {
    setGenerated((current) => ({ ...current, [state]: [] }));
  }

  function clearAllGenerated(message?: string) {
    setGenerated(createEmptyFrameRecord());
    if (message) setLastExportMessage(message);
  }

  function seekSourceVideo(time: number, shouldPlay = false) {
    const video = sourceVideoRef.current;
    const clampedTime = Number(Math.max(0, Math.min(videoDuration || time, time)).toFixed(3));
    setSourceCurrentTime(clampedTime);

    if (!video || !videoUrl) return;

    const applySeek = () => {
      video.currentTime = clampedTime;
      if (shouldPlay) {
        void video.play().catch(() => {
          setIsSegmentPreviewing(false);
          setLastExportMessage('浏览器阻止自动播放，请在播放器上手动播放');
        });
      }
    };

    if (Number.isFinite(video.duration) && video.duration > 0) {
      applySeek();
      return;
    }

    video.addEventListener('loadedmetadata', applySeek, { once: true });
  }

  function selectSegment(state: CloakPetState) {
    const segment = segments.find((item) => item.state === state);
    setSelectedState(state);
    setIsSegmentPreviewing(false);
    if (segment) seekSourceVideo(getSourcePreviewBounds(segment, videoDuration).start);
  }

  function previewSelectedSourceSegment() {
    if (!videoUrl) {
      setLastExportMessage('请先上传视频');
      return;
    }

    const video = sourceVideoRef.current;
    if (!video) return;

    if (isSegmentPreviewing) {
      video.pause();
      setIsSegmentPreviewing(false);
      return;
    }

    setSourcePreview(null);
    setIsSegmentPreviewing(true);
    seekSourceVideo(selectedSourceBounds.start, true);
    setLastExportMessage(`正在预览原片：${STATE_LABELS[selectedState]}`);
  }

  function handleSourceVideoTimeUpdate() {
    const video = sourceVideoRef.current;
    if (!video) return;

    const currentTime = Number(video.currentTime.toFixed(2));
    setSourceCurrentTime(currentTime);

    if (isSegmentPreviewing && currentTime >= selectedSourceBounds.end - 0.02) {
      video.pause();
      video.currentTime = selectedSourceBounds.start;
      setSourceCurrentTime(selectedSourceBounds.start);
      setIsSegmentPreviewing(false);
      setLastExportMessage(`${STATE_LABELS[selectedState]} 原片片段预览结束`);
    }
  }

  function updateSegment(index: number, patch: Partial<SegmentDraft>, invalidateFrames = true) {
    const changedState = segments[index]?.state;
    setSegments((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )));
    if (invalidateFrames && changedState) {
      clearGeneratedForState(changedState);
      setLastExportMessage(`${STATE_LABELS[changedState]} 参数已变化，需重新生成`);
    }
  }

  function clampSegment(index: number, edge: 'start' | 'end', value: number) {
    setSegments((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      if (edge === 'start') {
        return { ...item, start: Math.max(0, Math.min(value, item.end - 0.1)) };
      }
      return { ...item, end: Math.min(videoDuration, Math.max(value, item.start + 0.1)) };
    }));
  }

  function scheduleSourcePreview(
    state: CloakPetState,
    time: number,
    label: string,
    delay = 90,
  ) {
    const video = videoRef.current;
    if (!video || !videoUrl) return;

    const runId = sourcePreviewRunRef.current + 1;
    sourcePreviewRunRef.current = runId;

    if (sourcePreviewTimerRef.current) {
      window.clearTimeout(sourcePreviewTimerRef.current);
    }

    sourcePreviewTimerRef.current = window.setTimeout(async () => {
      try {
        const clampedTime = Math.max(0, Math.min(video.duration || time, time));
        const dataUrl = await captureVideoFrame(video, clampedTime, {
          frameSize: FRAME_SIZE,
          removeBackground: false,
          cutout: {
            background,
            tolerance,
            feather,
            edgeCleanup,
          },
        });

        if (sourcePreviewRunRef.current !== runId) return;

        setSourcePreview({
          label,
          frame: {
            id: `${state}-source-${clampedTime.toFixed(3)}`,
            state,
            time: Number(clampedTime.toFixed(3)),
            index: 0,
            dataUrl,
          },
        });
      } catch (error) {
        if (sourcePreviewRunRef.current === runId) {
          setLastExportMessage(error instanceof Error ? `原片预览失败：${error.message}` : '原片预览失败');
        }
      }
    }, delay);
  }

  function handleTimelinePointerMove(event: PointerEvent) {
    const drag = dragRef.current;
    const track = timelineRef.current;
    if (!drag || !track) return;
    const segment = segmentsRef.current[drag.index];
    if (!segment) return;

    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const rawTime = Number((ratio * videoDuration).toFixed(2));
    const clampedTime = drag.edge === 'start'
      ? Math.max(0, Math.min(rawTime, segment.end - 0.1))
      : Math.min(videoDuration, Math.max(rawTime, segment.start + 0.1));

    clampSegment(drag.index, drag.edge, clampedTime);
    scheduleSourcePreview(
      segment.state,
      clampedTime,
      `${segment.label} ${getBoundaryLabel(drag.edge)}`,
    );
    seekSourceVideo(clampedTime);
  }

  function handleTimelinePointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', handleTimelinePointerMove);
    window.removeEventListener('pointerup', handleTimelinePointerUp);

    if (drag) {
      const nextSegments = segmentsRef.current;
      const segment = nextSegments[drag.index];
      if (segment) {
        void generatePreviewFrames(nextSegments);
        scheduleSourcePreview(
          segment.state,
          segment[drag.edge],
          `${segment.label} ${getBoundaryLabel(drag.edge)}`,
          0,
        );
      }
    }
  }

  function startTimelineDrag(index: number, edge: 'start' | 'end', event: { stopPropagation(): void }) {
    event.stopPropagation();
    const segment = segments[index];
    if (segment) {
      selectSegment(segment.state);
      sourceVideoRef.current?.pause();
      setIsSegmentPreviewing(false);
      clearGeneratedForState(segment.state);
      setLastExportMessage(`${segment.label} 片段已调整，需重新生成`);
      scheduleSourcePreview(
        segment.state,
        segment[edge],
        `${segment.label} ${getBoundaryLabel(edge)}`,
        0,
      );
    }
    dragRef.current = { index, edge };
    window.addEventListener('pointermove', handleTimelinePointerMove);
    window.addEventListener('pointerup', handleTimelinePointerUp);
  }

  function handleVideoUpload(file: File | null) {
    if (!file) return;
    previewRunRef.current += 1;
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    setVideoName(file.name);
    setGenerated(createEmptyFrameRecord());
    setPreviewFrames(createEmptyFrameRecord());
    setSourcePreview(null);
    setPreviewFrameIndex(0);
    setSourceCurrentTime(0);
    setIsSegmentPreviewing(false);
    setLastExportMessage('新视频已载入，正在读取时长');
  }

  function handleMetadataLoaded() {
    const duration = videoRef.current?.duration ?? 10.47;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const nextSegments = createDefaultSegments(duration);
    const currentSegment = nextSegments.find((item) => item.state === selectedState) ?? nextSegments[0];
    setVideoDuration(Number(duration.toFixed(2)));
    setSegments(nextSegments);
    setSourceCurrentTime(currentSegment.start);
    seekSourceVideo(currentSegment.start);
    void generatePreviewFrames(nextSegments);
  }

  function resetSegments() {
    const nextSegments = createDefaultSegments(videoDuration);
    const currentSegment = nextSegments.find((item) => item.state === selectedState) ?? nextSegments[0];
    setSegments(nextSegments);
    setGenerated(createEmptyFrameRecord());
    setPreviewFrames(createEmptyFrameRecord());
    setSourcePreview(null);
    setPreviewFrameIndex(0);
    setSourceCurrentTime(currentSegment.start);
    setIsSegmentPreviewing(false);
    seekSourceVideo(currentSegment.start);
    void generatePreviewFrames(nextSegments, '已均分四段，需重新生成');
  }

  function handleSegmentStateChange(index: number, targetState: CloakPetState) {
    const current = segments[index];
    if (!current || current.state === targetState) return;

    const nextSegments = assignSegmentState(segments, index, targetState);
    setSegments(nextSegments);
    setSelectedState(targetState);
    setGenerated(createEmptyFrameRecord());
    setPreviewFrames(createEmptyFrameRecord());
    setSourcePreview(null);
    setPreviewFrameIndex(0);
    setIsSegmentPreviewing(false);
    seekSourceVideo(getSourcePreviewBounds(nextSegments[index], videoDuration).start);
    void generatePreviewFrames(
      nextSegments,
      `片段 ${index + 1} 已导出为 ${STATE_LABELS[targetState]}，需重新生成`,
    );
  }

  async function generatePreviewFrames(
    nextSegments: SegmentDraft[],
    completeMessage = '原片预览帧已生成，可调整片段',
  ) {
    const video = videoRef.current;
    if (!video || !video.currentSrc) return;

    const runId = previewRunRef.current;
    const next = createEmptyFrameRecord();
    setLastExportMessage('已读取视频，正在生成预览帧');

    try {
      for (const segment of nextSegments) {
        if (runId !== previewRunRef.current) return;
        next[segment.state] = await captureSegmentPreviewFrames(video, segment, {
          frameSize: FRAME_SIZE,
          removeBackground: false,
          cutout: {
            background,
            tolerance,
            feather,
            edgeCleanup,
          },
        }, PREVIEW_FRAMES_PER_STATE);
        if (runId === previewRunRef.current) {
          setPreviewFrames({ ...next });
        }
      }
      if (runId === previewRunRef.current) {
        setLastExportMessage(completeMessage);
      }
    } catch (error) {
      if (runId === previewRunRef.current) {
        setLastExportMessage(error instanceof Error ? `预览失败：${error.message}` : '预览失败');
      }
    }
  }

  async function generateFrames(): Promise<GeneratedFrames | null> {
    const video = videoRef.current;
    if (!video || !videoUrl) {
      setLastExportMessage('请先上传视频');
      return null;
    }
    setIsExtracting(true);
    setExtractProgress('准备视频帧');
    setSourcePreview(null);
    const next = createEmptyFrameRecord();

    try {
      for (const segment of segments) {
        const expected = estimateCappedFrameCount(segment, MAX_FRAMES_PER_STATE);
        setExtractProgress(`正在处理：${STATE_LABELS[segment.state]}（预计 ${expected} 帧）`);
        next[segment.state] = await extractSegmentFrames(video, segment, {
          frameSize: FRAME_SIZE,
          removeBackground,
          cutout: {
            background,
            tolerance,
            feather,
            edgeCleanup,
          },
        }, MAX_FRAMES_PER_STATE);
        setGenerated({ ...next });
      }
      setLastExportMessage(`已生成 ${Object.values(next).flat().length} 帧`);
      return next;
    } catch (error) {
      setLastExportMessage(error instanceof Error ? error.message : '抽帧失败');
      return null;
    } finally {
      setExtractProgress('');
      setIsExtracting(false);
    }
  }

  async function exportPackage() {
    let packageFrames = generated;
    if (!hasAllGeneratedFrames(packageFrames)) {
      const next = await generateFrames();
      if (!next) return;
      packageFrames = next;
    }

    const frameSets = CLOAK_STATE_ORDER.map((state) => {
      const segment = segments.find((item) => item.state === state)!;
      return {
        state,
        frames: packageFrames[state],
        fps: segment.fps,
        loop: segment.loop,
      };
    });

    try {
      setLastExportMessage('正在打包 ZIP');
      const zip = await buildPetZip({
        projectId,
        name: projectName,
        description,
        frameWidth: FRAME_SIZE,
        frameHeight: FRAME_SIZE,
        renderMaxSize: RENDER_SIZE,
        frameSets,
      });
      downloadBlob(zip, `${projectId}-cloak-pet.zip`);
      setLastExportMessage('资源包已下载');
    } catch (error) {
      setLastExportMessage(error instanceof Error ? error.message : '导出失败');
    }
  }

  async function copyManifest() {
    await navigator.clipboard?.writeText(manifestJson);
    setLastExportMessage('manifest 已复制');
  }

  function updateRemoveBackground(enabled: boolean) {
    setRemoveBackground(enabled);
    clearAllGenerated(enabled ? '抠图已开启，需重新生成帧' : '抠图已关闭，需重新生成帧');
  }

  function updateBackgroundColor(color: RgbColor) {
    setBackground(color);
    if (removeBackground) clearAllGenerated('背景色已变化，需重新生成帧');
  }

  function updateTolerance(value: number) {
    setTolerance(value);
    if (removeBackground) clearAllGenerated('容差已变化，需重新生成帧');
  }

  function updateFeather(value: number) {
    setFeather(value);
    if (removeBackground) clearAllGenerated('羽化已变化，需重新生成帧');
  }

  function updateEdgeCleanup(value: number) {
    setEdgeCleanup(value);
    if (removeBackground) clearAllGenerated('边缘清理已变化，需重新生成帧');
  }

  const activePreview = sourcePreview?.frame ?? selectedFrame;
  const mainPreviewSrc = activePreview?.dataUrl || '/sample-pet.png';
  const frameStrip = selectedFrames.length > 0
    ? selectedFrames
    : Array.from({ length: 12 }, (_, index) => ({
      id: `sample-${index}`,
      state: selectedState,
      time: selectedSegment.start + index * 0.1,
      index,
      dataUrl: '/sample-pet.png',
    }));

  return (
    <div className="app-shell">
      <video
        ref={videoRef}
        src={videoUrl}
        onLoadedMetadata={handleMetadataLoaded}
        preload="auto"
        muted
        playsInline
        className="hidden-video"
      />

      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Sparkles size={18} />
          </span>
          <div>
            <strong>Pet Sprite Forge</strong>
            <span>Cloak 宠物资源制作台</span>
          </div>
        </div>
        <div className="project-meta">
          <span>项目</span>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          <span>视频</span>
          <strong title={videoName}>{videoName}</strong>
          <span className="saved"><CheckCircle2 size={14} /> {lastExportMessage}</span>
        </div>
        <div className="top-actions">
          <button type="button" className="icon-button" title="撤销"><Redo2 size={16} /></button>
          <button type="button" className="icon-button" title="帮助"><HelpCircle size={16} /></button>
          <button type="button" className="icon-button" title="设置"><Settings size={16} /></button>
          <button type="button" className="primary-button" onClick={exportPackage}>
            <Download size={16} />
            导出资源包
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="clip-rail">
          <div className="panel-heading">
            <div>
              <h2>分镜片段</h2>
              <p>4 个 Cloak 状态</p>
            </div>
            <button className="mini-button" type="button" title="固定为四状态">
              <Plus size={15} />
              状态
            </button>
          </div>

          <div className="clip-list">
            {segments.map((segment, index) => (
              <div
                key={segment.state}
                role="button"
                tabIndex={0}
                className={`clip-row ${selectedState === segment.state ? 'selected' : ''}`}
                onClick={() => selectSegment(segment.state)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    selectSegment(segment.state);
                  }
                }}
              >
                <span className="clip-index" style={{ borderColor: segment.color, color: segment.color }}>{index + 1}</span>
                <span className="clip-thumb">
                  <img src={generated[segment.state][0]?.dataUrl || previewFrames[segment.state][0]?.dataUrl || '/sample-pet.png'} alt="" />
                </span>
                <span className="clip-info">
                  <strong>{segment.label}</strong>
                  <span>{formatTime(segment.start)} - {formatTime(segment.end)}</span>
                  <span>{generated[segment.state].length || 0} 已生成 · 预计 {estimateCappedFrameCount(segment, MAX_FRAMES_PER_STATE)} 帧</span>
                  <span>{previewFrames[segment.state].length ? `${previewFrames[segment.state].length} 张原片预览` : `${FRAME_SIZE}x${FRAME_SIZE}`}</span>
                </span>
                <label className="state-select" onClick={(event) => event.stopPropagation()}>
                  <span>导出为</span>
                  <select
                    value={segment.state}
                    onChange={(event) => handleSegmentStateChange(index, event.target.value as CloakPetState)}
                  >
                    {CLOAK_STATE_ORDER.map((state) => (
                      <option key={state} value={state}>{STATE_LABELS[state]}</option>
                    ))}
                  </select>
                </label>
              </div>
            ))}
          </div>

          <label className="upload-zone">
            <Upload size={17} />
            <span>上传 / 替换视频</span>
            <input
              type="file"
              accept="video/*"
              onChange={(event) => {
                handleVideoUpload(event.target.files?.[0] ?? null);
                event.currentTarget.value = '';
              }}
            />
          </label>

          <div className="source-card">
            <span>源视频</span>
            <strong>{videoName}</strong>
            <p>{formatTime(videoDuration)} · 原片预览 · 本地浏览器处理</p>
          </div>
        </aside>

        <section className="main-lab">
          <div className="tool-strip">
            <button className="state-selector" type="button">
              <Wand2 size={16} />
              {STATE_LABELS[selectedState]}
              <ChevronDown size={15} />
            </button>
            <label className="switch-control">
              <span>抠图</span>
              <input type="checkbox" checked={removeBackground} onChange={(event) => updateRemoveBackground(event.target.checked)} />
            </label>
            <label className="switch-control muted">
              <span>叠加原片</span>
              <input type="checkbox" />
            </label>
            <div className="zoom-control">
              <ZoomOut size={15} />
              <input type="range" min="100" max="500" step="25" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} />
              <ZoomIn size={15} />
              <span>{zoom}%</span>
            </div>
          </div>

          <div className="preview-stage">
            <section className="source-preview-panel">
              <div className="preview-panel-head">
                <div>
                  <span>原视频预览</span>
                  <strong>{videoUrl ? videoName : '上传后显示源视频'}</strong>
                </div>
                <em>{formatTime(sourceCurrentTime)} / {formatTime(videoDuration)}</em>
              </div>

              <div className="source-video-shell">
                {videoUrl ? (
                  <video
                    ref={sourceVideoRef}
                    src={videoUrl}
                    controls
                    preload="metadata"
                    playsInline
                    className="source-video"
                    onTimeUpdate={handleSourceVideoTimeUpdate}
                    onPause={() => setIsSegmentPreviewing(false)}
                    onPlay={() => setSourcePreview(null)}
                  />
                ) : (
                  <div className="source-video-placeholder">
                    <Film size={26} />
                    <span>等待上传视频</span>
                  </div>
                )}
                <span className="source-range-readout">
                  当前片段 · {STATE_LABELS[selectedState]} · {formatTime(selectedSourceBounds.start)} - {formatTime(selectedSourceBounds.end)}
                </span>
              </div>

              <div className="source-preview-actions">
                <button type="button" onClick={() => seekSourceVideo(selectedSourceBounds.start)} disabled={!videoUrl}>
                  <Film size={15} />
                  片段起点
                </button>
                <button type="button" onClick={previewSelectedSourceSegment} disabled={!videoUrl}>
                  {isSegmentPreviewing ? <Pause size={15} /> : <Play size={15} />}
                  {isSegmentPreviewing ? '暂停片段' : '播放当前片段'}
                </button>
                <button type="button" onClick={() => seekSourceVideo(selectedSourceBounds.end)} disabled={!videoUrl}>
                  <Scissors size={15} />
                  片段终点
                </button>
              </div>
            </section>

            <section className="sprite-preview-panel">
              <div className="preview-panel-head">
                <div>
                  <span>动作预览</span>
                  <strong>{STATE_LABELS[selectedState]}</strong>
                </div>
                <em>{selectedFrames.length ? `${selectedFrames.length} 帧` : '未生成'}</em>
              </div>
              <div className="checkerboard preview-canvas">
                <img
                  src={mainPreviewSrc}
                  alt={sourcePreview ? '原片切点预览' : '动作帧预览'}
                  style={{ width: `${Math.min(420, Math.max(160, zoom * 0.9))}px` }}
                />
                {sourcePreview && (
                  <span className="preview-badge">
                    原片切点 · {sourcePreview.label} · {formatTime(sourcePreview.frame.time)}
                  </span>
                )}
              </div>
            </section>
          </div>

          <div className="transport">
            <button type="button" onClick={() => setPlayingPreview((value) => !value)}>
              {playingPreview ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button type="button"><Scissors size={17} /></button>
            <input
              type="range"
              min="0"
              max={Math.max(1, selectedFrames.length - 1)}
              value={Math.min(previewFrameIndex, Math.max(0, selectedFrames.length - 1))}
              onChange={(event) => setPreviewFrameIndex(Number(event.target.value))}
            />
            <span>
              {sourcePreview
                ? `原片 ${formatTime(sourcePreview.frame.time)}`
                : `${selectedFrame ? formatTime(selectedFrame.time) : formatTime(selectedSegment.start)} / ${formatTime(selectedSegment.end)}`}
            </span>
            <select value={selectedSegment.fps} onChange={(event) => updateSegment(segments.indexOf(selectedSegment), { fps: Number(event.target.value) }, false)}>
              {[6, 8, 10, 12, 15, 24].map((fps) => <option key={fps} value={fps}>{fps} fps</option>)}
            </select>
          </div>

          <section className="sampler">
            <div className="section-title">
              <div>
                <h3>帧采样器</h3>
                <p>
                  每隔 {selectedSegment.stride} 帧抽取一帧 · 预计 {selectedEstimatedFrameCount} 帧
                  {selectedGeneratedFrames.length > 0 ? ` · 已生成 ${selectedGeneratedFrames.length} 帧` : ' · 尚未生成正式帧'}
                </p>
              </div>
              <div className="inline-controls">
                <button type="button" onClick={() => updateSegment(segments.indexOf(selectedSegment), { stride: Math.max(1, selectedSegment.stride - 1) })}>-</button>
                <input
                  value={selectedSegment.stride}
                  type="number"
                  min="1"
                  max="30"
                  onChange={(event) => updateSegment(segments.indexOf(selectedSegment), { stride: Math.max(1, Number(event.target.value)) })}
                />
                <button type="button" onClick={() => updateSegment(segments.indexOf(selectedSegment), { stride: selectedSegment.stride + 1 })}>+</button>
              </div>
            </div>
            <div className="frame-grid">
              {frameStrip.slice(0, 18).map((frame, index) => (
                <button
                  key={frame.id}
                  className={index === previewFrameIndex ? 'active' : ''}
                  type="button"
                  onClick={() => setPreviewFrameIndex(index)}
                >
                  <img src={frame.dataUrl} alt="" />
                  <span>{selectedGeneratedFrames.length > 0 ? `#${frame.index + 1}` : formatTime(frame.time)}</span>
                </button>
              ))}
            </div>
            <div className="sampler-foot">
              <span>
                {selectedGeneratedFrames.length > 0
                  ? `正式帧 ${selectedGeneratedFrames.length} / 预计 ${selectedEstimatedFrameCount}`
                  : selectedPreviewFrames.length > 0
                    ? `原片预览 ${selectedPreviewFrames.length} 张 · 预计正式抽 ${selectedEstimatedFrameCount} 帧`
                    : `预计正式抽 ${selectedEstimatedFrameCount} 帧`}
              </span>
              <span>预计精灵图：{estimatedSheetSize} PNG</span>
            </div>
          </section>

          <section className="timeline-panel">
            <div className="section-title compact">
              <h3>源视频时间轴</h3>
              <button type="button" className="mini-button" onClick={resetSegments}>均分四段</button>
            </div>
            <div className="timeline-ruler">
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                <span key={ratio} style={{ left: `${ratio * 100}%` }}>{formatTime(videoDuration * ratio)}</span>
              ))}
            </div>
            <div className="timeline-track" ref={timelineRef}>
              <span className="timeline-playhead" style={{ left: `${sourcePlayheadLeft}%` }} />
              {segments.map((segment, index) => {
                const left = (segment.start / videoDuration) * 100;
                const width = ((segment.end - segment.start) / videoDuration) * 100;
                return (
                  <div
                    key={segment.state}
                    className={`timeline-segment ${selectedState === segment.state ? 'active' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%`, '--segment-color': segment.color } as React.CSSProperties}
                    onClick={() => {
                      selectSegment(segment.state);
                      scheduleSourcePreview(segment.state, segment.start, `${segment.label} 开始`, 0);
                    }}
                  >
                    <button type="button" className="handle start" onPointerDown={(event) => startTimelineDrag(index, 'start', event)} />
                    <span>{index + 1} {segment.label}</span>
                    <button type="button" className="handle end" onPointerDown={(event) => startTimelineDrag(index, 'end', event)} />
                  </div>
                );
              })}
            </div>
          </section>
        </section>

        <aside className="inspector">
          <div className="inspector-tabs">
            <button className="active" type="button"><FileJson size={15} /> 清单</button>
            <button type="button"><Grid2X2 size={15} /> 精灵图</button>
          </div>

          <div className="valid-row">
            <CheckCircle2 size={16} />
            <span>manifest.json 可被 Cloak 读取</span>
            <button type="button" onClick={copyManifest}><Copy size={14} /></button>
          </div>

          <section className="inspector-section">
            <h3>基础信息</h3>
            <label>
              <span>名称</span>
              <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
            </label>
            <label>
              <span>描述</span>
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} />
            </label>
            <div className="field-grid">
              <label><span>帧宽</span><input readOnly value={FRAME_SIZE} /></label>
              <label><span>帧高</span><input readOnly value={FRAME_SIZE} /></label>
              <label><span>列数</span><input readOnly value={manifest.cols} /></label>
              <label><span>行数</span><input readOnly value={manifest.rows} /></label>
            </div>
          </section>

          <section className="inspector-section">
            <h3>抠图参数</h3>
            <label className="color-field">
              <span>背景色</span>
              <input type="color" value={rgbToHex(background)} onChange={(event) => updateBackgroundColor(hexToRgb(event.target.value))} />
              <code>{rgbToHex(background)}</code>
            </label>
            <label>
              <span>容差 {tolerance}</span>
              <input type="range" min="0" max="120" value={tolerance} onChange={(event) => updateTolerance(Number(event.target.value))} />
            </label>
            <label>
              <span>羽化 {feather}</span>
              <input type="range" min="0" max="80" value={feather} onChange={(event) => updateFeather(Number(event.target.value))} />
            </label>
            <label>
              <span>边缘清理 {edgeCleanup}</span>
              <input type="range" min="0" max="80" value={edgeCleanup} onChange={(event) => updateEdgeCleanup(Number(event.target.value))} />
            </label>
          </section>

          <section className="inspector-section">
            <h3>动画状态</h3>
            <div className="state-table">
              {segments.map((segment) => (
                <button
                  type="button"
                  key={segment.state}
                  className={segment.state === selectedState ? 'active' : ''}
                  onClick={() => selectSegment(segment.state)}
                >
                  <span style={{ background: segment.color }} />
                  <strong>{STATE_LABELS[segment.state]}</strong>
                  <em>{manifest.animations[segment.state][0]} - {manifest.animations[segment.state].at(-1)}</em>
                  <small>{segment.loop ? '循环' : '一次'}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="json-panel">
            <div className="json-head">
              <h3>清单 JSON</h3>
              <button type="button" onClick={copyManifest}><Copy size={14} /></button>
            </div>
            <pre>{manifestJson}</pre>
          </section>

          <div className="export-panel">
            <div>
              <h3>导出包</h3>
              <p>包含 sprite.png、pet.png 和 manifest.json。</p>
            </div>
            <code>{projectId}/manifest.json</code>
            <button type="button" className="extract-button" onClick={generateFrames} disabled={isExtracting}>
              {isExtracting ? <Loader2 size={16} className="spin" /> : <ImageDown size={16} />}
              {isExtracting ? extractProgress : removeBackground ? '生成透明帧' : '生成帧'}
            </button>
            <button type="button" className="primary-button wide" onClick={exportPackage}>
              <Download size={17} />
              打包下载
            </button>
            <span className="export-note">
              已生成 {generatedCount} / 预计 {estimatedTotalFrameCount} 帧 · {lastExportMessage}
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}
