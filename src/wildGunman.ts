/**
 * AR 荒野大镖客 (Wild Gunman 1984) 核心游戏引擎 (src/wildGunman.ts)
 * 1:1 还原红白机光枪鼻祖《Wild Gunman》全部规则与体感体验：
 * - GAME A: 1 Outlaw (单人决斗，禁射对峙期 + FIRE!! 瞬间高精拔枪判定 + 犯规抢跑惩罚)
 * - GAME B: 2 Outlaws (双匪决斗，双匪同时拔枪，考验双发连续跟瞄与击杀)
 * - GAME C: Saloon Gang (西部酒馆窗户乱斗，5扇百叶窗+双开木门随机出匪，打爆空中飞天炸药桶)
 */

import * as THREE from 'three';
import { AudioManager } from './audio';

export type GunmanSubmode = 'game_a' | 'game_b' | 'game_c';

export interface GunmanHUDState {
  submode: GunmanSubmode;
  round: number;
  enemyTime: number;
  playerTime: number | null;
  lives: number;
  score: number;
  state: 'standoff' | 'draw' | 'won' | 'lost' | 'foul' | 'saloon';
  fireBanner: boolean;
  foulBanner: boolean;
  brokenScreen: boolean;
  isGameOver: boolean;
}

export interface WildGunmanShootResult {
  fired: boolean;
  hit: boolean;
  reason?: 'no_ammo' | 'foul' | 'waiting' | 'inactive';
}

interface OutlawEntity {
  id: string;
  name: string;
  meshGroup: THREE.Group;
  colliderMeshes: THREE.Mesh[];
  hatMesh: THREE.Mesh | null;
  eyeFlashMesh: THREE.Mesh | null;
  reactionTime: number; // 恶棍拔枪时间 (秒)
  state: 'walking' | 'standoff' | 'fire_ready' | 'hit' | 'shooting' | 'dead';
  targetPos: THREE.Vector3;
  walkTimer: number;
  hitTimer: number;
  hitType: 'hat_fly' | 'tumble_back' | 'spin_drop';
  isHit: boolean;
}

interface SaloonWindow {
  id: number;
  position: THREE.Vector3;
  shutterLeft: THREE.Mesh;
  shutterRight: THREE.Mesh;
  isOpen: boolean;
  occupant: OutlawEntity | null;
  timer: number;
  maxTime: number;
}

interface DynamiteEntity {
  mesh: THREE.Group;
  colliderMesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: number;
  rotationSpeed: THREE.Vector3;
  isHit: boolean;
  life: number;
}

export class WildGunmanEngine {
  private scene: THREE.Scene;
  private audioManager: AudioManager;
  private rootGroup = new THREE.Group();

  private submode: GunmanSubmode = 'game_a';
  private round: number = 1;
  private score: number = 0;
  private lives: number = 3;
  private shotsLeft: number = 3;

  private isRunning: boolean = false;
  private currentStage: 'standoff' | 'draw' | 'won' | 'lost' | 'foul' | 'saloon' = 'standoff';
  private standoffTimer: number = 0;
  private standoffDuration: number = 2.5;

  private fireSignalTime: number = 0;
  private playerReactionTime: number | null = null;
  private activeOutlaws: OutlawEntity[] = [];
  private activeDynamites: DynamiteEntity[] = [];

  // 酒馆窗户与门结构 (Game C)
  private saloonGroup: THREE.Group = new THREE.Group();
  private saloonWindows: SaloonWindow[] = [];
  private saloonSpawnTimer: number = 0;
  private saloonDefeatedCount: number = 0;

  // 视觉指示状态
  private showFireBanner: boolean = false;
  private showFoulBanner: boolean = false;
  private showBrokenScreen: boolean = false;

  // 回调函数
  public onHUDUpdate?: (state: GunmanHUDState) => void;
  public onGameOver?: (score: number, round: number) => void;
  public onRoundClear?: (round: number, bonus: number) => void;

  constructor(
    scene: THREE.Scene,
    _camera: THREE.Camera,
    audioManager: AudioManager,
    callbacks?: {
      onHUDUpdate?: (state: GunmanHUDState) => void;
      onGameOver?: (score: number, round: number) => void;
      onRoundClear?: (round: number, bonus: number) => void;
    }
  ) {
    this.scene = scene;
    this.audioManager = audioManager;
    if (callbacks) {
      this.onHUDUpdate = callbacks.onHUDUpdate;
      this.onGameOver = callbacks.onGameOver;
      this.onRoundClear = callbacks.onRoundClear;
    }

    this.scene.add(this.rootGroup);
  }

  // ==========================================================================
  // 模式启动与初始化
  // ==========================================================================

  public start(submode: GunmanSubmode): void {
    this.clear();
    this.submode = submode;
    this.round = 1;
    this.score = 0;
    this.lives = 3;
    this.isRunning = true;

    this.buildWesternEnvironment();

    if (this.submode === 'game_c') {
      this.buildSaloonFacade();
      this.startSaloonRound(1);
    } else {
      this.startDuelRound(1);
    }
  }

