import JSZip from 'jszip';
import {
  buildCloakManifest,
  createSpriteLayout,
  type CloakPetManifest,
  type PetStateFrameSet,
} from './exporter';
import { type ProcessedFrame } from './video';

export interface ExportPackageInput {
  projectId: string;
  name: string;
  description: string;
  frameWidth: number;
  frameHeight: number;
  renderMaxSize: number;
  frameSets: PetStateFrameSet<ProcessedFrame>[];
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas 导出 PNG 失败。'));
    }, 'image/png');
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片载入失败。'));
    image.src = src;
  });
}

export async function composeSpriteSheet(input: ExportPackageInput): Promise<Blob> {
  const layout = createSpriteLayout(input.frameSets, input.frameWidth, input.frameHeight);
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建 sprite Canvas。');

  canvas.width = layout.width;
  canvas.height = layout.height;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;

  for (const slot of layout.frameSlots) {
    const image = await loadImage(slot.frame.dataUrl);
    context.drawImage(image, slot.x, slot.y, layout.frameWidth, layout.frameHeight);
  }

  return canvasToBlob(canvas);
}

export async function createPreviewImage(input: ExportPackageInput): Promise<Blob> {
  const firstFrame = input.frameSets.find((set) => set.state === 'sleeping')?.frames[0]
    ?? input.frameSets[0]?.frames[0];
  if (!firstFrame) throw new Error('缺少预览帧。');

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建预览 Canvas。');

  canvas.width = input.frameWidth;
  canvas.height = input.frameHeight;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = false;
  const image = await loadImage(firstFrame.dataUrl);
  context.drawImage(image, 0, 0, input.frameWidth, input.frameHeight);
  return canvasToBlob(canvas);
}

export function buildManifestFromFrames(input: ExportPackageInput): CloakPetManifest {
  return buildCloakManifest({
    name: input.name,
    description: input.description,
    frameWidth: input.frameWidth,
    frameHeight: input.frameHeight,
    renderMaxSize: input.renderMaxSize,
    frameSets: input.frameSets,
  });
}

export async function buildPetZip(input: ExportPackageInput): Promise<Blob> {
  const manifest = buildManifestFromFrames(input);
  const sprite = await composeSpriteSheet(input);
  const preview = await createPreviewImage(input);
  const folderName = input.projectId.trim() || 'pet-sprite-forge';
  const zip = new JSZip();
  const folder = zip.folder(folderName);
  if (!folder) throw new Error('创建 ZIP 目录失败。');

  folder.file('manifest.json', JSON.stringify(manifest, null, 2));
  folder.file('sprite.png', sprite);
  folder.file('pet.png', preview);
  return zip.generateAsync({ type: 'blob' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

