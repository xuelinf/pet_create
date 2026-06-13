export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface CutoutOptions {
  background: RgbColor;
  tolerance: number;
  feather: number;
  edgeCleanup?: number;
}

export type ImageDataLike = Pick<ImageData, 'data' | 'width' | 'height'>;

export function colorDistance(a: RgbColor, b: RgbColor): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function clampByte(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function cloneImageData(source: ImageDataLike): ImageDataLike {
  const data = new Uint8ClampedArray(source.data);
  if (typeof ImageData !== 'undefined') {
    return new ImageData(data, source.width, source.height);
  }
  return {
    data,
    width: source.width,
    height: source.height,
  };
}

export function applyColorKeyCutout<T extends ImageDataLike>(source: T, options: CutoutOptions): T {
  const tolerance = Math.max(0, options.tolerance);
  const feather = Math.max(0, options.feather);
  const edgeCleanup = Math.max(0, options.edgeCleanup ?? Math.min(36, Math.max(24, feather + 8)));
  const transparentEnd = tolerance;
  const featherEnd = tolerance + feather;
  const edgeCleanupEnd = featherEnd + edgeCleanup;
  const output = cloneImageData(source);
  const pixelCount = output.width * output.height;
  const distances = new Float32Array(pixelCount);
  const candidates = new Uint8Array(pixelCount);
  const connectedBackground = new Uint8Array(pixelCount);
  const queue: number[] = [];

  function markSeed(pixelIndex: number) {
    if (!candidates[pixelIndex] || connectedBackground[pixelIndex]) return;
    connectedBackground[pixelIndex] = 1;
    queue.push(pixelIndex);
  }

  function getNeighborIndices(pixelIndex: number): number[] {
    const x = pixelIndex % output.width;
    const y = Math.floor(pixelIndex / output.width);
    return [
      x > 0 ? pixelIndex - 1 : -1,
      x < output.width - 1 ? pixelIndex + 1 : -1,
      y > 0 ? pixelIndex - output.width : -1,
      y < output.height - 1 ? pixelIndex + output.width : -1,
    ].filter((neighbor) => neighbor >= 0);
  }

  function findForegroundNeighborColor(pixelIndex: number): RgbColor | null {
    const neighbors = getNeighborIndices(pixelIndex);
    let totalR = 0;
    let totalG = 0;
    let totalB = 0;
    let count = 0;

    for (const neighbor of neighbors) {
      if (connectedBackground[neighbor] || distances[neighbor] <= featherEnd) continue;
      const dataIndex = neighbor * 4;
      totalR += output.data[dataIndex];
      totalG += output.data[dataIndex + 1];
      totalB += output.data[dataIndex + 2];
      count += 1;
    }

    if (count === 0) return null;
    return {
      r: totalR / count,
      g: totalG / count,
      b: totalB / count,
    };
  }

  function reduceBackgroundSpill(pixelIndex: number, strength: number) {
    const foregroundColor = findForegroundNeighborColor(pixelIndex);
    if (!foregroundColor) return;

    const dataIndex = pixelIndex * 4;
    output.data[dataIndex] = clampByte(output.data[dataIndex] + (foregroundColor.r - output.data[dataIndex]) * strength);
    output.data[dataIndex + 1] = clampByte(output.data[dataIndex + 1] + (foregroundColor.g - output.data[dataIndex + 1]) * strength);
    output.data[dataIndex + 2] = clampByte(output.data[dataIndex + 2] + (foregroundColor.b - output.data[dataIndex + 2]) * strength);
  }

  for (let index = 0; index < output.data.length; index += 4) {
    const color = {
      r: output.data[index],
      g: output.data[index + 1],
      b: output.data[index + 2],
    };
    const distance = colorDistance(color, options.background);
    const pixelIndex = index / 4;
    distances[pixelIndex] = distance;
    candidates[pixelIndex] = distance <= transparentEnd || (feather > 0 && distance < featherEnd) ? 1 : 0;
  }

  for (let x = 0; x < output.width; x += 1) {
    markSeed(x);
    markSeed((output.height - 1) * output.width + x);
  }

  for (let y = 1; y < output.height - 1; y += 1) {
    markSeed(y * output.width);
    markSeed(y * output.width + output.width - 1);
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const neighbors = getNeighborIndices(current);

    for (const neighbor of neighbors) {
      if (!candidates[neighbor] || connectedBackground[neighbor]) continue;
      connectedBackground[neighbor] = 1;
      queue.push(neighbor);
    }
  }

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    if (!connectedBackground[pixelIndex]) continue;

    const dataIndex = pixelIndex * 4;
    const originalAlpha = output.data[dataIndex + 3];
    const distance = distances[pixelIndex];

    if (distance <= transparentEnd) {
      output.data[dataIndex + 3] = 0;
    } else if (feather > 0 && distance < featherEnd) {
      const progress = (distance - transparentEnd) / feather;
      output.data[dataIndex + 3] = clampByte(originalAlpha * progress);
      reduceBackgroundSpill(pixelIndex, 1 - progress * 0.45);
    }
  }

  if (edgeCleanup > 0) {
    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if (connectedBackground[pixelIndex] || distances[pixelIndex] >= edgeCleanupEnd) continue;
      if (!getNeighborIndices(pixelIndex).some((neighbor) => connectedBackground[neighbor])) continue;

      const dataIndex = pixelIndex * 4;
      const originalAlpha = output.data[dataIndex + 3];
      const cleanupProgress = Math.max(0, Math.min(1, (distances[pixelIndex] - featherEnd) / edgeCleanup));
      const alphaScale = 0.28 + cleanupProgress * 0.72;
      output.data[dataIndex + 3] = clampByte(originalAlpha * alphaScale);
      reduceBackgroundSpill(pixelIndex, 0.78 * (1 - cleanupProgress));
    }
  }

  return output as T;
}

export function sampleImageDataColor(imageData: ImageDataLike, x: number, y: number): RgbColor {
  const safeX = Math.max(0, Math.min(imageData.width - 1, Math.floor(x)));
  const safeY = Math.max(0, Math.min(imageData.height - 1, Math.floor(y)));
  const index = (safeY * imageData.width + safeX) * 4;
  return {
    r: imageData.data[index],
    g: imageData.data[index + 1],
    b: imageData.data[index + 2],
  };
}
