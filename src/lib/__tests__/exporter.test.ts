import { describe, expect, it } from 'vitest';
import {
  buildCloakManifest,
  createSpriteLayout,
  normalizeStateFrames,
  type PetStateFrameSet,
} from '../exporter';

const frameSets: PetStateFrameSet[] = [
  { state: 'sleeping', frames: ['idle-0', 'idle-1'], fps: 6, loop: true },
  { state: 'playing', frames: ['typing-0', 'typing-1', 'typing-2'], fps: 10, loop: true },
  { state: 'answering', frames: ['ai-0'], fps: 8, loop: true },
  { state: 'interacting', frames: ['click-0', 'click-1'], fps: 12, loop: false },
];

describe('Cloak 宠物导出契约', () => {
  it('按 Cloak 四状态顺序补齐每一行帧数', () => {
    const normalized = normalizeStateFrames(frameSets);

    expect(normalized.framesPerState).toBe(3);
    expect(normalized.states.map((item) => item.state)).toEqual([
      'sleeping',
      'playing',
      'answering',
      'interacting',
    ]);
    expect(normalized.states[0].frames).toEqual(['idle-0', 'idle-1', 'idle-1']);
    expect(normalized.states[2].frames).toEqual(['ai-0', 'ai-0', 'ai-0']);
  });

  it('生成按行排列的 sprite 布局和全局帧索引', () => {
    const layout = createSpriteLayout(frameSets, 200, 200);

    expect(layout.cols).toBe(3);
    expect(layout.rows).toBe(4);
    expect(layout.width).toBe(600);
    expect(layout.height).toBe(800);
    expect(layout.frameSlots.map((slot) => [slot.state, slot.frameIndex, slot.x, slot.y])).toEqual([
      ['sleeping', 0, 0, 0],
      ['sleeping', 1, 200, 0],
      ['sleeping', 2, 400, 0],
      ['playing', 3, 0, 200],
      ['playing', 4, 200, 200],
      ['playing', 5, 400, 200],
      ['answering', 6, 0, 400],
      ['answering', 7, 200, 400],
      ['answering', 8, 400, 400],
      ['interacting', 9, 0, 600],
      ['interacting', 10, 200, 600],
      ['interacting', 11, 400, 600],
    ]);
  });

  it('生成 Cloak 当前可消费的 manifest.json', () => {
    const manifest = buildCloakManifest({
      name: '雪叶像素猫',
      description: '由视频生成的桌面宠物。',
      frameWidth: 200,
      frameHeight: 200,
      renderMaxSize: 128,
      frameSets,
    });

    expect(manifest).toMatchObject({
      name: '雪叶像素猫',
      image: 'sprite.png',
      preview: 'pet.png',
      frameWidth: 200,
      frameHeight: 200,
      cols: 3,
      rows: 4,
      framesPerState: 3,
      states: ['sleeping', 'playing', 'answering', 'interacting'],
      fps: {
        sleeping: 6,
        playing: 10,
        answering: 8,
        interacting: 12,
      },
      loop: {
        sleeping: true,
        playing: true,
        answering: true,
        interacting: false,
      },
      behaviorMap: {
        no_operation: 'sleeping',
        user_typing: 'playing',
        ai_output: 'answering',
        pet_click: 'interacting',
      },
      render: {
        maxSize: 128,
        imageRendering: 'pixelated',
      },
    });
    expect(manifest.animations).toEqual({
      sleeping: [0, 1, 2],
      playing: [3, 4, 5],
      answering: [6, 7, 8],
      interacting: [9, 10, 11],
    });
  });
});
