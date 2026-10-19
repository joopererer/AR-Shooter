/**
 * AR-Shooter 游戏大厅与模式管理系统 (modeManager.ts)
 * 支持【360° 全景射击体验】与【复古光枪街机厅 (FC Duck Hunt 1984)】两大分类，
 * 动态 HUD / 控件显隐协议，以及 localStorage 本地最高分持久化。
 */

export type GameMode =
  | 'hunting'
  | 'scifi'
  | 'ghost'
  | 'duckhunt_a'
  | 'duckhunt_b'
  | 'duckhunt_c';

export type ModeCategory = '360_sandbox' | 'retro_lightgun';

export interface ModeConfig {
  id: GameMode;
  category: ModeCategory;
  name: string;
  shortName: string;
  icon: string;
  badge: string;
  description: string;
  isRetroLightGun: boolean;
  duckHuntSubmode?: 'game_a' | 'game_b' | 'game_c';
}

export class ModeManager {
  private currentMode: GameMode = 'hunting';
  private onModeChangeCallback?: (mode: GameMode, config: ModeConfig) => void;

  public static readonly MODES: Record<GameMode, ModeConfig> = {
    hunting: {
      id: 'hunting',
      category: '360_sandbox',
      name: '荒野狩猎 (Wilderness Hunt)',
      shortName: '荒野狩猎',
      icon: '🌲',
      badge: '360° 生态',
      description: '自然溪流、树石掩体、猎鹿熊猪与牛羊猎犬防误伤',
      isRetroLightGun: false,
    },
    scifi: {
      id: 'scifi',
      category: '360_sandbox',
      name: '星际防卫 (Sci-Fi Invasion)',
      shortName: '星际防卫',
      icon: '🚀',
      badge: '战机座舱',
      description: '360°深空战机、曲率光速粒子雨、规避敌舰弹幕',
      isRetroLightGun: false,
    },
    ghost: {
      id: 'ghost',
      category: '360_sandbox',
      name: '幽灵猎手 (Ghost Buster)',
      shortName: '万圣幽灵',
      icon: '🎃',
      badge: '手电探照',
      description: '360°万圣墓园、飞蝠走尸南瓜怪、12°光束探照显形',
      isRetroLightGun: false,
    },
    duckhunt_a: {
      id: 'duckhunt_a',
      category: 'retro_lightgun',
      name: 'FC 打鸭子 GAME A: 单鸭模式',
      shortName: '打鸭子 A',
      icon: '🦆',
      badge: '1 DUCK',
      description: '每波单鸭出击，3发子弹限制，5.5秒逃脱与猎犬互动',
      isRetroLightGun: true,
      duckHuntSubmode: 'game_a',
    },
    duckhunt_b: {
      id: 'duckhunt_b',
      category: 'retro_lightgun',
      name: 'FC 打鸭子 GAME B: 双鸭模式',
      shortName: '打鸭子 B',
      icon: '🦆🦆',
      badge: '2 DUCKS',
      description: '每波双鸭同时腾空，考验快速双发命中与精准跟枪',
      isRetroLightGun: true,
      duckHuntSubmode: 'game_b',
    },
    duckhunt_c: {
      id: 'duckhunt_c',
      category: 'retro_lightgun',
      name: 'FC 打鸭子 GAME C: 飞盘射击',
      shortName: '飞盘射击 C',
      icon: '🎯',
      badge: 'CLAY SHOOT',
      description: '双向抛物线急速远去飞盘，微型靶标高速预判射击',
      isRetroLightGun: true,
      duckHuntSubmode: 'game_c',
    },
  };

  constructor(initialMode: GameMode = 'hunting', onChange?: (mode: GameMode, config: ModeConfig) => void) {
    this.currentMode = initialMode;
    this.onModeChangeCallback = onChange;
  }

  public getMode(): GameMode {
    return this.currentMode;
  }

  public getModeConfig(mode: GameMode = this.currentMode): ModeConfig {
    return ModeManager.MODES[mode] || ModeManager.MODES.hunting;
  }

  public setMode(mode: GameMode): void {
    this.currentMode = mode;
    if (this.onModeChangeCallback) {
      this.onModeChangeCallback(mode, this.getModeConfig(mode));
    }
  }

  /**
   * 读取本地最高分 (localStorage)
   */
  public getHighScore(mode: GameMode): number {
    try {
      const val = localStorage.getItem(`ar_shooter_hi_${mode}`);
      return val ? parseInt(val, 10) || 0 : 0;
    } catch {
      return 0;
    }
  }

  /**
   * 更新本地最高分，若刷新纪录则返回 true
   */
  public updateHighScore(mode: GameMode, score: number): boolean {
    try {
      const current = this.getHighScore(mode);
      if (score > current) {
        localStorage.setItem(`ar_shooter_hi_${mode}`, score.toString());
        return true;
      }
    } catch {}
    return false;
  }
}
