/**
 * AR-Shooter - FC 经典打鸭子与飞盘模式 (duckHunt.ts)
 * 100% 还原 1984 年任天堂 NES 原版规则：
 * 1. 正前方黄金视野舞台 (Z = -8m, 草丛与小树前景遮挡，无需 360 度转身)
 * 2. 回合结构 (Round 10个目标) 与 3 发子弹硬核限制 (shotsLeft = 3)
 * 3. 5.5秒逃脱 (FLY AWAY) 判定与黑/蓝/红三色野鸭扑翼 AI
 * 4. 经典猎犬 (Hound Dog) 3D 动画：开局跳入草丛、捕获举鸭庆祝、空枪捂嘴魔性嘲笑
 * 5. Game C 双向飞盘射击 (Clay Shooting) 抛物线远飞
 * 6. 原版算分表、严格合格线 (Pass Line) 与满贯 PERFECT 奖励
 */

import * as THREE from 'three';
import { AudioManager } from './audio';

export type DuckHuntSubmode = 'game_a' | 'game_b' | 'game_c';
export type DuckColor = 'black' | 'blue' | 'red';
export type DuckState = 'flying' | 'hit_freeze' | 'falling' | 'dead' | 'fleeing_up';

export interface DuckEntity {
  id: string;
  type: 'duck';
  color: DuckColor;
  meshGroup: THREE.Group;
  colliderMeshes: THREE.Mesh[];
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  state: DuckState;
  stateTimer: number;
  wingLeft: THREE.Mesh;
  wingRight: THREE.Mesh;
  flapCycle: number;
  scoreValue: number;
  isHit: boolean;
}

export interface ClayEntity {
  id: string;
  type: 'clay';
  meshGroup: THREE.Group;
  colliderMeshes: THREE.Mesh[];
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  gravity: number;
  state: 'flying' | 'broken' | 'dead';
  scoreValue: number;
  isHit: boolean;
}

export interface DuckHuntHUDState {
  round: number;
  shotsLeft: number;
  currentScore: number;
  targetResults: ('pending' | 'active' | 'hit' | 'miss')[];
  passLine: number;
  submode: DuckHuntSubmode;
  isFlyAway: boolean;
  isRoundComplete: boolean;
  isGameOver: boolean;
}

export class DuckHuntEngine {
  private scene: THREE.Scene;
  private camera: THREE.Camera;
  private audioManager: AudioManager;
  private rootGroup = new THREE.Group();

  private submode: DuckHuntSubmode = 'game_a';
  private round: number = 1;
  private totalScore: number = 0;
  private waveIndex: number = 0; // 0..9 (Game A) 或 0..4 (Game B/C)
  private totalWaves: number = 10;
  private targetsPerWave: number = 1;
  private shotsLeft: number = 3;
  private waveTimer: number = 0;
  private isWaveActive: boolean = false;
  private isFlyAway: boolean = false;

  // 10 个目标的命中状态记录
  private targetResults: ('pending' | 'active' | 'hit' | 'miss')[] = [];
  private roundHitCount: number = 0;

  // 当前波次的活动目标
  private activeDucks: DuckEntity[] = [];
  private activeClays: ClayEntity[] = [];

  // 猎犬状态与部件引用
  private dogGroup = new THREE.Group();
  private dogState: 'hidden' | 'intro' | 'celebrating' | 'laughing' = 'hidden';
  private dogEarLeft?: THREE.Mesh;
  private dogEarRight?: THREE.Mesh;
  private dogPaws?: THREE.Group;
  private dogHead?: THREE.Mesh;
  private caughtDucksGroup?: THREE.Group;
  private dogTargetY: number = -2.2;
  private dogCurrentY: number = -2.2;

