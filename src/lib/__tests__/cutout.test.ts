import { describe, expect, it } from 'vitest';
import { applyColorKeyCutout, colorDistance, type ImageDataLike, type RgbColor } from '../cutout';

function imageDataFromPixels(pixels: number[][]): ImageDataLike {
  const data = new Uint8ClampedArray(pixels.flat());
  return { data, width: pixels.length, height: 1 };
}

function imageDataFromRows(rows: number[][][]): ImageDataLike {
  const width = rows[0]?.length ?? 0;
  const data = new Uint8ClampedArray(rows.flat(2));
  return { data, width, height: rows.length };
}

describe('背景取样抠图', () => {
  it('计算 RGB 欧氏距离', () => {
    expect(colorDistance({ r: 10, g: 20, b: 30 }, { r: 10, g: 20, b: 30 })).toBe(0);
    expect(Math.round(colorDistance({ r: 0, g: 0, b: 0 }, { r: 3, g: 4, b: 0 }))).toBe(5);
  });

  it('把接近背景色的像素设为透明并保留主体像素', () => {
    const background: RgbColor = { r: 250, g: 250, b: 250 };
    const source = imageDataFromPixels([
      [250, 250, 250, 255],
      [245, 246, 245, 255],
      [60, 80, 110, 255],
    ]);

    const result = applyColorKeyCutout(source, {
      background,
      tolerance: 12,
      feather: 0,
    });

    expect([...result.data.slice(0, 12)]).toEqual([
      250, 250, 250, 0,
      245, 246, 245, 0,
      60, 80, 110, 255,
    ]);
  });

  it('对容差边缘内的像素做半透明羽化', () => {
    const source = imageDataFromPixels([
      [112, 100, 100, 255],
    ]);

    const result = applyColorKeyCutout(source, {
      background: { r: 100, g: 100, b: 100 },
      tolerance: 10,
      feather: 10,
    });

    expect(result.data[3]).toBeGreaterThan(0);
    expect(result.data[3]).toBeLessThan(255);
  });

  it('保留不连到画面边缘的近背景色主体像素', () => {
    const backgroundPixel = [250, 250, 250, 255];
    const subjectPixel = [60, 80, 110, 255];
    const lightSubjectPixel = [246, 246, 246, 255];
    const source = imageDataFromRows([
      [
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        subjectPixel,
        subjectPixel,
        subjectPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        subjectPixel,
        lightSubjectPixel,
        subjectPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        subjectPixel,
        subjectPixel,
        subjectPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
      ],
    ]);

    const result = applyColorKeyCutout(source, {
      background: { r: 250, g: 250, b: 250 },
      tolerance: 12,
      feather: 0,
    });

    expect(result.data[(2 * source.width + 2) * 4 + 3]).toBe(255);
  });

  it('削弱贴着透明背景的外轮廓残留色', () => {
    const backgroundPixel = [250, 250, 250, 255];
    const fringePixel = [226, 226, 226, 255];
    const subjectPixel = [70, 85, 105, 255];
    const source = imageDataFromRows([
      [
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        fringePixel,
        subjectPixel,
        backgroundPixel,
      ],
      [
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
        backgroundPixel,
      ],
    ]);

    const result = applyColorKeyCutout(source, {
      background: { r: 250, g: 250, b: 250 },
      tolerance: 12,
      feather: 10,
    });
    const fringeIndex = (1 * source.width + 1) * 4;
    const subjectIndex = (1 * source.width + 2) * 4;

    expect(result.data[fringeIndex + 3]).toBeLessThan(255);
    expect(result.data[fringeIndex]).toBeLessThan(fringePixel[0]);
    expect(result.data[subjectIndex + 3]).toBe(255);
  });
});
