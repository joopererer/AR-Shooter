/**
 * AR-Shooter 多武器系统与第一人称枪械视模 (weapons.ts)
 * 包含猎鹿步枪、双管霰弹枪、穿甲高倍狙击枪 (2倍光学变焦与穿透)，
 * 3D 枪模呼吸摆动与后坐力动画，以及 devicemotion 体感摇晃/上挑切枪。
 */

import * as THREE from 'three';

export type WeaponType = 'rifle' | 'shotgun' | 'sniper';

export interface WeaponConfig {
  type: WeaponType;
  name: string;
  damage: number;
  obstacleDamage: number;   // 掩体破坏力 (霰弹与穿甲狙对岩石/树木有超强碎裂效果)
  cooldown: number; // 秒
  pellets: number;  // 弹丸数 (霰弹枪为8)
  spread: number;   // 散布弧度
  penetratesCover: boolean; // 是否穿透掩体
  zoomFactor: number;       // 放大倍率
}

export class WeaponManager {
  private camera: THREE.Camera;
  private weaponRig = new THREE.Group();
  private currentWeaponMesh: THREE.Group | null = null;

  private currentType: WeaponType = 'rifle';
  private lastFireTime: number = 0;
  private recoilAmount: number = 0; // 后坐力回弹量
  private breathTime: number = 0;

  // 武器参数配置表
  private readonly configs: Record<WeaponType, WeaponConfig> = {
    rifle: {
      type: 'rifle',
      name: '猎鹿步枪',
      damage: 1,
      obstacleDamage: 1, // 点射剥落石屑，需 3 发破坏巨石
      cooldown: 0.28,
      pellets: 1,
      spread: 0.002,
      penetratesCover: false,
      zoomFactor: 1.0,
    },
    shotgun: {
      type: 'shotgun',
      name: '双管霰弹枪',
      damage: 1,
      obstacleDamage: 2, // 霰弹重型动能爆发，近距离 1~2 发轰碎巨石
      cooldown: 0.75,
      pellets: 8,
      spread: 0.085, // 宽散布面
      penetratesCover: false,
      zoomFactor: 1.0,
    },
    sniper: {
      type: 'sniper',
      name: '光学穿甲狙击',
      damage: 3,
      obstacleDamage: 4, // 穿甲电磁弹：穿透掩体的同时一枪直接彻底轰碎巨石！
      cooldown: 1.5,
      pellets: 1,
      spread: 0.0005,
      penetratesCover: true, // 核心特性：无视树木岩石掩体直接穿透！
      zoomFactor: 2.0,
    },
  };

  // 体感甩动手势切枪 (Shake to Switch)
  private lastShakeTime: number = 0;
  private onWeaponSwitchCallback?: (weapon: WeaponConfig) => void;

  constructor(camera: THREE.Camera, onSwitch?: (weapon: WeaponConfig) => void) {
    this.camera = camera;
    this.onWeaponSwitchCallback = onSwitch;

    // 将武器挂载到相机坐标系下 (右前方手持视角)
    this.camera.add(this.weaponRig);
    this.weaponRig.position.set(0.28, -0.24, -0.55);

    this.buildCurrentWeaponModel();
    this.initMotionSensor();
  }

  /**
   * 监听手机体感大幅甩动或上挑
   */
  private initMotionSensor(): void {
    window.addEventListener('devicemotion', (event) => {
      const acc = event.acceleration;
      if (!acc || acc.x === null || acc.y === null || acc.z === null) return;

      const mag = Math.hypot(acc.x, acc.y, acc.z);
      const now = performance.now();

      // 阈值 > 18 m/s² 且防抖间隔 800ms
      if (mag > 18.0 && now - this.lastShakeTime > 800) {
        this.lastShakeTime = now;
        this.switchNextWeapon();
      }
    });
  }

  /**
   * 循环切换到下一把武器
   */
  public switchNextWeapon(): WeaponConfig {
    const list: WeaponType[] = ['rifle', 'shotgun', 'sniper'];
    const nextIdx = (list.indexOf(this.currentType) + 1) % list.length;
    return this.setWeapon(list[nextIdx]);
  }