  public getStageZ(): number {
    const isLandscape = window.innerWidth > window.innerHeight;
    return isLandscape ? -5.5 : -6.8;
  }

  public onResize(): void {
    const stageZ = this.getStageZ();
    if (this.saloonGroup) {
      this.saloonGroup.position.z = stageZ;
    }
  }

  /**
   * 构建低多边形西部荒野前景元素 (仙人掌、木桶、土丘石块)
   */
  private buildWesternEnvironment(): void {
    const stageZ = this.getStageZ();

    // 1. 西部黄沙地基带
    const groundGeo = new THREE.BoxGeometry(16, 0.4, 2.5);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x9a3412,
      roughness: 0.9,
      flatShading: true,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.set(0, -1.8, stageZ);
    this.rootGroup.add(ground);

    // 2. 两侧经典多边形仙人掌 (Saguaro Cacti)
    this.createCactus(-4.2, -1.6, stageZ + 0.3, 1.4);
    this.createCactus(4.2, -1.6, stageZ + 0.3, 1.2);

    // 3. 西部木桶 (Wooden Barrel)
    this.createBarrel(-3.2, -1.4, stageZ + 0.5);
    this.createBarrel(3.4, -1.4, stageZ + 0.5);
  }

  private createCactus(x: number, y: number, z: number, scale: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.scale.set(scale, scale, scale);

    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.85,
      flatShading: true,
    });

    // 主干
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 2.4, 6), greenMat);
    trunk.position.y = 1.2;
    group.add(trunk);

    // 左侧分支
    const leftArmH = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.55, 5), greenMat);
    leftArmH.rotation.z = Math.PI / 2;
    leftArmH.position.set(-0.35, 1.4, 0);
    group.add(leftArmH);

    const leftArmV = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 5), greenMat);
    leftArmV.position.set(-0.62, 1.7, 0);
    group.add(leftArmV);

    // 右侧分支
    const rightArmH = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.5, 5), greenMat);
    rightArmH.rotation.z = -Math.PI / 2;
    rightArmH.position.set(0.32, 1.1, 0);
    group.add(rightArmH);

    const rightArmV = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 5), greenMat);
    rightArmV.position.set(0.56, 1.35, 0);
    group.add(rightArmV);

    this.rootGroup.add(group);
  }

  private createBarrel(x: number, y: number, z: number): void {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x78350f,
      roughness: 0.8,
      flatShading: true,
    });
    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x374151,
      roughness: 0.6,
      metalness: 0.7,
    });

    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.8, 8), woodMat);
    group.add(barrel);

    // 铁箍
    const ring1 = new THREE.Mesh(new THREE.TorusGeometry(0.33, 0.02, 4, 8), ironMat);
    ring1.rotation.x = Math.PI / 2;
    ring1.position.y = 0.22;
    group.add(ring1);

    const ring2 = ring1.clone();
    ring2.position.y = -0.22;
    group.add(ring2);

    this.rootGroup.add(group);
  }

  // ==========================================================================
  // Game A & B: 决斗生命周期与对峙拔枪逻辑
  // ==========================================================================

  private startDuelRound(roundNum: number): void {
    this.round = roundNum;
    this.shotsLeft = 3;
    this.currentStage = 'standoff';
    this.showFireBanner = false;
    this.showFoulBanner = false;
    this.showBrokenScreen = false;
    this.playerReactionTime = null;

    // 清空现存恶棍模型
    this.activeOutlaws.forEach((o) => this.rootGroup.remove(o.meshGroup));
    this.activeOutlaws = [];

    // 对峙倒计时：1.8s ~ 3.8s 随机，考验耐心与反射弧
    this.standoffDuration = THREE.MathUtils.randFloat(2.0, 3.8);
    this.standoffTimer = 0;

    // 恶棍反应时间随回合阶梯式缩短：Round 1 1.10s -> Round 8+ 0.32s
    const baseReactionTime = Math.max(0.32, 1.10 - (roundNum - 1) * 0.11);

    const count = this.submode === 'game_a' ? 1 : 2;
    for (let i = 0; i < count; i++) {
      const outlaw = this.createOutlawEntity(i, count, baseReactionTime);
      this.activeOutlaws.push(outlaw);
      this.rootGroup.add(outlaw.meshGroup);
    }

    // 播放经典荒野出场旋律与沙砾风声
    this.audioManager.playGunmanIntro();
    this.audioManager.playWesternWind();

    this.emitHUD();
  }

  /**
   * 创建 5 款截然不同的西部恶棍造型之一
   */
  private createOutlawEntity(index: number, total: number, reactionTime: number): OutlawEntity {
    const group = new THREE.Group();
    const stageZ = this.getStageZ();

    // 初始位置：从屏幕两侧走入
    const spawnX = index === 0 ? -4.5 : 4.5;
    const targetX = total === 1 ? 0 : index === 0 ? -1.35 : 1.35;
    group.position.set(spawnX, -1.6, stageZ);

    const outlawTypes = [
      { name: 'Kid (快枪牛仔)', shirt: 0x38bdf8, vest: 0x9a3412, hat: 0x78350f, hasPoncho: false },
      { name: 'Pancho (墨西哥匪徒)', shirt: 0xfef08a, vest: 0xdc2626, hat: 0xd97706, hasPoncho: true },
      { name: 'Bad Bart (大胡子壮汉)', shirt: 0x475569, vest: 0x1e293b, hat: 0x0f172a, hasPoncho: false },
      { name: 'Doc (冷面杀手)', shirt: 0xf8fafc, vest: 0x18181b, hat: 0x27272a, hasPoncho: false },
      { name: 'Mad Dog (疯狂枪手)', shirt: 0xe11d48, vest: 0x581c87, hat: 0x3f3f46, hasPoncho: false },
    ];
    const typeIdx = (this.round - 1 + index) % outlawTypes.length;
    const cfg = outlawTypes[typeIdx];

    const skinMat = new THREE.MeshStandardMaterial({ color: 0xfbcfe8, roughness: 0.7 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: cfg.shirt, roughness: 0.8, flatShading: true });
    const vestMat = new THREE.MeshStandardMaterial({ color: cfg.vest, roughness: 0.8, flatShading: true });
    const pantsMat = new THREE.MeshStandardMaterial({ color: 0x1e3a8a, roughness: 0.85 });
    const hatMat = new THREE.MeshStandardMaterial({ color: cfg.hat, roughness: 0.8, flatShading: true });
    const bootsMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.9 });
    const eyeFlashMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff });

    const colliders: THREE.Mesh[] = [];

    // 1. 双腿与牛仔靴
    const legLeft = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.24), pantsMat);
    legLeft.position.set(-0.16, 0.35, 0);
    group.add(legLeft);
    colliders.push(legLeft);

    const legRight = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.7, 0.24), pantsMat);
    legRight.position.set(0.16, 0.35, 0);
    group.add(legRight);
    colliders.push(legRight);

    const bootL = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.32), bootsMat);
    bootL.position.set(-0.16, 0.09, 0.04);
    group.add(bootL);

    const bootR = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.18, 0.32), bootsMat);
    bootR.position.set(0.16, 0.09, 0.04);
    group.add(bootR);

    // 2. 躯干与马甲 / 披风
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.8, 0.4), cfg.hasPoncho ? vestMat : shirtMat);
    torso.position.set(0, 1.05, 0);
    group.add(torso);
    colliders.push(torso);

    if (!cfg.hasPoncho) {
      const vestL = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.42), vestMat);
      vestL.position.set(-0.25, 1.05, 0);
      group.add(vestL);

      const vestR = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.75, 0.42), vestMat);
      vestR.position.set(0.25, 1.05, 0);
      group.add(vestR);
    } else {
      // 墨西哥大披肩 (Poncho)
      const poncho = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.65, 0.75, 6), vestMat);
      poncho.position.set(0, 1.02, 0);
      group.add(poncho);
    }

    // 枪带与枪套 (Holster with Gun)
    const beltMat = new THREE.MeshStandardMaterial({ color: 0x713f12 });
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.1, 0.43), beltMat);
    belt.position.set(0, 0.72, 0);
    group.add(belt);

    const holster = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.32, 0.14), beltMat);
    holster.position.set(0.35, 0.62, 0.05);
    group.add(holster);

    // 3. 手臂 (右手随时准备拔枪)
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.2), shirtMat);
    armL.position.set(-0.42, 1.05, 0);
    group.add(armL);

    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.65, 0.2), shirtMat);
    armR.position.set(0.42, 1.02, 0.06);
    armR.rotation.x = -Math.PI / 8; // 悬在枪套上方蓄势待发
    group.add(armR);

    // 4. 头部与面容
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.46, 0.4), skinMat);
    head.position.set(0, 1.62, 0);
    group.add(head);
    colliders.push(head);

    // 眼睛十字闪光粒子 (FIRE 瞬间爆闪)
    const eyeFlashGeo = new THREE.PlaneGeometry(0.38, 0.38);
    const eyeFlash = new THREE.Mesh(eyeFlashGeo, eyeFlashMat);
    eyeFlash.position.set(0, 1.66, 0.22);
    eyeFlash.visible = false;
    group.add(eyeFlash);

    // 5. 牛仔帽 (中弹时可击飞抛起)
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, 1.88, 0);

    const brimGeo = cfg.hasPoncho
      ? new THREE.CylinderGeometry(0.72, 0.72, 0.05, 12)
      : new THREE.CylinderGeometry(0.55, 0.55, 0.04, 10);
    const hatBrim = new THREE.Mesh(brimGeo, hatMat);
    hatGroup.add(hatBrim);

    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.35, 8), hatMat);
    crown.position.y = 0.18;
    hatGroup.add(crown);

    group.add(hatGroup);
    colliders.push(hatBrim);

    const hitTypes: ('hat_fly' | 'tumble_back' | 'spin_drop')[] = ['hat_fly', 'tumble_back', 'spin_drop'];
    const hitType = hitTypes[Math.floor(Math.random() * hitTypes.length)];

    return {
      id: `outlaw_${Date.now()}_${index}`,
      name: cfg.name,
      meshGroup: group,
      colliderMeshes: colliders,
      hatMesh: hatBrim,
      eyeFlashMesh: eyeFlash,
      reactionTime,
      state: 'walking',
      targetPos: new THREE.Vector3(targetX, -1.6, stageZ),
      walkTimer: 0,
      hitTimer: 0,
      hitType,
      isHit: false,
    };
  }

  // ==========================================================================
  // Game C: 西部酒馆 5 窗 1 门攻防系统 (Saloon Gang)
  // ==========================================================================

  private buildSaloonFacade(): void {
    const stageZ = this.getStageZ();
    this.saloonGroup.position.set(0, -1.5, stageZ);

    while (this.saloonGroup.children.length > 0) {
      this.saloonGroup.remove(this.saloonGroup.children[0]);
    }

    const woodPlankMat = new THREE.MeshStandardMaterial({
      color: 0x92400e,
      roughness: 0.9,
      flatShading: true,
    });
    const darkWoodMat = new THREE.MeshStandardMaterial({
      color: 0x451a03,
      roughness: 0.95,
    });
    const shutterMat = new THREE.MeshStandardMaterial({
      color: 0xb45309,
      roughness: 0.85,
    });

    // 1. 酒馆主体两层木墙 (双层带大门与窗洞)
    const facade = new THREE.Mesh(new THREE.BoxGeometry(7.5, 4.2, 0.3), woodPlankMat);
    facade.position.set(0, 2.0, 0);
    this.saloonGroup.add(facade);

    // 房顶招牌 (SALOON)
    const roofSign = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.8, 0.25), darkWoodMat);
    roofSign.position.set(0, 4.3, 0.1);
    this.saloonGroup.add(roofSign);

    // 屋檐遮雨棚
    const awning = new THREE.Mesh(new THREE.BoxGeometry(7.8, 0.2, 0.9), darkWoodMat);
    awning.position.set(0, 2.7, 0.4);
    awning.rotation.x = 0.2;
    this.saloonGroup.add(awning);

    // 2. 构建 5 扇窗户与 1 个双开大门
    this.saloonWindows = [];
    const windowDefs = [
      { id: 0, x: -2.3, y: 3.4 }, // 二楼左窗
      { id: 1, x: 0.0, y: 3.4 },  // 二楼中窗
      { id: 2, x: 2.3, y: 3.4 },  // 二楼右窗
      { id: 3, x: -2.3, y: 1.3 }, // 一楼左窗
      { id: 4, x: 2.3, y: 1.3 },  // 一楼右窗
      { id: 5, x: 0.0, y: 0.7 },  // 一楼大门 (双开门)
    ];

    windowDefs.forEach((w) => {
      const isDoor = w.id === 5;
      const wGroup = new THREE.Group();
      wGroup.position.set(w.x, w.y, 0.16);

      // 窗框 / 门框
      const frameGeo = isDoor
        ? new THREE.BoxGeometry(1.4, 1.8, 0.1)
        : new THREE.BoxGeometry(1.2, 1.2, 0.1);
      const frame = new THREE.Mesh(frameGeo, darkWoodMat);
      wGroup.add(frame);

      // 黑色内腔背板 (探身前为暗处)
      const blackBack = new THREE.Mesh(
        isDoor ? new THREE.PlaneGeometry(1.2, 1.6) : new THREE.PlaneGeometry(1.0, 1.0),
        new THREE.MeshBasicMaterial({ color: 0x09090b })
      );
      blackBack.position.z = 0.02;
      wGroup.add(blackBack);

      // 左右两扇百叶木窗扇 (可推开与关闭)
      const shutterGeo = isDoor
        ? new THREE.BoxGeometry(0.58, 1.5, 0.04)
        : new THREE.BoxGeometry(0.48, 0.96, 0.04);

      const shutterL = new THREE.Mesh(shutterGeo, shutterMat);
      shutterL.position.set(-0.28, 0, 0.06);
      wGroup.add(shutterL);

      const shutterR = new THREE.Mesh(shutterGeo, shutterMat);
      shutterR.position.set(0.28, 0, 0.06);
      wGroup.add(shutterR);

      this.saloonGroup.add(wGroup);

      this.saloonWindows.push({
        id: w.id,
        position: new THREE.Vector3(w.x, w.y - 1.5, stageZ + 0.2),
        shutterLeft: shutterL,
        shutterRight: shutterR,
        isOpen: false,
        occupant: null,
        timer: 0,
        maxTime: 1.2,
      });
    });

    this.rootGroup.add(this.saloonGroup);
  }

  private startSaloonRound(roundNum: number): void {
    this.round = roundNum;
    this.shotsLeft = 3;
    this.currentStage = 'saloon';
    this.saloonDefeatedCount = 0;
    this.saloonSpawnTimer = 0.8;
    this.showFireBanner = false;
    this.showFoulBanner = false;
    this.showBrokenScreen = false;

    this.audioManager.playWesternWind();
    this.emitHUD();
  }

  // ==========================================================================
  // 开火射击判定 (Quick-Draw Shoot & 犯规判定)
  // ==========================================================================

  public shoot(raycaster: THREE.Raycaster): WildGunmanShootResult {
    if (!this.isRunning) {
      return { fired: false, hit: false, reason: 'inactive' };
    }

    // 扣除 1 发左轮子弹并播放重型左轮轰鸣
    this.shotsLeft--;
    this.audioManager.playRevolverShot();

    // 1. Game A & B: 对峙期提前开枪判定为犯规 (FOUL!!)
    if (this.submode !== 'game_c' && this.currentStage === 'standoff') {
      this.triggerFoul();
      return { fired: true, hit: false, reason: 'foul' };
    }

    let didHit = false;
    const ray = raycaster.ray;

    // 2. 决斗模式 (Game A & B) 命中判定
    if (this.submode !== 'game_c' && this.currentStage === 'draw') {
      const now = performance.now();
      const reactionSec = (now - this.fireSignalTime) / 1000;

      for (const outlaw of this.activeOutlaws) {
        if (outlaw.state !== 'fire_ready') continue;

        // 智能光线交汇 + 距离容差判定
        let isAimingAtOutlaw = false;
        const intersects = raycaster.intersectObjects(outlaw.colliderMeshes, false);
        if (intersects.length > 0) {
          isAimingAtOutlaw = true;
        } else {
          const outlawPos = outlaw.meshGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0));
          const toTarget = new THREE.Vector3().subVectors(outlawPos, ray.origin);
          if (ray.direction.dot(toTarget) > 0) {
            const distFromCam = toTarget.length();
            const distToRay = ray.distanceToPoint(outlawPos);
            const lockTolerance = Math.max(0.75, 0.42 + distFromCam * 0.055);
            if (distToRay <= lockTolerance) {
              isAimingAtOutlaw = true;
            }
          }
        }

        if (isAimingAtOutlaw) {
          this.hitOutlawInDuel(outlaw, reactionSec);
          didHit = true;
          break;
        }
      }
    }

    // 3. 酒馆乱斗模式 (Game C) 命中判定
    if (this.submode === 'game_c') {
      // 优先检查是否射中空中的炸药桶
      for (let i = this.activeDynamites.length - 1; i >= 0; i--) {
        const dyn = this.activeDynamites[i];
        if (dyn.isHit) continue;

        let hitDyn = false;
        const intersects = raycaster.intersectObject(dyn.colliderMesh, false);
        if (intersects.length > 0) {
          hitDyn = true;
        } else {
          const toTarget = new THREE.Vector3().subVectors(dyn.position, ray.origin);
          if (ray.direction.dot(toTarget) > 0) {
            const dist = ray.distanceToPoint(dyn.position);
            if (dist <= 0.85) hitDyn = true;
          }
        }

        if (hitDyn) {
          this.hitDynamite(dyn, i);
          didHit = true;
          return { fired: true, hit: true };
        }
      }

      // 检查窗口中探身的匪徒
      for (const w of this.saloonWindows) {
        if (!w.isOpen || !w.occupant || w.occupant.isHit) continue;
        const outlaw = w.occupant;

        let hitBandit = false;
        const intersects = raycaster.intersectObjects(outlaw.colliderMeshes, false);
        if (intersects.length > 0) {
          hitBandit = true;
        } else {
          const pos = outlaw.meshGroup.position.clone().add(new THREE.Vector3(0, 0.9, 0));
          const toTarget = new THREE.Vector3().subVectors(pos, ray.origin);
          if (ray.direction.dot(toTarget) > 0) {
            const dist = ray.distanceToPoint(pos);
            if (dist <= 0.8) hitBandit = true;
          }
        }

        if (hitBandit) {
          this.hitSaloonOutlaw(w);
          didHit = true;
          break;
        }
      }
    }

    // 若 3 发子弹耗尽且仍未击落目标
    if (this.shotsLeft <= 0 && !didHit) {
      if (this.submode !== 'game_c' && this.currentStage === 'draw') {
        this.triggerPlayerShot('3发子弹打空，被恶棍反杀！');
      }
    }

    return { fired: true, hit: didHit };
  }

  /**
   * 犯规抢跑 (FOUL!!)：对峙期抢先开枪，恶棍光速反击
   */
  private triggerFoul(): void {
    this.currentStage = 'foul';
    this.showFoulBanner = true;
    this.audioManager.playGunmanFoul();
    this.emitHUD();

    // 恶棍立即射击玩家
    setTimeout(() => {
      this.activeOutlaws.forEach((o) => {
        o.meshGroup.rotation.y = 0;
        this.audioManager.playRevolverShot();
      });
      this.triggerPlayerShot('FOUL!! 提前抢跑开枪！');
    }, 450);
  }

  /**
   * 成功击中决斗恶棍
   */
  private hitOutlawInDuel(outlaw: OutlawEntity, reactionSec: number): void {
    outlaw.isHit = true;
    outlaw.state = 'hit';
    outlaw.hitTimer = 0;
    this.playerReactionTime = reactionSec;

    // 帽子向上高高飞旋抛出
    if (outlaw.hatMesh) {
      const flyVel = new THREE.Vector3(
        THREE.MathUtils.randFloat(-1.2, 1.2),
        THREE.MathUtils.randFloat(4.5, 6.0),
        THREE.MathUtils.randFloat(-1.0, 1.0)
      );
      outlaw.hatMesh.userData = { vel: flyVel, flying: true };
    }

    // 恶棍滑稽倒地动画
    outlaw.meshGroup.rotation.x = -Math.PI / 4;

    this.audioManager.playGunmanWinFanfare();

    // 计算拔枪胜出得分：反应越快分数越高
    const bonus = Math.max(100, Math.round((outlaw.reactionTime - reactionSec) * 5000));
    const scoreGained = 1000 + bonus;
    this.score += scoreGained;

    // 检查是否本波所有恶棍都已被击毙 (Game B 双匪)
    const allDefeated = this.activeOutlaws.every((o) => o.isHit);
    if (allDefeated) {
      this.currentStage = 'won';
      this.showFireBanner = false;
      this.emitHUD();

      // 回合过关！
      setTimeout(() => {
        if (this.onRoundClear) {
          this.onRoundClear(this.round, scoreGained);
        }
        this.startDuelRound(this.round + 1);
      }, 2000);
    } else {
      this.emitHUD();
    }
  }

  /**
   * 击中酒馆窗户探身的匪徒
   */
  private hitSaloonOutlaw(w: SaloonWindow): void {
    if (!w.occupant) return;
    w.occupant.isHit = true;
    this.audioManager.playGunmanWinFanfare();

    this.score += 600;
    this.saloonDefeatedCount++;

    // 匪徒向后倒下，窗户关闭
    w.occupant.meshGroup.position.z -= 0.6;
    setTimeout(() => {
      this.closeSaloonWindow(w);
    }, 400);

    // 累计击倒 8 个匪徒过关进入下一关
    if (this.saloonDefeatedCount >= 8) {
      setTimeout(() => {
        if (this.onRoundClear) {
          this.onRoundClear(this.round, 2000);
        }
        this.startSaloonRound(this.round + 1);
      }, 1500);
    }

    this.emitHUD();
  }

  /**
   * 击中空中的炸药桶
   */
  private hitDynamite(dyn: DynamiteEntity, index: number): void {
    dyn.isHit = true;
    this.audioManager.playDynamiteExplosion();
    this.score += 1500;

    // 移除模型
    this.rootGroup.remove(dyn.mesh);
    dyn.mesh.traverse((n) => {
      if (n instanceof THREE.Mesh) {
        n.geometry.dispose();
        if (Array.isArray(n.material)) n.material.forEach((m) => m.dispose());
        else n.material.dispose();
      }
    });
    this.activeDynamites.splice(index, 1);
    this.emitHUD();
  }

  /**
   * 玩家被恶棍击中 / 决斗超时 / 抢跑中弹
   */
  private triggerPlayerShot(_reason: string): void {
    this.currentStage = 'lost';
    this.lives--;
    this.showFireBanner = false;
    this.showBrokenScreen = true;

    // 玻璃碎屏音效与受击红光
    this.audioManager.playGlassShatter();
    this.emitHUD();

    if (this.lives <= 0) {
      // 3 条命全部耗尽，GAME OVER
      setTimeout(() => {
        this.isRunning = false;
        this.audioManager.playNesGameOver();
        if (this.onGameOver) {
          this.onGameOver(this.score, this.round);
        }
      }, 1800);
    } else {
      // 扣除 1 条命后，重新开始当前回合决斗
      setTimeout(() => {
        this.showBrokenScreen = false;
        if (this.submode === 'game_c') {
          this.startSaloonRound(this.round);
        } else {
          this.startDuelRound(this.round);
        }
      }, 2200);
    }
  }

  // ==========================================================================
  // 实时检测十字准星是否锁定目标 (变红提示)
  // ==========================================================================

  public checkTargetLock(raycaster: THREE.Raycaster): boolean {
    if (!this.isRunning) return false;
    const ray = raycaster.ray;

    // 1. 决斗模式 (Game A & B): 处于拔枪对决期方可锁定变红
    if (this.submode !== 'game_c') {
      if (this.currentStage !== 'draw') return false;
      for (const o of this.activeOutlaws) {
        if (o.state !== 'fire_ready') continue;
        const pos = o.meshGroup.position.clone().add(new THREE.Vector3(0, 1.2, 0));
        const toTarget = new THREE.Vector3().subVectors(pos, ray.origin);
        if (ray.direction.dot(toTarget) <= 0) continue;
        const distFromCam = toTarget.length();
        const distToRay = ray.distanceToPoint(pos);
        if (distToRay <= Math.max(0.75, 0.45 + distFromCam * 0.055)) {
          return true;
        }
      }
      return false;
    }

    // 2. 酒馆模式 (Game C): 锁定窗口匪徒或空中炸药桶
    for (const dyn of this.activeDynamites) {
      if (dyn.isHit) continue;
      const toTarget = new THREE.Vector3().subVectors(dyn.position, ray.origin);
      if (ray.direction.dot(toTarget) <= 0) continue;
      if (ray.distanceToPoint(dyn.position) <= 0.85) return true;
    }

    for (const w of this.saloonWindows) {
      if (!w.isOpen || !w.occupant || w.occupant.isHit) continue;
      const pos = w.occupant.meshGroup.position.clone().add(new THREE.Vector3(0, 0.9, 0));
      const toTarget = new THREE.Vector3().subVectors(pos, ray.origin);
      if (ray.direction.dot(toTarget) <= 0) continue;
      if (ray.distanceToPoint(pos) <= 0.8) return true;
    }

    return false;
  }

  // ==========================================================================
  // 主逻辑帧更新循环 (行走、对峙计时、拔枪信号、下坠与攻击计时)
  // ==========================================================================

  public update(delta: number): void {
    if (!this.isRunning) return;

    if (this.submode !== 'game_c') {
      this.updateDuelLogic(delta);
    } else {
      this.updateSaloonLogic(delta);
    }

    // 更新空中被击飞的帽子
    this.activeOutlaws.forEach((o) => {
      if (o.hatMesh && o.hatMesh.userData.flying) {
        const vel = o.hatMesh.userData.vel as THREE.Vector3;
        vel.y -= 9.8 * delta;
        o.hatMesh.position.addScaledVector(vel, delta);
        o.hatMesh.rotation.x += 12 * delta;
        o.hatMesh.rotation.z += 10 * delta;
      }
    });

    // 更新空中炸药桶物理抛物线
    for (let i = this.activeDynamites.length - 1; i >= 0; i--) {
      const dyn = this.activeDynamites[i];
      dyn.velocity.y -= dyn.gravity * delta;
      dyn.position.addScaledVector(dyn.velocity, delta);
      dyn.mesh.position.copy(dyn.position);
      dyn.mesh.rotation.x += dyn.rotationSpeed.x * delta;
      dyn.mesh.rotation.y += dyn.rotationSpeed.y * delta;

      // 落地爆炸造成伤害
      if (dyn.position.y <= -1.6) {
        this.hitDynamite(dyn, i);
        this.triggerPlayerShot('未击碎飞天炸药桶，被炸伤！');
      }
    }
  }

  private updateDuelLogic(delta: number): void {
    // 1. 恶棍进场走步阶段
    let allInPosition = true;
    this.activeOutlaws.forEach((o) => {
      if (o.state === 'walking') {
        o.walkTimer += delta * 4.0;
        const dist = o.meshGroup.position.distanceTo(o.targetPos);
        if (dist > 0.08) {
          allInPosition = false;
          o.meshGroup.position.lerp(o.targetPos, delta * 3.5);
          // 走动颠簸动画
          o.meshGroup.position.y = -1.6 + Math.abs(Math.sin(o.walkTimer)) * 0.08;
        } else {
          o.meshGroup.position.copy(o.targetPos);
          o.meshGroup.position.y = -1.6;
          o.state = 'standoff';
        }
      }
    });

    // 2. 对峙禁止开火计时
    if (this.currentStage === 'standoff' && allInPosition) {
      this.standoffTimer += delta;
      if (this.standoffTimer >= this.standoffDuration) {
        // 瞬间触发拔枪 FIRE 信号！
        this.triggerFireSignal();
      }
    }

    // 3. 拔枪对决判定计时
    if (this.currentStage === 'draw') {
      const now = performance.now();
      const elapsedSec = (now - this.fireSignalTime) / 1000;

      // 检查是否有恶棍已准备好开火反杀玩家
      for (const o of this.activeOutlaws) {
        if (o.state === 'fire_ready' && !o.isHit) {
          if (elapsedSec >= o.reactionTime) {
            // 恶棍拔枪开火反杀！
            o.state = 'shooting';
            this.audioManager.playRevolverShot();
            this.triggerPlayerShot(`拔枪超时！恶棍用时 ${o.reactionTime.toFixed(2)}s 先拔得头筹！`);
            break;
          }
        }
      }
    }
  }

  private triggerFireSignal(): void {
    this.currentStage = 'draw';
    this.showFireBanner = true;
    this.fireSignalTime = performance.now();

    // 恶棍眼睛爆出青白色十字闪光 + 拔枪蓄势姿态
    this.activeOutlaws.forEach((o) => {
      o.state = 'fire_ready';
      if (o.eyeFlashMesh) o.eyeFlashMesh.visible = true;
    });

    // 播放高亢急促双音哨声
    this.audioManager.playGunmanFireCall();
    this.emitHUD();

    // 闪光 350ms 后隐藏
    setTimeout(() => {
      this.activeOutlaws.forEach((o) => {
        if (o.eyeFlashMesh) o.eyeFlashMesh.visible = false;
      });
    }, 350);
  }

  private updateSaloonLogic(delta: number): void {
    this.saloonSpawnTimer += delta;
    const interval = Math.max(1.2, 2.8 - (this.round - 1) * 0.2);

    // 随机选择一扇关闭的窗户探身
    if (this.saloonSpawnTimer >= interval) {
      this.saloonSpawnTimer = 0;
      const closedWindows = this.saloonWindows.filter((w) => !w.isOpen);
      if (closedWindows.length > 0) {
        const targetWin = closedWindows[Math.floor(Math.random() * closedWindows.length)];
        this.openSaloonWindow(targetWin);

        // 20% 概率二楼窗户投掷炸药桶
        if (targetWin.id <= 2 && Math.random() < 0.25) {
          this.spawnDynamite(targetWin.position);
        }
      }
    }

    // 刷新各开启窗户中匪徒攻击倒计时
    this.saloonWindows.forEach((w) => {
      if (w.isOpen && w.occupant && !w.occupant.isHit) {
        w.timer += delta;
        if (w.timer >= w.maxTime) {
          // 窗户匪徒开火攻击玩家！
          this.audioManager.playRevolverShot();
          this.triggerPlayerShot('酒馆匪徒伏击开枪！');
          this.closeSaloonWindow(w);
        }
      }
    });
  }

  private openSaloonWindow(w: SaloonWindow): void {
    w.isOpen = true;
    w.timer = 0;
    w.maxTime = Math.max(0.75, 1.45 - (this.round - 1) * 0.08);

    // 百叶窗推开动画
    w.shutterLeft.rotation.y = -Math.PI / 1.8;
    w.shutterRight.rotation.y = Math.PI / 1.8;
    this.audioManager.playSaloonOpen();

    // 在窗口生成探身匪徒
    const outlaw = this.createOutlawEntity(w.id, 1, w.maxTime);
    outlaw.state = 'fire_ready';
    outlaw.meshGroup.position.copy(w.position);
    this.saloonGroup.add(outlaw.meshGroup);
    w.occupant = outlaw;
  }

  private closeSaloonWindow(w: SaloonWindow): void {
    w.isOpen = false;
    w.shutterLeft.rotation.y = 0;
    w.shutterRight.rotation.y = 0;

    if (w.occupant) {
      this.saloonGroup.remove(w.occupant.meshGroup);
      w.occupant = null;
    }
  }

  private spawnDynamite(pos: THREE.Vector3): void {
    const group = new THREE.Group();
    group.position.copy(pos);

    const barrelMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.7 });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.55, 8), barrelMat);
    group.add(mesh);

    // 引信
    const fuse = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.2, 4),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    fuse.position.y = 0.35;
    group.add(fuse);

    const velocity = new THREE.Vector3(
      THREE.MathUtils.randFloat(-1.2, 1.2),
      THREE.MathUtils.randFloat(3.5, 5.0),
      THREE.MathUtils.randFloat(1.5, 2.5)
    );

    const dyn: DynamiteEntity = {
      mesh: group,
      colliderMesh: mesh,
      position: group.position,
      velocity,
      gravity: 5.5,
      rotationSpeed: new THREE.Vector3(5, 4, 3),
      isHit: false,
      life: 4.0,
    };

    this.rootGroup.add(group);
    this.activeDynamites.push(dyn);
  }

  private emitHUD(): void {
    if (this.onHUDUpdate) {
      const currentEnemyTime =
        this.activeOutlaws.length > 0 ? this.activeOutlaws[0].reactionTime : 0.8;

      this.onHUDUpdate({
        submode: this.submode,
        round: this.round,
        enemyTime: currentEnemyTime,
        playerTime: this.playerReactionTime,
        lives: this.lives,
        score: this.score,
        state: this.currentStage,
        fireBanner: this.showFireBanner,
        foulBanner: this.showFoulBanner,
        brokenScreen: this.showBrokenScreen,
        isGameOver: this.lives <= 0,
      });
    }
  }

  public getSubmode(): GunmanSubmode {
    return this.submode;
  }

  public getShotsLeft(): number {
    return this.shotsLeft;
  }

  public clear(): void {
    this.isRunning = false;
    this.activeOutlaws.forEach((o) => this.rootGroup.remove(o.meshGroup));
    this.activeOutlaws = [];

    this.activeDynamites.forEach((d) => this.rootGroup.remove(d.mesh));
    this.activeDynamites = [];

    while (this.rootGroup.children.length > 0) {
      const c = this.rootGroup.children[0];
      this.rootGroup.remove(c);
      c.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
    }

    this.saloonWindows = [];
    this.showFireBanner = false;
    this.showFoulBanner = false;
    this.showBrokenScreen = false;
  }
}
