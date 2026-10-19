/**
 * AR-Shooter 游戏模式管理系统 (modes.ts)
 * 支持在 HUD 随时切换 3 种差异化核心玩法模式：
 * 1. 荒野狩猎 (Hunting Mode): 虚拟地平线、溪流、树木/巨石掩体、猎物生态与友军误伤惩罚
 * 2. 星际防卫 (Sci-Fi Mode): 经典浮空光晕异兽、浮空能量盾掩体
 * 3. 幽灵猎手 (Ghost Mode): 半透明隐匿幽灵、中心手电筒光锥（12度）显形与逃离
 */

export type GameMode = 'hunting' | 'scifi' | 'ghost';

export interface ModeConfig {
  id: GameMode;
  name: string;
  icon: string;
  description: string;
}

export class ModeManager {
  private currentMode: GameMode = 'hunting';
  private onModeChangeCallback?: (mode: GameMode) => void;

  public static readonly MODES: ModeConfig[] = [
    {
      id: 'hunting',
      name: '荒野狩猎',
      icon: '🌲',
      description: '自然溪流、树石掩体、猎鹿熊猪与友军保护',
    },
    {
      id: 'scifi',
      name: '星际防卫',
      icon: '👾',
      description: '浮空多面体异兽、能量护盾阻挡与重火力扫射',
    },
    {
      id: 'ghost',
      name: '幽灵猎手',
      icon: '👻',
      description: '隐身浮空幽灵、12度准星手电筒照亮显形',
    },
  ];

  constructor(initialMode: GameMode = 'hunting', onChange?: (mode: GameMode) => void) {
    this.currentMode = initialMode;
    this.onModeChangeCallback = onChange;
  }

  public getMode(): GameMode {
    return this.currentMode;
  }

  public getModeConfig(mode: GameMode = this.currentMode): ModeConfig {
    const found = ModeManager.MODES.find((m) => m.id === mode);
    return found || ModeManager.MODES[0];
  }

  public setMode(mode: GameMode): void {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    if (this.onModeChangeCallback) {
      this.onModeChangeCallback(mode);
    }
  }

  public switchNextMode(): GameMode {
    const modes: GameMode[] = ['hunting', 'scifi', 'ghost'];
    const idx = (modes.indexOf(this.currentMode) + 1) % modes.length;
    const nextMode = modes[idx];
    this.setMode(nextMode);
    return nextMode;
  }
}