  /**
   * 切换至指定武器
   */
  public setWeapon(type: WeaponType): WeaponConfig {
    this.currentType = type;
    this.buildCurrentWeaponModel();

    const cfg = this.configs[type];
    if (this.onWeaponSwitchCallback) {
      this.onWeaponSwitchCallback(cfg);
    }
    return cfg;
  }

  public setVisible(visible: boolean): void {
    this.weaponRig.visible = visible;
  }

  public getCurrentConfig(): WeaponConfig {
    return this.configs[this.currentType];
  }

  /**
   * 判断当前是否可开火并更新开火冷却
   */
  public canFire(): boolean {
    const now = performance.now() / 1000;
    const cfg = this.configs[this.currentType];
    if (now - this.lastFireTime >= cfg.cooldown) {
      this.lastFireTime = now;
      this.recoilAmount = this.currentType === 'shotgun' ? 0.35 : this.currentType === 'sniper' ? 0.28 : 0.16;
      return true;
    }
    return false;
  }

  /**
   * 每一帧更新武器轻微呼吸悬浮与开火后坐力恢复
   */
  public update(delta: number): void {
    this.breathTime += delta * 2.2;

    // 呼吸微浮动
    const swayX = Math.cos(this.breathTime) * 0.008;
    const swayY = Math.sin(this.breathTime * 2.0) * 0.006;

    // 后坐力平滑恢复
    this.recoilAmount = Math.max(0, this.recoilAmount - delta * 2.2);

    // 应用变换到武器挂架上
    this.weaponRig.position.set(0.28 + swayX, -0.24 + swayY + this.recoilAmount * 0.08, -0.55 + this.recoilAmount * 0.12);
    this.weaponRig.rotation.set(this.recoilAmount * 0.45, -0.05 + swayX * 2.0, this.recoilAmount * 0.15);
  }

  /**
   * 构造第一人称科幻/写实 3D 枪模
   */
  private buildCurrentWeaponModel(): void {
    if (this.currentWeaponMesh) {
      this.weaponRig.remove(this.currentWeaponMesh);
      this.currentWeaponMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
          else child.material.dispose();
        }
      });
    }

    const group = new THREE.Group();
    const darkMetal = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.3, metalness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 });
    const cyanGlow = new THREE.MeshBasicMaterial({ color: 0x00f3ff });

    if (this.currentType === 'rifle') {
      // 细长高精准步枪
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 0.65, 8), darkMetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0, -0.2);
      group.add(barrel);

      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.12, 0.35), woodMat);
      stock.position.set(0, -0.06, 0.18);
      group.add(stock);

      const light = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.015, 0.25), cyanGlow);
      light.position.set(0, 0.03, -0.1);
      group.add(light);
    } else if (this.currentType === 'shotgun') {
      // 粗壮双枪管霰弹枪
      [-0.028, 0.028].forEach((bx) => {
        const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.034, 0.55, 8), darkMetal);
        barrel.rotation.x = Math.PI / 2;
        barrel.position.set(bx, 0, -0.15);
        group.add(barrel);
      });

      const body = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.35), woodMat);
      body.position.set(0, -0.05, 0.15);
      group.add(body);
    } else {
      // 穿甲狙击枪 (长枪管 + 顶部发光高倍瞄准镜)
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.03, 0.85, 8), darkMetal);
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(0, 0, -0.32);
      group.add(barrel);

      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 8), darkMetal);
      scope.rotation.x = Math.PI / 2;
      scope.position.set(0, 0.07, -0.05);
      group.add(scope);

      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.032, 12), cyanGlow);
      lens.position.set(0, 0.07, -0.2);
      lens.rotation.y = Math.PI;
      group.add(lens);
    }

    this.weaponRig.add(group);
    this.currentWeaponMesh = group;
  }

  public dispose(): void {
    if (this.currentWeaponMesh) {
      this.weaponRig.remove(this.currentWeaponMesh);
    }
  }
}