  // 飞盘碎片系统
  private debrisMeshes: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number }[] = [];

  // 回调
  private onHUDUpdate?: (state: DuckHuntHUDState) => void;
  private onGameOver?: (score: number, round: number) => void;
  private onRoundClear?: (round: number, bonus: number) => void;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    audioManager: AudioManager,
    callbacks?: {
      onHUDUpdate?: (state: DuckHuntHUDState) => void;
      onGameOver?: (score: number, round: number) => void;
      onRoundClear?: (round: number, bonus: number) => void;
    }
  ) {
    this.scene = scene;
    this.camera = camera;
    this.audioManager = audioManager;
    this.onHUDUpdate = callbacks?.onHUDUpdate;
    this.onGameOver = callbacks?.onGameOver;
    this.onRoundClear = callbacks?.onRoundClear;

    this.scene.add(this.rootGroup);
    this.rootGroup.add(this.dogGroup);
  }

  // ==========================================================================
  // 模式启动与正前方固定舞台初始化
  // ==========================================================================

  public start(submode: DuckHuntSubmode): void {
    this.clear();
    this.submode = submode;
    this.round = 1;
    this.totalScore = 0;
    this.targetsPerWave = submode === 'game_a' ? 1 : 2;
    this.totalWaves = submode === 'game_a' ? 10 : 5;

    // 构建正前方前景草丛舞台与标志性大树
    this.buildForegroundStage();
    this.buildDogModel();

    // 启动第 1 回合
    this.startRound(1);
  }

  private startRound(roundNum: number): void {
    this.round = roundNum;
    this.waveIndex = 0;
    this.roundHitCount = 0;
    this.targetResults = Array(10).fill('pending');

    this.emitHUD();

    // 回合开局动画：猎犬闻嗅跑过草丛并跳入其中 (Game A & B)
    if (this.submode !== 'game_c') {
      this.triggerDogIntro(() => {
        this.startNextWave();
      });
    } else {
      setTimeout(() => this.startNextWave(), 800);
    }
  }

  /**
   * 构建正前方绿色草丛遮挡与小树舞台 (Spawn Framing)
   * 固定在相机正前方 Z = -8m 处，保证舒适直视，无需大角度旋转
   */
  private buildForegroundStage(): void {
    const stageGroup = new THREE.Group();
    stageGroup.position.set(0, -1.5, -8.0);

    // 1. 经典 NES 翠绿锯齿草丛带 (Grass Thicket)
    const grassMat = new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      roughness: 0.8,
      flatShading: true,
    });
    const darkGrassMat = new THREE.MeshStandardMaterial({
      color: 0x15803d,
      roughness: 0.9,
    });

    for (let i = -7; i <= 7; i++) {
      const bladeHeight = THREE.MathUtils.randFloat(0.75, 1.15);
      const bladeGeo = new THREE.ConeGeometry(0.35, bladeHeight, 4);
      const blade = new THREE.Mesh(bladeGeo, i % 2 === 0 ? grassMat : darkGrassMat);
      blade.position.set(i * 0.75 + (Math.random() - 0.5) * 0.2, bladeHeight * 0.5, (Math.random() - 0.5) * 0.4);
      blade.rotation.y = (Math.random() - 0.5) * 0.4;
      stageGroup.add(blade);
    }

    // 草丛基底土层
    const baseGeo = new THREE.BoxGeometry(12.5, 0.4, 1.2);
    const baseMat = new THREE.MeshStandardMaterial({ color: 0x854d0e, roughness: 0.95 });
    const base = new THREE.Mesh(baseGeo, baseMat);
    base.position.set(0, 0.2, 0);
    stageGroup.add(base);

    // 2. 左侧经典橡树 (Tree on the left)
    const treeTrunkGeo = new THREE.CylinderGeometry(0.28, 0.45, 4.2, 6);
    const treeTrunkMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.9 });
    const trunk = new THREE.Mesh(treeTrunkGeo, treeTrunkMat);
    trunk.position.set(-4.5, 2.1, 0.2);
    stageGroup.add(trunk);

    const foliageMat = new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.75, flatShading: true });
    for (let l = 0; l < 3; l++) {
      const foliage = new THREE.Mesh(new THREE.DodecahedronGeometry(1.2 - l * 0.2, 1), foliageMat);
      foliage.position.set(-4.5 + (l % 2 === 0 ? 0.2 : -0.2), 3.4 + l * 0.8, 0.2);
      stageGroup.add(foliage);
    }

    this.rootGroup.add(stageGroup);
  }

  // ==========================================================================
  // 波次推进逻辑 (Wave Lifecycle)
  // ==========================================================================

  private startNextWave(): void {
    if (this.waveIndex >= this.totalWaves) {
      // 本回合全部 10 个目标结束，结算 Pass Line
      this.finishRound();
      return;
    }

    this.shotsLeft = 3;
    this.waveTimer = 0;
    this.isWaveActive = true;
    this.isFlyAway = false;
    this.activeDucks = [];
    this.activeClays = [];

    // 标记当前波次目标为 active 闪烁态
    const targetStartIndex = this.waveIndex * this.targetsPerWave;
    for (let i = 0; i < this.targetsPerWave; i++) {
      this.targetResults[targetStartIndex + i] = 'active';
    }
    this.emitHUD();

    if (this.submode === 'game_c') {
      // Game C: 抛掷 2 个飞盘
      this.spawnClayPigeon(-1.4);
      this.spawnClayPigeon(1.4);
      this.audioManager.playNesClayLaunch();
    } else {
      // Game A/B: 生成 1 只或 2 只野鸭
      const duckCount = this.targetsPerWave;
      for (let i = 0; i < duckCount; i++) {
        const offsetSign = i === 0 ? -1 : 1;
        this.spawnDuck(offsetSign);
      }
      this.audioManager.playNesQuack();
    }
  }

  /**
   * 生成野鸭 (黑鸭 / 蓝鸭 / 红鸭，各具速度与飞行动画)
   */
  private spawnDuck(offsetSign: number = 1): void {
    // 随回合提升，红鸭与蓝鸭概率提升
    const rand = Math.random();
    const color: DuckColor =
      rand < 0.45 ? 'black' : rand < 0.8 ? 'blue' : 'red';

    // 速度基数
    const speedMult = color === 'black' ? 1.0 : color === 'blue' ? 1.35 : 1.75;
    const roundSpeedFactor = 1.0 + (this.round - 1) * 0.06;
    const speed = THREE.MathUtils.randFloat(3.2, 4.2) * speedMult * roundSpeedFactor;

    // 算分表数值
    let scoreVal = 500;
    if (this.round <= 5) {
      scoreVal = color === 'black' ? 500 : color === 'blue' ? 1000 : 1500;
    } else if (this.round <= 10) {
      scoreVal = color === 'black' ? 800 : color === 'blue' ? 1600 : 2400;
    } else {
      scoreVal = color === 'black' ? 1000 : color === 'blue' ? 2000 : 3000;
    }

    const group = new THREE.Group();
    // 从草丛后方腾空飞起 (Y = -1.2, Z = -8.0)
    const startX = THREE.MathUtils.randFloat(0.5, 2.5) * offsetSign;
    group.position.set(startX, -1.2, -8.0);

    // 初始朝向斜上方飞出
    const initialDir = new THREE.Vector3(
      offsetSign * THREE.MathUtils.randFloat(0.4, 0.8),
      THREE.MathUtils.randFloat(0.8, 1.2),
      THREE.MathUtils.randFloat(-0.2, 0.2)
    ).normalize();
    const velocity = initialDir.multiplyScalar(speed);

    // 构建野鸭低多边形网格
    const { colliders, wingL, wingR } = this.buildDuckMesh(group, color);

    const duck: DuckEntity = {
      id: `duck_${Date.now()}_${Math.random()}`,
      type: 'duck',
      color,
      meshGroup: group,
      colliderMeshes: colliders,
      position: group.position,
      velocity,
      speed,
      state: 'flying',
      stateTimer: 0,
      wingLeft: wingL,
      wingRight: wingR,
      flapCycle: Math.random() * Math.PI,
      scoreValue: scoreVal,
      isHit: false,
    };

    group.userData = { duckEntity: duck };
    this.rootGroup.add(group);
    this.activeDucks.push(duck);
  }

  /**
   * 生成飞盘 (Game C: 向远方抛射飞向 Z = -24m)
   */
  private spawnClayPigeon(sideOffset: number): void {
    const group = new THREE.Group();
    // 从脚前抛出
    group.position.set(sideOffset * 0.8, -1.2, -3.2);

    const clayGeo = new THREE.CylinderGeometry(0.24, 0.26, 0.05, 16);
    const clayMat = new THREE.MeshStandardMaterial({
      color: 0xf97316, // 亮橙色飞盘
      roughness: 0.4,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(clayGeo, clayMat);
    mesh.rotation.x = Math.PI / 4;
    group.add(mesh);

    // 橘白相间条纹顶盖
    const topStripeGeo = new THREE.CylinderGeometry(0.14, 0.15, 0.06, 16);
    const stripeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const stripe = new THREE.Mesh(topStripeGeo, stripeMat);
    group.add(stripe);

    const roundSpeedFactor = 1.0 + (this.round - 1) * 0.06;
    const forwardSpd = THREE.MathUtils.randFloat(11, 15) * roundSpeedFactor;
    const upSpd = THREE.MathUtils.randFloat(4.5, 6.5);
    const sideSpd = sideOffset * THREE.MathUtils.randFloat(1.2, 2.4);

    const velocity = new THREE.Vector3(sideSpd, upSpd, -forwardSpd);

    const scoreVal = this.round <= 5 ? 1000 : this.round <= 10 ? 1500 : 2000;

    const clay: ClayEntity = {
      id: `clay_${Date.now()}_${Math.random()}`,
      type: 'clay',
      meshGroup: group,
      colliderMeshes: [mesh],
      position: group.position,
      velocity,
      gravity: 5.5,
      state: 'flying',
      scoreValue: scoreVal,
      isHit: false,
    };

    group.userData = { clayEntity: clay };
    this.rootGroup.add(group);
    this.activeClays.push(clay);
  }

  // ==========================================================================
  // 开火射击判定 (Zapper Light Gun & 3-Shot Limit)
  // ==========================================================================

  public shoot(raycaster: THREE.Raycaster): boolean {
    if (!this.isWaveActive) return false;
    if (this.shotsLeft <= 0) return false;

    // 扣除 1 发子弹并播放 8-bit 复古光线枪枪声
    this.shotsLeft--;
    this.audioManager.playNesGunshot();
    this.emitHUD();

    let didHit = false;

    if (this.submode === 'game_c') {
      // 飞盘射击判定
      const candidateMeshes: THREE.Mesh[] = [];
      this.activeClays.forEach((c) => {
        if (c.state === 'flying') {
          candidateMeshes.push(...c.colliderMeshes);
        }
      });

      const intersects = raycaster.intersectObjects(candidateMeshes, false);
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const targetClay = this.activeClays.find((c) => c.colliderMeshes.includes(hitMesh));
        if (targetClay && targetClay.state === 'flying') {
          this.hitClay(targetClay);
          didHit = true;
        }
      }
    } else {
      // 野鸭射击判定
      const candidateMeshes: THREE.Mesh[] = [];
      this.activeDucks.forEach((d) => {
        if (d.state === 'flying') {
          candidateMeshes.push(...d.colliderMeshes);
        }
      });

      const intersects = raycaster.intersectObjects(candidateMeshes, false);
      if (intersects.length > 0) {
        const hitMesh = intersects[0].object as THREE.Mesh;
        const targetDuck = this.activeDucks.find((d) => d.colliderMeshes.includes(hitMesh));
        if (targetDuck && targetDuck.state === 'flying') {
          this.hitDuck(targetDuck);
          didHit = true;
        }
      }
    }

    // 若 3 发子弹用完，且场上仍有未被击落目标，立即触发逃脱
    if (this.shotsLeft === 0) {
      this.checkFlyAwayTrigger();
    }

    return didHit;
  }

  /**
   * 命中野鸭：0.4s 空中僵直受惊态 -> 旋转坠落
   */
  private hitDuck(duck: DuckEntity): void {
    duck.isHit = true;
    duck.state = 'hit_freeze';
    duck.stateTimer = 0.4;
    duck.velocity.set(0, 0, 0);

    this.roundHitCount++;
    this.totalScore += duck.scoreValue;

    // 标记当前波次对应的命中格子为 hit (红鸭图标)
    this.recordWaveHit();
    this.emitHUD();

    // 翅膀向两侧水平张开僵直
    duck.wingLeft.rotation.z = -Math.PI / 2.2;
    duck.wingRight.rotation.z = Math.PI / 2.2;

    // 3D 浮动得分飘字
    this.spawnFloatingScore(duck.position, duck.scoreValue);

    // 检查是否本波所有鸭子都已解决
    this.checkWaveResolution();
  }

  /**
   * 命中飞盘：空中爆裂飞溅橙色破片
   */
  private hitClay(clay: ClayEntity): void {
    clay.isHit = true;
    clay.state = 'broken';
    this.roundHitCount++;
    this.totalScore += clay.scoreValue;

    this.audioManager.playNesClayHit();
    this.recordWaveHit();
    this.emitHUD();

    this.createClayDebris(clay.position);
    this.rootGroup.remove(clay.meshGroup);

    this.spawnFloatingScore(clay.position, clay.scoreValue);
    this.checkWaveResolution();
  }

  private recordWaveHit(): void {
    const targetStartIndex = this.waveIndex * this.targetsPerWave;
    for (let i = 0; i < this.targetsPerWave; i++) {
      if (this.targetResults[targetStartIndex + i] === 'active') {
        this.targetResults[targetStartIndex + i] = 'hit';
        break;
      }
    }
  }

  private checkFlyAwayTrigger(): void {
    const hasUnresolved =
      this.activeDucks.some((d) => d.state === 'flying') ||
      this.activeClays.some((c) => c.state === 'flying');

    if (hasUnresolved && !this.isFlyAway) {
      this.triggerFlyAway();
    }
  }

  /**
   * 触发 5.5s 逃脱 (FLY AWAY!) 状态
   */
  private triggerFlyAway(): void {
    if (this.isFlyAway) return;
    this.isFlyAway = true;
    this.emitHUD();

    // 现存仍处于飞行状态的野鸭直线冲向高空逃遁
    this.activeDucks.forEach((d) => {
      if (d.state === 'flying') {
        d.state = 'fleeing_up';
        d.velocity.set(0, 11.0, 0); // 极速飞天逃逸
        d.meshGroup.rotation.z = 0;
        d.meshGroup.rotation.x = -Math.PI / 3;
      }
    });

    // 统计本波命中数，将剩余未打中的格子标为 miss
    const targetStartIndex = this.waveIndex * this.targetsPerWave;
    let waveHits = 0;
    for (let i = 0; i < this.targetsPerWave; i++) {
      if (this.targetResults[targetStartIndex + i] === 'hit') {
        waveHits++;
      } else {
        this.targetResults[targetStartIndex + i] = 'miss';
      }
    }
    this.emitHUD();

    if (this.submode !== 'game_c') {
      this.isWaveActive = false;
      if (waveHits === 0) {
        // 0 命中：鸭子飞走，猎犬立即从草丛后探出捂嘴魔性大笑！
        setTimeout(() => {
          this.triggerDogLaugh(() => {
            this.waveIndex++;
            this.startNextWave();
          });
        }, 220);
      } else {
        // 部分命中（如 Game B 2中1）：展示打中那只
        setTimeout(() => {
          this.triggerDogCatch(waveHits, () => {
            this.waveIndex++;
            this.startNextWave();
          });
        }, 350);
      }
    } else {
      // Game C 飞盘射击直接下一波
      this.isWaveActive = false;
      setTimeout(() => {
        this.waveIndex++;
        this.startNextWave();
      }, 1000);
    }
  }

  // ==========================================================================
  // 每一帧逻辑更新 (飞行折返、下坠、逃脱与猎犬演出)
  // ==========================================================================

  public update(delta: number): void {
    // 1. 波次主计时 (5.5 秒未打完触发逃脱)
    if (this.isWaveActive) {
      this.waveTimer += delta;
      if (this.waveTimer >= 5.5 && !this.isFlyAway) {
        this.triggerFlyAway();
      }
    }

    // 2. 野鸭飞行/坠落/逃离动画更新
    for (let i = this.activeDucks.length - 1; i >= 0; i--) {
      const d = this.activeDucks[i];
      d.flapCycle += delta * 18.0;

      if (d.state === 'flying') {
        // 拍打翅膀
        const flap = Math.sin(d.flapCycle) * 0.65;
        d.wingLeft.rotation.z = flap;
        d.wingRight.rotation.z = -flap;

        // 位移与边界碰撞反弹
        d.position.addScaledVector(d.velocity, delta);
        d.meshGroup.position.copy(d.position);

        // 视界边界框反弹: X in [-5, 5], Y in [-0.5, 4.2], Z in [-10.5, -7.5]
        if (d.position.x < -5.0 || d.position.x > 5.0) {
          d.velocity.x = -d.velocity.x;
          d.position.x = Math.max(-5.0, Math.min(5.0, d.position.x));
        }
        if (d.position.y < -0.5 || d.position.y > 4.2) {
          d.velocity.y = -d.velocity.y;
          d.position.y = Math.max(-0.5, Math.min(4.2, d.position.y));
        }

        // 面向飞动方向
        const targetLook = d.position.clone().add(d.velocity);
        d.meshGroup.lookAt(targetLook);
      } else if (d.state === 'hit_freeze') {
        // 中弹空中僵直 0.4s
        d.stateTimer -= delta;
        if (d.stateTimer <= 0) {
          d.state = 'falling';
          this.audioManager.playNesDuckFall();
        }
      } else if (d.state === 'falling') {
        // 垂直下坠与高速自转
        d.position.y -= 7.5 * delta;
        d.meshGroup.rotation.z += 16.0 * delta;
        d.meshGroup.position.copy(d.position);

        // 坠入草丛后方 (Y <= -1.48)
        if (d.position.y <= -1.48) {
          d.state = 'dead';
          this.rootGroup.remove(d.meshGroup);
          this.checkWaveResolution();
        }
      } else if (d.state === 'fleeing_up') {
        // 笔直逃向太空高空
        d.position.y += 8.5 * delta;
        d.meshGroup.position.copy(d.position);

        const flap = Math.sin(d.flapCycle * 1.5) * 0.75;
        d.wingLeft.rotation.z = flap;
        d.wingRight.rotation.z = -flap;

        if (d.position.y > 8.0) {
          d.state = 'dead';
          this.rootGroup.remove(d.meshGroup);
          this.checkWaveResolution();
        }
      }
    }

    // 3. 飞盘抛物线轨迹更新 (Game C)
    for (let i = this.activeClays.length - 1; i >= 0; i--) {
      const c = this.activeClays[i];
      if (c.state === 'flying') {
        c.velocity.y -= c.gravity * delta;
        c.position.addScaledVector(c.velocity, delta);
        c.meshGroup.position.copy(c.position);
        c.meshGroup.rotation.y += 12.0 * delta;

        // 飞出远方或落入地面
        if (c.position.z < -24.0 || c.position.y < -1.45) {
          c.state = 'dead';
          this.rootGroup.remove(c.meshGroup);
          this.checkWaveResolution();
        }
      }
    }

    // 4. 飞盘爆炸碎片重力飞散
    for (let i = this.debrisMeshes.length - 1; i >= 0; i--) {
      const d = this.debrisMeshes[i];
      d.life -= delta;
      d.vel.y -= 9.8 * delta;
      d.mesh.position.addScaledVector(d.vel, delta);
      d.mesh.rotation.x += 10 * delta;
      if (d.life <= 0) {
        this.rootGroup.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debrisMeshes.splice(i, 1);
      }
    }

    // 5. 猎犬状态机动画更新
    this.updateDogAnimation(delta);
  }

  /**
   * 检查本波次是否所有目标均已完结 (击落或逃脱)
   */
  private checkWaveResolution(): void {
    if (!this.isWaveActive || this.isFlyAway) return;

    const allFinished =
      (this.submode === 'game_c'
        ? this.activeClays.every((c) => c.state === 'broken' || c.state === 'dead')
        : this.activeDucks.every((d) => d.state === 'dead'));

    if (allFinished) {
      this.isWaveActive = false;

      // 统计本波命中数，将剩余未命中的格子标记为 miss
      const targetStartIndex = this.waveIndex * this.targetsPerWave;
      let waveHits = 0;
      for (let i = 0; i < this.targetsPerWave; i++) {
        if (this.targetResults[targetStartIndex + i] === 'hit') {
          waveHits++;
        } else {
          this.targetResults[targetStartIndex + i] = 'miss';
        }
      }
      this.emitHUD();

      // 触发猎犬演出 (Game A & B)：击中举鸭，未击中魔性嘲笑
      if (this.submode !== 'game_c') {
        if (waveHits > 0) {
          this.triggerDogCatch(waveHits, () => {
            this.waveIndex++;
            this.startNextWave();
          });
        } else {
          this.triggerDogLaugh(() => {
            this.waveIndex++;
            this.startNextWave();
          });
        }
      } else {
        // Game C 无猎犬，短暂间隔直接下一波
        setTimeout(() => {
          this.waveIndex++;
          this.startNextWave();
        }, 1100);
      }
    }
  }

  // ==========================================================================
  // 回合结算与晋级线 (Pass Line & PERFECT Bonus)
  // ==========================================================================

  private finishRound(): void {
    const passRequirement = this.getPassLine(this.round);
    const isPassed = this.roundHitCount >= passRequirement;
    const isPerfect = this.roundHitCount === 10;

    if (isPerfect) {
      // 满贯奖励 (PERFECT Bonus)
      let bonus = 10000;
      if (this.round <= 10) bonus = 10000;
      else if (this.round <= 15) bonus = 15000;
      else if (this.round <= 20) bonus = 20000;
      else bonus = 30000;

      this.totalScore += bonus;
      this.audioManager.playNesPerfect();
      if (this.onRoundClear) {
        this.onRoundClear(this.round, bonus);
      }
    }

    if (isPassed) {
      // 合格晋级！短暂延时进入下一回合
      setTimeout(() => {
        this.startRound(this.round + 1);
      }, isPerfect ? 2400 : 1500);
    } else {
      // 未达标，GAME OVER！
      this.audioManager.playNesGameOver();
      if (this.submode !== 'game_c') {
        this.triggerDogLaugh(() => {
          if (this.onGameOver) {
            this.onGameOver(this.totalScore, this.round);
          }
        });
      } else {
        if (this.onGameOver) {
          this.onGameOver(this.totalScore, this.round);
        }
      }
    }
  }

  /**
   * 官方原版每回合合格线 (Pass Line)
   */
  public getPassLine(round: number): number {
    if (round <= 10) return 6;
    if (round <= 12) return 7;
    if (round <= 14) return 8;
    if (round <= 19) return 9;
    return 10;
  }

  // ==========================================================================
  // 3D 猎犬 (Hound Dog) 交互模型与动画控制器
  // ==========================================================================

  private buildDogModel(): void {
    if (!this.rootGroup.children.includes(this.dogGroup)) {
      this.rootGroup.add(this.dogGroup);
    }
    while (this.dogGroup.children.length > 0) {
      this.dogGroup.remove(this.dogGroup.children[0]);
    }

    this.dogCurrentY = -2.2;
    this.dogTargetY = -2.2;
    this.dogGroup.position.set(0, this.dogCurrentY, -8.05);

    const dogBrown = new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.8, flatShading: true });
    const earBrown = new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.8 });
    const muzzleCream = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.7 });
    const collarRed = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.6 });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });
    const blackMat = new THREE.MeshBasicMaterial({ color: 0x09090b });

    // 1. 躯干
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.0, 0.65), dogBrown);
    body.position.y = 0.5;
    this.dogGroup.add(body);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.7, 0.12), whiteMat);
    chest.position.set(0, 0.5, 0.33);
    this.dogGroup.add(chest);

    const collar = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 0.58), collarRed);
    collar.position.set(0, 0.98, 0.05);
    this.dogGroup.add(collar);

    // 2. 狗头
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.7, 0.65), dogBrown);
    head.position.set(0, 1.35, 0.1);
    this.dogGroup.add(head);
    this.dogHead = head;

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.34, 0.38), muzzleCream);
    muzzle.position.set(0, -0.12, 0.38);
    head.add(muzzle);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.16, 0.18), blackMat);
    nose.position.set(0, 0.08, 0.22);
    muzzle.add(nose);

    // 眯眼笑
    [-0.18, 0.18].forEach((eyeX) => {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.04), blackMat);
      eye.position.set(eyeX, 0.12, 0.34);
      head.add(eye);
    });

    // 3. 经典垂耳
    const earGeo = new THREE.BoxGeometry(0.2, 0.75, 0.32);
    const earL = new THREE.Mesh(earGeo, earBrown);
    earL.position.set(-0.46, 1.25, 0.1);
    this.dogGroup.add(earL);
    this.dogEarLeft = earL;

    const earR = new THREE.Mesh(earGeo, earBrown);
    earR.position.set(0.46, 1.25, 0.1);
    this.dogGroup.add(earR);
    this.dogEarRight = earR;

    // 4. 捂嘴爪子
    const pawsGroup = new THREE.Group();
    pawsGroup.position.set(0, 1.18, 0.46);
    [-0.16, 0.16].forEach((px) => {
      const paw = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.22, 0.22), whiteMat);
      paw.position.set(px, 0, 0);
      paw.rotation.x = -0.3;
      pawsGroup.add(paw);

      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.02), blackMat);
      pad.position.set(0, -0.02, 0.11);
      paw.add(pad);
    });
    this.dogGroup.add(pawsGroup);
    this.dogPaws = pawsGroup;

    // 5. 举起战利品鸭子
    const caughtGroup = new THREE.Group();
    caughtGroup.position.set(0, 1.35, 0.35);
    caughtGroup.visible = false;
    this.dogGroup.add(caughtGroup);
    this.caughtDucksGroup = caughtGroup;
  }

  private triggerDogIntro(onDone: () => void): void {
    this.dogState = 'intro';
    this.audioManager.playNesDogIntro();

    this.dogGroup.position.set(-2.4, -1.45, -8.05);
    this.dogCurrentY = -1.45;
    this.dogTargetY = -1.45;
    if (this.dogPaws) this.dogPaws.visible = false;
    if (this.caughtDucksGroup) this.caughtDucksGroup.visible = false;

    setTimeout(onDone, 2400);
  }

  private triggerDogCatch(caughtCount: number, onDone: () => void): void {
    if (this.submode === 'game_c') {
      onDone();
      return;
    }
    this.dogState = 'celebrating';
    this.dogGroup.position.x = 0;
    this.dogTargetY = -0.55;
    if (this.dogPaws) this.dogPaws.visible = false;
    if (this.caughtDucksGroup) {
      this.caughtDucksGroup.visible = true;
      while (this.caughtDucksGroup.children.length > 0) {
        this.caughtDucksGroup.remove(this.caughtDucksGroup.children[0]);
      }
      const duckMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.8 });
      const billMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
      const offsets = caughtCount === 1 ? [0] : [-0.35, 0.35];
      offsets.forEach((ox) => {
        const duckModel = new THREE.Group();
        const dBody = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.45, 0.3), duckMat);
        duckModel.add(dBody);
        const dHead = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.24, 0.26), duckMat);
        dHead.position.set(0, 0.3, 0.05);
        duckModel.add(dHead);
        const dBill = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.08, 0.2), billMat);
        dBill.position.set(0, 0.26, 0.2);
        duckModel.add(dBill);
        duckModel.position.set(ox, 0, 0);
        this.caughtDucksGroup!.add(duckModel);
      });
    }

    this.audioManager.playNesDogCatch();

    setTimeout(() => {
      this.dogTargetY = -2.2;
      setTimeout(() => {
        this.dogState = 'hidden';
        onDone();
      }, 350);
    }, 1450);
  }

  private triggerDogLaugh(onDone: () => void): void {
    if (this.submode === 'game_c') {
      onDone();
      return;
    }
    this.dogState = 'laughing';
    this.dogGroup.position.x = 0;
    this.dogTargetY = -0.55; // 升出草丛，头部、胸口和捂嘴双手清晰露面
    if (this.dogPaws) this.dogPaws.visible = true;
    if (this.caughtDucksGroup) this.caughtDucksGroup.visible = false;

    this.audioManager.playNesDogLaugh();

    setTimeout(() => {
      this.dogTargetY = -2.2; // 嘲笑结束后平滑缩回草丛下
      setTimeout(() => {
        this.dogState = 'hidden';
        onDone();
      }, 350);
    }, 1650);
  }

  private updateDogAnimation(delta: number): void {
    // 平滑升降插值
    this.dogCurrentY += (this.dogTargetY - this.dogCurrentY) * Math.min(1.0, delta * 12.0);
    this.dogGroup.position.y = this.dogCurrentY;

    const time = performance.now() * 0.001;

    if (this.dogState === 'intro') {
      this.dogGroup.position.x += 1.3 * delta;
      if (this.dogGroup.position.x > 0.0) {
        this.dogTargetY = -2.2;
      }
    } else if (this.dogState === 'laughing') {
      // 经典魔性双肩快速上下抖动 + 捂嘴颤动 + 大耳朵扑腾
      const bounce = Math.sin(time * 24.0) * 0.06;
      this.dogGroup.position.y = this.dogCurrentY + bounce;

      if (this.dogEarLeft && this.dogEarRight) {
        const earFlap = Math.sin(time * 24.0) * 0.25;
        this.dogEarLeft.rotation.z = earFlap;
        this.dogEarRight.rotation.z = -earFlap;
      }

      if (this.dogPaws) {
        this.dogPaws.position.y = 1.18 + Math.sin(time * 24.0) * 0.03;
      }

      if (this.dogHead) {
        this.dogHead.rotation.z = Math.sin(time * 12.0) * 0.08;
      }
    } else if (this.dogState === 'celebrating') {
      if (this.dogHead) {
        this.dogHead.rotation.z = Math.sin(time * 6.0) * 0.05;
      }
    }
  }

  // ==========================================================================
  // 模型与特效生成辅助
  // ==========================================================================

  private buildDuckMesh(
    parent: THREE.Group,
    color: DuckColor
  ): { colliders: THREE.Mesh[]; wingL: THREE.Mesh; wingR: THREE.Mesh } {
    const bodyColor = color === 'black' ? 0x18181b : color === 'blue' ? 0x2563eb : 0xdc2626;
    const headColor = color === 'black' ? 0x15803d : color === 'blue' ? 0x991b1b : 0x15803d;

    const bodyMat = new THREE.MeshStandardMaterial({ color: bodyColor, roughness: 0.8, flatShading: true });
    const headMat = new THREE.MeshStandardMaterial({ color: headColor, roughness: 0.7 });
    const billMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const whiteMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.85), bodyMat);
    parent.add(body);

    const neckRing = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.38), whiteMat);
    neckRing.position.set(0, 0.32, 0.28);
    parent.add(neckRing);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.38, 0.42), headMat);
    head.position.set(0, 0.52, 0.38);
    parent.add(head);

    const bill = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.32), billMat);
    bill.position.set(0, 0.48, 0.68);
    parent.add(bill);

    // 拍打机翼 (左右对称)
    const wingGeo = new THREE.BoxGeometry(0.58, 0.04, 0.38);
    wingGeo.translate(0.29, 0, 0);

    const wingL = new THREE.Mesh(wingGeo, bodyMat);
    wingL.position.set(0.24, 0.12, 0);
    parent.add(wingL);

    const wingRGeo = new THREE.BoxGeometry(0.58, 0.04, 0.38);
    wingRGeo.translate(-0.29, 0, 0);
    const wingR = new THREE.Mesh(wingRGeo, bodyMat);
    wingR.position.set(-0.24, 0.12, 0);
    parent.add(wingR);

    return { colliders: [body, head], wingL, wingR };
  }

  private createClayDebris(pos: THREE.Vector3): void {
    for (let i = 0; i < 8; i++) {
      const geo = new THREE.DodecahedronGeometry(0.08, 0);
      const mat = new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.5 });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);

      const angle = Math.random() * Math.PI * 2;
      const spd = THREE.MathUtils.randFloat(2.5, 6.0);
      const vel = new THREE.Vector3(Math.cos(angle) * spd, THREE.MathUtils.randFloat(1.5, 4.5), Math.sin(angle) * spd);

      this.rootGroup.add(mesh);
      this.debrisMeshes.push({ mesh, vel, life: 0.65 });
    }
  }

  private spawnFloatingScore(pos: THREE.Vector3, val: number): void {
    // 触发 HUD 飘字
    const container = document.getElementById('hit-feedback-container');
    if (!container) return;

    const el = document.createElement('div');
    el.className = 'hit-float-text duck-score-popup';
    el.textContent = `+${val}`;

    const p = pos.clone().project(this.camera);
    const sx = Math.max(40, Math.min(window.innerWidth - 60, ((p.x + 1) / 2) * window.innerWidth));
    const sy = Math.max(40, Math.min(window.innerHeight - 60, ((-p.y + 1) / 2) * window.innerHeight));
    el.style.left = `${sx}px`;
    el.style.top = `${sy}px`;
    container.appendChild(el);

    setTimeout(() => el.remove(), 750);
  }

  private emitHUD(): void {
    if (this.onHUDUpdate) {
      this.onHUDUpdate({
        round: this.round,
        shotsLeft: this.shotsLeft,
        currentScore: this.totalScore,
        targetResults: [...this.targetResults],
        passLine: this.getPassLine(this.round),
        submode: this.submode,
        isFlyAway: this.isFlyAway,
        isRoundComplete: false,
        isGameOver: false,
      });
    }
  }

  public clear(): void {
    while (this.rootGroup.children.length > 0) {
      const c = this.rootGroup.children[0];
      this.rootGroup.remove(c);
      c.traverse((node) => {
        if (node instanceof THREE.Mesh) {
          node.geometry.dispose();
          if (Array.isArray(node.material)) {
            node.material.forEach((m) => m.dispose());
          } else {
            node.material.dispose();
          }
        }
      });
    }

    // 重新将 dogGroup 挂载入 rootGroup 保证随时可用
    this.rootGroup.add(this.dogGroup);

    this.activeDucks = [];
    this.activeClays = [];
    this.debrisMeshes = [];
    this.isWaveActive = false;
    this.isFlyAway = false;
    this.dogState = 'hidden';
    this.dogTargetY = -2.2;
    this.dogCurrentY = -2.2;
  }
}
