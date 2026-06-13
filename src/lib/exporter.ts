export type CloakPetState = 'sleeping' | 'playing' | 'answering' | 'interacting';

export const CLOAK_STATE_ORDER: CloakPetState[] = [
  'sleeping',
  'playing',
  'answering',
  'interacting',
];

export const STATE_LABELS: Record<CloakPetState, string> = {
  sleeping: '休息',
  playing: '用户输入',
  answering: 'AI 输出',
  interacting: '点击',
};

export interface PetStateFrameSet<TFrame = string> {
  state: CloakPetState;
  frames: TFrame[];
  fps: number;
  loop: boolean;
}

export interface NormalizedStateFrameSet<TFrame = string> extends PetStateFrameSet<TFrame> {
  frames: TFrame[];
}

export interface NormalizedFrameSets<TFrame = string> {
  framesPerState: number;
  states: NormalizedStateFrameSet<TFrame>[];
}

export interface SpriteFrameSlot<TFrame = string> {
  state: CloakPetState;
  frame: TFrame;
  frameIndex: number;
  stateFrameIndex: number;
  x: number;
  y: number;
}

export interface SpriteLayout<TFrame = string> {
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  width: number;
  height: number;
  frameSlots: SpriteFrameSlot<TFrame>[];
}

export interface BuildManifestInput<TFrame = string> {
  name: string;
  description: string;
  frameWidth: number;
  frameHeight: number;
  renderMaxSize: number;
  frameSets: PetStateFrameSet<TFrame>[];
}

export interface CloakPetManifest {
  name: string;
  description: string;
  order: number;
  image: 'sprite.png';
  preview: 'pet.png';
  frameWidth: number;
  frameHeight: number;
  cols: number;
  rows: number;
  states: CloakPetState[];
  framesPerState: number;
  animations: Record<CloakPetState, number[]>;
  fps: Record<CloakPetState, number>;
  loop: Record<CloakPetState, boolean>;
  behaviorMap: {
    no_operation: 'sleeping';
    user_typing: 'playing';
    ai_output: 'answering';
    pet_click: 'interacting';
  };
  render: {
    maxSize: number;
    imageRendering: 'pixelated';
  };
  notes: {
    placement: string;
    behavior: string;
    source: string;
  };
}

function safePositiveInteger(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function getStateFrameSet<TFrame>(
  frameSets: PetStateFrameSet<TFrame>[],
  state: CloakPetState,
): PetStateFrameSet<TFrame> {
  const found = frameSets.find((set) => set.state === state);
  if (!found) {
    throw new Error(`缺少 ${state} 状态的帧。`);
  }
  if (found.frames.length === 0) {
    throw new Error(`${state} 状态至少需要 1 帧。`);
  }
  return found;
}

export function normalizeStateFrames<TFrame>(
  frameSets: PetStateFrameSet<TFrame>[],
): NormalizedFrameSets<TFrame> {
  const ordered = CLOAK_STATE_ORDER.map((state) => getStateFrameSet(frameSets, state));
  const framesPerState = Math.max(...ordered.map((set) => set.frames.length));

  return {
    framesPerState,
    states: ordered.map((set) => {
      const lastFrame = set.frames[set.frames.length - 1];
      return {
        ...set,
        fps: safePositiveInteger(set.fps, 6),
        frames: Array.from({ length: framesPerState }, (_, index) => set.frames[index] ?? lastFrame),
      };
    }),
  };
}

export function createSpriteLayout<TFrame>(
  frameSets: PetStateFrameSet<TFrame>[],
  frameWidth: number,
  frameHeight: number,
): SpriteLayout<TFrame> {
  const normalized = normalizeStateFrames(frameSets);
  const safeFrameWidth = safePositiveInteger(frameWidth, 200);
  const safeFrameHeight = safePositiveInteger(frameHeight, 200);
  const frameSlots = normalized.states.flatMap((set, rowIndex) => (
    set.frames.map((frame, stateFrameIndex) => {
      const frameIndex = rowIndex * normalized.framesPerState + stateFrameIndex;
      return {
        state: set.state,
        frame,
        frameIndex,
        stateFrameIndex,
        x: stateFrameIndex * safeFrameWidth,
        y: rowIndex * safeFrameHeight,
      };
    })
  ));

  return {
    frameWidth: safeFrameWidth,
    frameHeight: safeFrameHeight,
    cols: normalized.framesPerState,
    rows: CLOAK_STATE_ORDER.length,
    width: normalized.framesPerState * safeFrameWidth,
    height: CLOAK_STATE_ORDER.length * safeFrameHeight,
    frameSlots,
  };
}

export function buildCloakManifest<TFrame>(input: BuildManifestInput<TFrame>): CloakPetManifest {
  const layout = createSpriteLayout(input.frameSets, input.frameWidth, input.frameHeight);
  const normalized = normalizeStateFrames(input.frameSets);
  const animations = Object.fromEntries(
    normalized.states.map((set, rowIndex) => [
      set.state,
      set.frames.map((_, index) => rowIndex * normalized.framesPerState + index),
    ]),
  ) as Record<CloakPetState, number[]>;
  const fps = Object.fromEntries(
    normalized.states.map((set) => [set.state, safePositiveInteger(set.fps, 6)]),
  ) as Record<CloakPetState, number>;
  const loop = Object.fromEntries(
    normalized.states.map((set) => [set.state, set.loop]),
  ) as Record<CloakPetState, boolean>;

  return {
    name: input.name.trim() || 'Pet Sprite',
    description: input.description.trim(),
    order: 100,
    image: 'sprite.png',
    preview: 'pet.png',
    frameWidth: layout.frameWidth,
    frameHeight: layout.frameHeight,
    cols: layout.cols,
    rows: layout.rows,
    states: [...CLOAK_STATE_ORDER],
    framesPerState: normalized.framesPerState,
    animations,
    fps,
    loop,
    behaviorMap: {
      no_operation: 'sleeping',
      user_typing: 'playing',
      ai_output: 'answering',
      pet_click: 'interacting',
    },
    render: {
      maxSize: safePositiveInteger(input.renderMaxSize, 128),
      imageRendering: 'pixelated',
    },
    notes: {
      placement: 'transparent sprite sheet optimized for Cloak floating GUI pet usage',
      behavior: 'sleeping maps to idle, playing maps to user typing, answering maps to AI output, interacting maps to pet click',
      source: 'generated by Pet Sprite Forge',
    },
  };
}
