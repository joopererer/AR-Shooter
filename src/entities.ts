/**
 * AR-Shooter 生态实体与动物管理器 (entities.ts)
 * 包含：
 * 1. 荒野狩猎：高仿真低多边形动物建模 (野鹿、野猪、巨熊、猎犬、奶牛、绵羊)，
 *    差异化运动姿态 (跳跃奔腾、高频小跑冲刺、沉重摇摆漫步、摇尾追逐、低头饮水)
 * 2. 星际防卫：敌方太空战斗机 (Starfighter) 与异兽，360°战术规避机动与敌方等离子弹幕射击与规避机制
 * 3. 万圣夜惊魂：360°开放万圣节怪物 (飘游幽灵、振翅夜蝠、蹒跚僵尸、蹦跳南瓜怪)
 * 并彻底解决异步 Respawn 定时器在切换模式时的实体残留泄漏问题。
 */

import * as THREE from 'three';
import { GameMode } from './modes';
import { TextureGenerator } from './textureGenerator';

export type EntityType =
  | 'deer'
  | 'boar'
  | 'bear'
  | 'dog'
  | 'cow'
  | 'sheep'
  | 'alien'
  | 'starfighter'
  | 'ghost'
  | 'bat'
  | 'zombie'
  | 'pumpkin';

export interface GameEntity {
  id: string;
  type: EntityType;
  mode: GameMode;
  isFriendly: boolean;
  meshGroup: THREE.Group;
  shadowMesh?: THREE.Mesh;
  position: THREE.Vector3;
  basePosition: THREE.Vector3;
  velocity: THREE.Vector3;
  speed: number;
  health: number;
  maxHealth: number;
  scoreValue: number;
  materials: THREE.Material[];
  currentOpacity: number;
  isDying: boolean;

  // 动画骨骼与关节部件
  legMeshes: THREE.Mesh[];
  wingMeshes?: { left: THREE.Mesh; right: THREE.Mesh };
  tailMesh?: THREE.Mesh;
  headMesh?: THREE.Mesh;
  walkCycle: number;

  // AI 行为状态机
  state: 'wandering' | 'drinking' | 'hiding' | 'sprinting' | 'chasing' | 'fleeing' | 'dogfight';
  stateTimer: number;
  targetPos: THREE.Vector3;
  fireCooldown?: number; // 敌机开火冷却

  // 幽灵猎手：圆形铁围栏攻击计时
  fenceAttackCountdown?: number;
  isAttackingFence?: boolean;
}

export interface EnemyProjectile {
  mesh: THREE.Mesh;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

export interface EntityHitResult {
  hit: boolean;
  entity?: GameEntity;
  isFriendly?: boolean;
  killed?: boolean;
  scoreChange: number;
  point?: THREE.Vector3;
  name: string;
}

export class EntityManager {
  private scene: THREE.Scene;
  private rootGroup = new THREE.Group();
  private entities: GameEntity[] = [];
  private entityIdCounter: number = 0;
  private currentMode: GameMode = 'hunting';

  // 待处理的异步重生定时器 ID 列表 (用于防止切模式时熊在星际模式重生)
  private respawnTimerIds: number[] = [];

  // 敌机等离子子弹弹幕系统
  private enemyProjectiles: EnemyProjectile[] = [];
  private projectileGroup = new THREE.Group();

  // 粒子爆炸系统
  private deathParticles: THREE.Points[] = [];

  // 玩家被敌机子弹击中回调
  private onPlayerHitCallback?: () => void;
  private onEnemyFireCallback?: () => void;

  // 幽灵模式铁护栏受击破坏回调 (带攻击者三维空间位置，用于全向受击红光警示)
  private onFenceDamageCallback?: (damage: number, attackerPos: THREE.Vector3) => void;

  // 临时辅助向量
  private readonly tempCamPos = new THREE.Vector3();
  private readonly tempCamDir = new THREE.Vector3();
  private readonly tempDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    onPlayerHit?: () => void,
    onEnemyFire?: () => void,
    onFenceDamage?: (damage: number, attackerPos: THREE.Vector3) => void
  ) {
    this.scene = scene;
    this.scene.add(this.rootGroup);
    this.scene.add(this.projectileGroup);
    this.onPlayerHitCallback = onPlayerHit;
    this.onEnemyFireCallback = onEnemyFire;
    this.onFenceDamageCallback = onFenceDamage;
  }

  public setFenceDamageCallback(cb: (damage: number, attackerPos: THREE.Vector3) => void): void {
    this.onFenceDamageCallback = cb;
  }

  public setMode(mode: GameMode): void {
    this.currentMode = mode;
  }

  // ==========================================================================
  // 生态群落初始化
  // ==========================================================================

  /**
   * 1. 荒野狩猎：360° 自然生灵群落 (360° 均匀环绕分布，初始距离玩家 > 7.0m 安全空间)
   */
  public initHuntingEcosystem(): void {
    this.clearAll();
    this.currentMode = 'hunting';

    // 8 个方位角均衡分布，确保转身 360 度均有动物 (正前方、正后方、左右及斜角)
    const animalTypes: EntityType[] = [
      'deer', 'deer', 'boar', 'boar', 'bear',
      'dog', 'cow', 'cow', 'sheep', 'sheep'
    ];

    animalTypes.forEach((type, idx) => {
      // 基础角度 + 轻微随机扰动
      const baseAngle = (idx / animalTypes.length) * Math.PI * 2 + THREE.MathUtils.randFloat(-0.2, 0.2);
      const radius = type === 'bear' ? THREE.MathUtils.randFloat(9.5, 14.0) : THREE.MathUtils.randFloat(7.2, 13.5);
      this.spawnEntity(type, baseAngle, radius);
    });
  }

  /**
   * 2. 星际防卫：180° 前方战区太空战机 (Z < 0，方位角 ±70°，直观迎敌机动与闪身躲弹)
   */
  public initSciFiEcosystem(): void {
    this.clearAll();
    this.currentMode = 'scifi';

    // 生成敌方太空战斗机 (Starfighters)：严格限制在正前方 180° 锥形战区
    for (let i = 0; i < 4; i++) {
      const angle = THREE.MathUtils.randFloat(-1.15, 1.15); // 正前方 ±66 度
      const radius = THREE.MathUtils.randFloat(8.5, 14.5);
      this.spawnEntity('starfighter', angle, radius);
    }
    // 脉冲异兽 (Aliens)
    for (let i = 0; i < 3; i++) {
      const angle = THREE.MathUtils.randFloat(-1.25, 1.25);
      const radius = THREE.MathUtils.randFloat(7.0, 11.0);
      this.spawnEntity('alien', angle, radius);
    }
  }

  /**
   * 3. 万圣夜惊魂：360° 圆形铁围栏围攻战 (怪物从外围 11m~16m 逼近围栏 R=3m)
   */
  public initGhostEcosystem(): void {
    this.clearAll();
    this.currentMode = 'ghost';

    const ghostTypes: EntityType[] = [
      'ghost', 'ghost', 'bat', 'bat', 'zombie', 'zombie', 'pumpkin', 'pumpkin'
    ];

    ghostTypes.forEach((type, idx) => {
      const baseAngle = (idx / ghostTypes.length) * Math.PI * 2 + THREE.MathUtils.randFloat(-0.25, 0.25);
      const radius = THREE.MathUtils.randFloat(11.0, 15.5);
      this.spawnEntity(type, baseAngle, radius);
    });
  }

  // ==========================================================================
  // 实体生成系统 (支持自定义方位角与生成半径)
  // ==========================================================================

  public spawnEntity(type: EntityType, customAngle?: number, customRadius?: number): GameEntity {
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const legs: THREE.Mesh[] = [];
    let wings: { left: THREE.Mesh; right: THREE.Mesh } | undefined;
    let tail: THREE.Mesh | undefined;
    let head: THREE.Mesh | undefined;

    // 是否为地面贴地实体
    const isGround =
      type === 'deer' ||
      type === 'boar' ||
      type === 'bear' ||
      type === 'dog' ||
      type === 'cow' ||
      type === 'sheep' ||
      type === 'zombie' ||
      type === 'pumpkin';

    const groundY = -1.5;

    // 方位角与半径计算
    let angle = customAngle !== undefined ? customAngle : Math.random() * Math.PI * 2;
    // 星际战机默认严格保持在正前方 180° (Z < 0)
    if (this.currentMode === 'scifi' && type === 'starfighter' && customAngle === undefined) {
      angle = THREE.MathUtils.randFloat(-1.2, 1.2);
    }

    let radius = customRadius !== undefined ? customRadius : (
      this.currentMode === 'ghost'
        ? THREE.MathUtils.randFloat(11.0, 15.5)
        : this.currentMode === 'hunting'
        ? THREE.MathUtils.randFloat(7.5, 14.0)
        : (type === 'bear' ? 9.5 : type === 'starfighter' ? THREE.MathUtils.randFloat(8.5, 14.5) : THREE.MathUtils.randFloat(7.0, 11.0))
    );

    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    let y = groundY;

    if (!isGround) {
      if (type === 'bat') {
        y = THREE.MathUtils.randFloat(0.6, 2.5);
      } else if (type === 'starfighter') {
        y = THREE.MathUtils.randFloat(0.2, 3.2);
      } else {
        y = THREE.MathUtils.randFloat(-0.4, 2.2);
      }
    }

    const pos = new THREE.Vector3(x, y, z);
    group.position.copy(pos);

    let shadow: THREE.Mesh | undefined;
    let isFriendly = false;
    let scoreValue = 100;
    let health = 1;
    let speed = 2.0;
    let fireCooldown = THREE.MathUtils.randFloat(2.5, 5.0);

    // 物种三维构造与参数配置
    switch (type) {
      case 'deer':
        head = this.buildDeerMesh(group, materials, legs);
        speed = 2.6;
        scoreValue = 120;
        break;
      case 'boar':
        head = this.buildBoarMesh(group, materials, legs);
        speed = 3.8;
        scoreValue = 150;
        break;
      case 'bear':
        head = this.buildBearMesh(group, materials, legs);
        speed = 1.0;
        health = 3;
        scoreValue = 300;
        break;
      case 'dog':
        tail = this.buildHoundDogMesh(group, materials, legs);
        isFriendly = true;
        speed = 4.2;
        scoreValue = -200;
        health = 999;
        break;
      case 'cow':
        head = this.buildCowMesh(group, materials, legs);
        isFriendly = true;
        speed = 0.7;
        scoreValue = -150;
        health = 999;
        break;
      case 'sheep':
        this.buildSheepMesh(group, materials, legs);
        isFriendly = true;
        speed = 1.8;
        scoreValue = -100;
        health = 999;
        break;
      case 'starfighter':
        this.buildStarfighterMesh(group, materials);
        speed = 5.5;
        health = 2;
        scoreValue = 250;
        break;
      case 'alien':
        this.buildAlienMesh(group, materials);
        speed = 1.6;
        scoreValue = 100;
        break;
      case 'ghost':
        this.buildGhostMesh(group, materials);
        speed = 3.2;
        scoreValue = 200;
        break;
      case 'bat':
        wings = this.buildBatMesh(group, materials);
        speed = 4.5;
        scoreValue = 180;
        break;
      case 'zombie':
        this.buildZombieMesh(group, materials, legs);
        speed = 0.9;
        health = 2;
        scoreValue = 160;
        break;
      case 'pumpkin':
        this.buildPumpkinMesh(group, materials);
        speed = 2.4;
        scoreValue = 200; // 南瓜虽无破坏力，但作为奖励得分目标获得 +200 分
        break;
    }

    // 地面实体脚底圆形接触软阴影
    if (isGround) {
      const shadowRadius = type === 'bear' ? 1.3 : type === 'cow' ? 1.4 : 0.75;
      const shadowGeo = new THREE.CircleGeometry(shadowRadius, 16);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x050a0f,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.02, 0);
      group.add(shadow);
      materials.push(shadowMat);
    }

    const entity: GameEntity = {
      id: `ent_${++this.entityIdCounter}_${type}`,
      type,
      mode: this.currentMode,
      isFriendly,
      meshGroup: group,
      shadowMesh: shadow,
      position: pos.clone(),
      basePosition: pos.clone(),
      velocity: new THREE.Vector3(),
      speed,
      health,
      maxHealth: health,
      scoreValue,
      materials,
      currentOpacity: 1.0,
      isDying: false,
      state: type === 'starfighter' ? 'dogfight' : 'wandering',
      stateTimer: THREE.MathUtils.randFloat(2, 5),
      targetPos: pos.clone(),
      legMeshes: legs,
      wingMeshes: wings,
      tailMesh: tail,
      headMesh: head,
      walkCycle: Math.random() * Math.PI * 2,
      fireCooldown,
    };

    group.userData = { gameEntity: entity };
    this.rootGroup.add(group);
    this.entities.push(entity);

    return entity;
  }

  // ==========================================================================
  // 低多边形几何模型构造 (逼真生灵 + 万圣节 + 太空战机)
  // ==========================================================================

  /**
   * 1. 逼真野鹿 (Deer)：多段优雅躯干、多叉鹿角、白色腹部条纹与修长四肢
   */
  private buildDeerMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const deerMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getDeerTexture(),
      roughness: 0.75,
      metalness: 0.05,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8 });
    const muzzleMat = new THREE.MeshStandardMaterial({ color: 0x3d2112, roughness: 0.9 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f0f10 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0xfffaed, roughness: 0.4 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.9 });
    mats.push(deerMat, whiteMat, muzzleMat, eyeMat, antlerMat, hoofMat);

    // 主流线型胸腹与躯干 (前胸宽、腰腹略收、后臀丰满)
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.44, 1.4, 8), deerMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 1.15;
    parent.add(body);

    // 乳白色下腹与胸口
    const chestBelly = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.4, 1.1, 6), whiteMat);
    chestBelly.rotation.x = Math.PI / 2;
    chestBelly.position.set(0, 0.95, 0.05);
    parent.add(chestBelly);

    // 挺拔优雅的长颈部 (向上向前倾斜)
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, 0.82, 8), deerMat);
    neck.position.set(0, 1.58, 0.58);
    neck.rotation.x = Math.PI / 5.2;
    parent.add(neck);

    // 鹿头主部 (优雅微锥形)
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.65, 7), deerMat);
    head.position.set(0, 1.95, 0.88);
    head.rotation.x = -Math.PI / 2.8;
    parent.add(head);

    // 鹿鼻吻深色鼻镜
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.16, 0.22), muzzleMat);
    muzzle.position.set(0, 1.82, 1.2);
    parent.add(muzzle);

    // 灵动黑眼睛与长耳
    [-0.14, 0.14].forEach((side) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 6, 6), eyeMat);
      eye.position.set(side, 2.02, 0.92);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 5), deerMat);
      ear.position.set(side * 1.6, 2.22, 0.72);
      ear.rotation.z = side * -0.65;
      ear.rotation.x = -0.4;
      parent.add(ear);
    });

    // 对称多叉立体鹿角 (主枝 + 双分叉)
    [-0.16, 0.16].forEach((side) => {
      const main = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.055, 0.72, 6), antlerMat);
      main.position.set(side, 2.38, 0.75);
      main.rotation.z = side * -0.42;
      main.rotation.x = -0.28;
      parent.add(main);

      const branch1 = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.035, 0.36, 5), antlerMat);
      branch1.position.set(side * 1.6, 2.48, 0.82);
      branch1.rotation.z = side * -0.85;
      branch1.rotation.x = 0.15;
      parent.add(branch1);

      const branch2 = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.028, 0.28, 4), antlerMat);
      branch2.position.set(side * 1.3, 2.72, 0.7);
      branch2.rotation.z = side * 0.3;
      branch2.rotation.x = -0.4;
      parent.add(branch2);
    });

    // 优雅小鹿尾 (白色底绒)
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.26, 5), whiteMat);
    tail.position.set(0, 1.25, -0.72);
    tail.rotation.x = Math.PI / 4;
    parent.add(tail);

    // 四条修长鹿腿 (上粗下细 + 深色蹄角)
    const legGeo = new THREE.CylinderGeometry(0.058, 0.038, 0.88, 6);
    const hoofGeo = new THREE.CylinderGeometry(0.042, 0.048, 0.12, 6);
    [
      [-0.24, 0.45],
      [0.24, 0.45],
      [-0.24, -0.45],
      [0.24, -0.45],
    ].forEach(([lx, lz]) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, 0.44, lz);

      const leg = new THREE.Mesh(legGeo, deerMat);
      legGroup.add(leg);

      const hoof = new THREE.Mesh(hoofGeo, hoofMat);
      hoof.position.y = -0.42;
      legGroup.add(hoof);

      parent.add(legGroup);
      legs.push(leg as unknown as THREE.Mesh);
    });

    return head;
  }

  /**
   * 2. 逼真野猪 (Boar)：厚实躯体、拱起刚毛脊椎脊棱、锋利白色反曲獠牙
   */
  private buildBoarMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const boarMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getBoarTexture(),
      roughness: 0.9,
      metalness: 0.02,
    });
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x181310, roughness: 0.95 });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0x5a3f35, roughness: 0.8 });
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.9 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0a0a0a });
    mats.push(boarMat, ridgeMat, snoutMat, tuskMat, hoofMat, eyeMat);

    // 粗厚敦实身躯
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.46, 1.45, 8), boarMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.78;
    parent.add(body);

    // 脊背刚毛凸起
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 1.4), ridgeMat);
    ridge.position.set(0, 1.28, 0);
    parent.add(ridge);

    // 头部与粗大鼻吻
    const head = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.85, 7), boarMat);
    head.position.set(0, 0.72, 0.95);
    head.rotation.x = -Math.PI / 2.3;
    parent.add(head);

    // 标志性拱地鼻吻盘 (Snout Disc)
    const snout = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.2, 0.16, 8), snoutMat);
    snout.position.set(0, 0.62, 1.42);
    snout.rotation.x = Math.PI / 2;
    parent.add(snout);

    // 鼻孔
    [-0.055, 0.055].forEach((nx) => {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.03, 5, 5), ridgeMat);
      nostril.position.set(nx, 0.62, 1.51);
      parent.add(nostril);
    });

    // 向上反挑的锋利獠牙
    [-0.24, 0.24].forEach((tx) => {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.36, 6), tuskMat);
      tusk.position.set(tx, 0.66, 1.32);
      tusk.rotation.x = -Math.PI / 3.2;
      tusk.rotation.z = tx * -0.45;
      parent.add(tusk);
    });

    // 小眼睛与尖耳
    [-0.25, 0.25].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 5, 5), eyeMat);
      eye.position.set(ex, 0.92, 0.92);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.24, 4), boarMat);
      ear.position.set(ex * 1.3, 1.05, 0.78);
      ear.rotation.z = ex * -0.5;
      ear.rotation.x = -0.3;
      parent.add(ear);
    });

    // 细小刚毛尾巴
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.35, 4), boarMat);
    tail.position.set(0, 0.78, -0.76);
    tail.rotation.x = -Math.PI / 4;
    parent.add(tail);

    // 四条低重心短粗腿
    const legGeo = new THREE.CylinderGeometry(0.12, 0.08, 0.52, 6);
    const hoofGeo = new THREE.CylinderGeometry(0.085, 0.095, 0.1, 6);
    [
      [-0.34, 0.45],
      [0.34, 0.45],
      [-0.34, -0.45],
      [0.34, -0.45],
    ].forEach(([lx, lz]) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, 0.26, lz);

      const leg = new THREE.Mesh(legGeo, boarMat);
      legGroup.add(leg);

      const hoof = new THREE.Mesh(hoofGeo, hoofMat);
      hoof.position.y = -0.24;
      legGroup.add(hoof);

      parent.add(legGroup);
      legs.push(leg as unknown as THREE.Mesh);
    });

    return head;
  }

  /**
   * 3. 逼真巨熊 (Bear)：庞大肩部肌肉隆起 (Hump)、宽阔熊头、厚实巨掌
   */
  private buildBearMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const bearMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getBearTexture(),
      roughness: 0.92,
      metalness: 0.02,
    });
    const snoutMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2e, roughness: 0.85 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x120d09, roughness: 0.4 });
    const clawMat = new THREE.MeshStandardMaterial({ color: 0x171717, roughness: 0.6 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x080808 });
    mats.push(bearMat, snoutMat, noseMat, clawMat, eyeMat);

    // 宽厚庞大躯干
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.68, 2.1, 8), bearMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 1.32;
    parent.add(body);

    // 肩胛部强壮肌肉隆起
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.72, 8, 8), bearMat);
    hump.position.set(0, 1.88, 0.42);
    hump.scale.set(1.0, 0.75, 1.2);
    parent.add(hump);

    // 熊头
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 8), bearMat);
    head.position.set(0, 1.62, 1.25);
    head.scale.set(1.0, 0.9, 1.15);
    parent.add(head);

    // 浅棕色吻部与黑鼻
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.35, 0.45), snoutMat);
    snout.position.set(0, 1.5, 1.72);
    parent.add(snout);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.12), noseMat);
    nose.position.set(0, 1.6, 1.95);
    parent.add(nose);

    // 小眼睛与浑圆熊耳
    [-0.26, 0.26].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 5), eyeMat);
      eye.position.set(ex, 1.74, 1.62);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 6), bearMat);
      ear.position.set(ex * 1.5, 2.08, 1.12);
      ear.scale.set(0.6, 1.0, 0.8);
      parent.add(ear);
    });

    // 熊尾巴
    const tail = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), bearMat);
    tail.position.set(0, 1.45, -1.1);
    parent.add(tail);

    // 强健厚重熊腿与大熊掌
    const legGeo = new THREE.CylinderGeometry(0.24, 0.18, 0.82, 7);
    const pawGeo = new THREE.BoxGeometry(0.38, 0.16, 0.48);
    [
      [-0.55, 0.65],
      [0.55, 0.65],
      [-0.55, -0.65],
      [0.55, -0.65],
    ].forEach(([lx, lz]) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, 0.41, lz);

      const leg = new THREE.Mesh(legGeo, bearMat);
      legGroup.add(leg);

      const paw = new THREE.Mesh(pawGeo, bearMat);
      paw.position.set(0, -0.38, 0.1);
      legGroup.add(paw);

      [-0.11, 0, 0.11].forEach((cx) => {
        const claw = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.12, 4), clawMat);
        claw.position.set(cx, -0.38, 0.36);
        claw.rotation.x = Math.PI / 2;
        legGroup.add(claw);
      });

      parent.add(legGroup);
      legs.push(leg as unknown as THREE.Mesh);
    });

    return head;
  }

  /**
   * 4. 猎犬 (Hound Dog)：亮蓝色友军项圈、活跃摇摆尾巴、敏捷躯体
   */
  private buildHoundDogMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const dogMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getDogTexture(),
      roughness: 0.82,
      metalness: 0.02,
    });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });
    const muzzleMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.85 });
    const noseMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.5 });
    const collarMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff }); // 亮蓝色友军项圈
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x09090b });
    mats.push(dogMat, whiteMat, muzzleMat, noseMat, collarMat, eyeMat);

    // 流线型敏捷躯干
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.26, 0.96, 8), dogMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.65;
    parent.add(body);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.32, 0.42), whiteMat);
    chest.position.set(0, 0.58, 0.34);
    parent.add(chest);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.44), dogMat);
    head.position.set(0, 0.95, 0.55);
    parent.add(head);

    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.32), muzzleMat);
    muzzle.position.set(0, 0.88, 0.78);
    parent.add(muzzle);

    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.08), noseMat);
    nose.position.set(0, 0.95, 0.95);
    parent.add(nose);

    // 友善大眼睛与下垂耳朵
    [-0.12, 0.12].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 6), eyeMat);
      eye.position.set(ex, 1.02, 0.68);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.18), dogMat);
      ear.position.set(ex * 1.8, 0.92, 0.5);
      ear.rotation.z = ex * 0.2;
      parent.add(ear);
    });

    // 醒目亮蓝项圈
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 6, 16), collarMat);
    collar.position.set(0, 0.82, 0.44);
    collar.rotation.x = Math.PI / 3;
    parent.add(collar);

    // 活跃摇尾
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.48, 6), whiteMat);
    tail.position.set(0, 0.88, -0.58);
    tail.rotation.x = -Math.PI / 4;
    parent.add(tail);

    const legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.46, 6);
    [
      [-0.18, 0.35],
      [0.18, 0.35],
      [-0.18, -0.35],
      [0.18, -0.35],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, whiteMat);
      leg.position.set(lx, 0.23, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return tail;
  }

  /**
   * 5. 奶牛 (Cow)
   */
  private buildCowMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const cowMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getCowTexture(),
      roughness: 0.8,
      metalness: 0.02,
    });
    const muzzleMat = new THREE.MeshStandardMaterial({ color: 0xfda4af, roughness: 0.7 }); // 柔粉色鼻吻
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.4 });
    const hornTipMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.85 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    const udderMat = new THREE.MeshStandardMaterial({ color: 0xfecdd3, roughness: 0.7 });
    mats.push(cowMat, muzzleMat, hornMat, hornTipMat, hoofMat, eyeMat, udderMat);

    // 丰满身躯
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.58, 1.85, 8), cowMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 1.15;
    parent.add(body);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.72, 7), cowMat);
    neck.position.set(0, 1.35, 0.88);
    neck.rotation.x = Math.PI / 4.8;
    parent.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.58, 0.68), cowMat);
    head.position.set(0, 1.55, 1.25);
    parent.add(head);

    // 柔粉色鼻吻与鼻孔
    const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.32, 0.36), muzzleMat);
    muzzle.position.set(0, 1.36, 1.62);
    parent.add(muzzle);

    [-0.12, 0.12].forEach((nx) => {
      const nostril = new THREE.Mesh(new THREE.SphereGeometry(0.045, 5, 5), hoofMat);
      nostril.position.set(nx, 1.37, 1.8);
      parent.add(nostril);
    });

    // 眼睛与耳朵
    [-0.32, 0.32].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), eyeMat);
      eye.position.set(ex, 1.62, 1.38);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.12, 0.16), cowMat);
      ear.position.set(ex * 1.3, 1.68, 1.15);
      ear.rotation.z = ex * -0.25;
      parent.add(ear);
    });

    // 优雅弧形牛角
    [-0.26, 0.26].forEach((hx) => {
      const hornBase = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.08, 0.3, 6), hornMat);
      hornBase.position.set(hx, 1.9, 1.18);
      hornBase.rotation.z = hx * -0.7;
      hornBase.rotation.x = -0.3;
      parent.add(hornBase);

      const hornTip = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 5), hornTipMat);
      hornTip.position.set(hx * 1.65, 2.05, 1.16);
      hornTip.rotation.z = hx * -0.3;
      parent.add(hornTip);
    });

    // 柔粉色乳房 (Udder)
    const udder = new THREE.Mesh(new THREE.SphereGeometry(0.24, 6, 6), udderMat);
    udder.position.set(0, 0.72, -0.35);
    udder.scale.set(1.0, 0.75, 1.2);
    parent.add(udder);

    // 细长牛尾巴与末端毛刷
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.82, 5), cowMat);
    tail.position.set(0, 1.0, -0.96);
    tail.rotation.x = -0.15;
    parent.add(tail);

    const tailTuft = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.25, 5), hoofMat);
    tailTuft.position.set(0, 0.55, -1.02);
    tailTuft.rotation.x = Math.PI;
    parent.add(tailTuft);

    // 四条强壮柱状牛腿 + 偶蹄
    const legGeo = new THREE.CylinderGeometry(0.12, 0.09, 0.76, 7);
    const hoofGeo = new THREE.CylinderGeometry(0.095, 0.11, 0.14, 6);
    [
      [-0.45, 0.6],
      [0.45, 0.6],
      [-0.45, -0.6],
      [0.45, -0.6],
    ].forEach(([lx, lz]) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, 0.38, lz);

      const leg = new THREE.Mesh(legGeo, cowMat);
      legGroup.add(leg);

      const hoof = new THREE.Mesh(hoofGeo, hoofMat);
      hoof.position.y = -0.36;
      legGroup.add(hoof);

      parent.add(legGroup);
      legs.push(leg as unknown as THREE.Mesh);
    });

    return head;
  }

  /**
   * 6. 绵羊 (Sheep)
   */
  private buildSheepMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const woolMat = new THREE.MeshStandardMaterial({
      map: TextureGenerator.getSheepTexture(),
      roughness: 0.98,
      metalness: 0.02,
    });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9 });
    const hoofMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x0f172a });
    mats.push(woolMat, faceMat, hoofMat, eyeMat);

    // 蓬松卷曲绵羊躯干
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.72, 2), woolMat);
    body.scale.set(1.15, 0.95, 1.35);
    body.position.y = 0.78;
    parent.add(body);

    const woolCap = new THREE.Mesh(new THREE.SphereGeometry(0.3, 7, 7), woolMat);
    woolCap.position.set(0, 1.08, 0.78);
    parent.add(woolCap);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.32, 0.42), faceMat);
    face.position.set(0, 0.92, 0.92);
    parent.add(face);

    [-0.16, 0.16].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 5, 5), eyeMat);
      eye.position.set(ex, 0.98, 0.98);
      parent.add(eye);

      const ear = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.08, 0.12), faceMat);
      ear.position.set(ex * 1.3, 1.0, 0.78);
      ear.rotation.z = ex * 0.35;
      parent.add(ear);
    });

    // 细巧羊腿 + 小黑蹄
    const legGeo = new THREE.CylinderGeometry(0.055, 0.045, 0.52, 6);
    const hoofGeo = new THREE.CylinderGeometry(0.048, 0.055, 0.1, 5);
    [
      [-0.26, 0.35],
      [0.26, 0.35],
      [-0.26, -0.35],
      [0.26, -0.35],
    ].forEach(([lx, lz]) => {
      const legGroup = new THREE.Group();
      legGroup.position.set(lx, 0.26, lz);

      const leg = new THREE.Mesh(legGeo, faceMat);
      legGroup.add(leg);

      const hoof = new THREE.Mesh(hoofGeo, hoofMat);
      hoof.position.y = -0.24;
      legGroup.add(hoof);

      parent.add(legGroup);
      legs.push(leg as unknown as THREE.Mesh);
    });
  }

  /**
   * 7. 敌方太空战机 (Starfighter)：尖锐低多边形机身、机翼等离子炮与发光推进器
   */
  private buildStarfighterMesh(parent: THREE.Group, mats: THREE.Material[]): void {
    const hullMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.85,
      roughness: 0.3,
      flatShading: true,
    });
    const wingMat = new THREE.MeshStandardMaterial({
      color: 0xef4444, // 红色敌对机翼条纹
      metalness: 0.7,
      roughness: 0.35,
    });
    const thrusterMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    mats.push(hullMat, wingMat, thrusterMat);

    // 梭形机身
    const fuselage = new THREE.Mesh(new THREE.ConeGeometry(0.45, 2.2, 5), hullMat);
    fuselage.rotation.x = Math.PI / 2;
    parent.add(fuselage);

    // 左右主翼
    [-1.2, 1.2].forEach((wx) => {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.85), wingMat);
      wing.position.set(wx > 0 ? 0.7 : -0.7, 0, -0.2);
      wing.rotation.y = wx > 0 ? 0.35 : -0.35;
      parent.add(wing);

      // 翼尖激光炮管
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.6, 5), hullMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(wx, 0, 0.2);
      parent.add(cannon);
    });

    // 尾部双发离子推进器
    [-0.22, 0.22].forEach((tx) => {
      const thruster = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.3, 6), thrusterMat);
      thruster.rotation.x = Math.PI / 2;
      thruster.position.set(tx, 0, -1.1);
      parent.add(thruster);
    });
  }

  /**
   * 8. 脉冲异兽 (Alien)
   */
  private buildAlienMesh(parent: THREE.Group, mats: THREE.Material[]): void {
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    const shellMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0x00f3ff,
      emissiveIntensity: 0.4,
      transparent: true,
      depthWrite: false,
    });
    mats.push(coreMat, shellMat);

    const core = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 16), coreMat);
    parent.add(core);

    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), shellMat);
    parent.add(shell);
  }

  /**
   * 9. 幽灵 (Ghost)：半透明浮空灵体，手电筒照亮显形
   */
  private buildGhostMesh(parent: THREE.Group, mats: THREE.Material[]): void {
    const ghostMat = new THREE.MeshStandardMaterial({
      color: 0x80ffff,
      roughness: 0.1,
      metalness: 0.2,
      emissive: 0x22d3ee,
      emissiveIntensity: 0.7,
      transparent: true,
      opacity: 0.03,
      depthWrite: false,
    });
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xff0055,
      transparent: true,
      opacity: 0.03,
    });
    mats.push(ghostMat, eyeMat);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), ghostMat);
    head.position.set(0, 0.4, 0);
    parent.add(head);

    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.85, 16), ghostMat);
    skirt.rotation.x = Math.PI;
    skirt.position.set(0, -0.1, 0);
    parent.add(skirt);

    [-0.14, 0.14].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), eyeMat);
      eye.position.set(ex, 0.45, 0.36);
      parent.add(eye);
    });
  }

  /**
   * 10. 夜蝠 (Bat)：暗夜小蝙蝠，快速拍翅在空中俯冲穿梭
   */
  private buildBatMesh(parent: THREE.Group, mats: THREE.Material[]): { left: THREE.Mesh; right: THREE.Mesh } {
    const batMat = new THREE.MeshStandardMaterial({ color: 0x1f182b, roughness: 0.9, flatShading: true });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xef4444 });
    mats.push(batMat, eyeMat);

    // 小巧身躯 (比例约 0.45)
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), batMat);
    body.scale.set(0.8, 1.2, 0.8);
    parent.add(body);

    // 尖耳朵
    [-0.1, 0.1].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 4), batMat);
      ear.position.set(ex, 0.28, 0);
      parent.add(ear);

      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 4, 4), eyeMat);
      eye.position.set(ex, 0.08, 0.18);
      parent.add(eye);
    });

    // 左右可旋转拍打翅膀
    const wingGeo = new THREE.BoxGeometry(0.55, 0.02, 0.32);
    wingGeo.translate(0.28, 0, 0);

    const wingLeft = new THREE.Mesh(wingGeo, batMat);
    wingLeft.position.set(0.12, 0.05, 0);
    parent.add(wingLeft);

    const wingRightGeo = new THREE.BoxGeometry(0.55, 0.02, 0.32);
    wingRightGeo.translate(-0.28, 0, 0);
    const wingRight = new THREE.Mesh(wingRightGeo, batMat);
    wingRight.position.set(-0.12, 0.05, 0);
    parent.add(wingRight);

    return { left: wingLeft, right: wingRight };
  }

  /**
   * 11. 僵尸 (Zombie)：人形比例 (1.2x)，腐朽绿肤，双臂僵直前平举，拖步蹒跚
   */
  private buildZombieMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const skinMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.9, flatShading: true });
    const clothMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.95 });
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
    mats.push(skinMat, clothMat, eyeMat);

    // 上身破损衬衫
    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.85, 0.35), clothMat);
    torso.position.y = 1.05;
    parent.add(torso);

    // 腐烂绿脑壳
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.45, 0.42), skinMat);
    head.position.set(0, 1.68, 0);
    head.rotation.y = 0.15;
    head.rotation.z = -0.1;
    parent.add(head);

    // 发光邪异黄眼
    [-0.11, 0.11].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 5, 5), eyeMat);
      eye.position.set(ex, 1.68, 0.22);
      parent.add(eye);
    });

    // 双臂僵直向前伸直 (Classic Zombie Pose)
    [-0.38, 0.38].forEach((ax) => {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.72), skinMat);
      arm.position.set(ax, 1.25, 0.36);
      parent.add(arm);
    });

    // 双腿 (一长一短微跛)
    const legGeo = new THREE.BoxGeometry(0.2, 0.75, 0.2);
    [-0.18, 0.18].forEach((lx) => {
      const leg = new THREE.Mesh(legGeo, clothMat);
      leg.position.set(lx, 0.38, 0);
      parent.add(leg);
      legs.push(leg);
    });
  }

  /**
   * 12. 南瓜怪 (Pumpkin Monster)：矮胖圆形南瓜、发光镂空邪笑面容、弹跳前进
   */
  private buildPumpkinMesh(parent: THREE.Group, mats: THREE.Material[]): void {
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xea580c,
      roughness: 0.7,
      flatShading: true,
    });
    const faceGlowMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x3f6212 });
    mats.push(orangeMat, faceGlowMat, stemMat);

    // 矮胖南瓜身躯
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), orangeMat);
    body.scale.set(1.25, 0.95, 1.2);
    body.position.y = 0.5;
    parent.add(body);

    // 镂空发光邪笑眼嘴
    [-0.18, 0.18].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 3), faceGlowMat);
      eye.position.set(ex, 0.58, 0.6);
      eye.rotation.x = Math.PI / 2;
      parent.add(eye);
    });

    // 锯齿大笑嘴巴
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.08, 0.06), faceGlowMat);
    mouth.position.set(0, 0.38, 0.6);
    parent.add(mouth);

    // 绿色瓜把
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.2, 5), stemMat);
    stem.position.set(0, 1.0, 0);
    parent.add(stem);
  }

  // ==========================================================================
  // 每一帧 AI 状态更新与物理移动
  // ==========================================================================

  public update(delta: number, camera: THREE.Camera): void {
    camera.getWorldPosition(this.tempCamPos);
    camera.getWorldDirection(this.tempCamDir);

    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      if (e.isDying) continue;

      e.stateTimer -= delta;

      // 1. 各实体物种差异化 AI 决策与移动
      this.updateEntityAI(e, delta);

      // 2. 肢体动作与姿态动画
      this.updateEntityAnimations(e, delta);
    }

    // 3. 更新敌机等离子子弹弹幕与规避检测
    this.updateEnemyProjectiles(delta);

    // 4. 更新爆炸粒子
    this.updateParticles(delta);
  }

  /**
   * 物种差异化动画更新 (蝙蝠振翅、猎犬摇尾、四足奔跑跳跃、南瓜弹跳)
   */
  private updateEntityAnimations(e: GameEntity, delta: number): void {
    // 蝙蝠高频振翅动画
    if (e.type === 'bat' && e.wingMeshes) {
      e.walkCycle += delta * 24.0;
      const flap = Math.sin(e.walkCycle) * 0.68;
      e.wingMeshes.left.rotation.z = flap;
      e.wingMeshes.right.rotation.z = -flap;
    }

    // 猎犬高频摆尾动画
    if (e.type === 'dog' && e.tailMesh) {
      e.tailMesh.rotation.y = Math.sin(performance.now() * 0.024) * 0.55;
    }

    // 四足动物步态奔跑 (野鹿轻盈大步跳跃、野猪高频小跑、巨熊沉重摇摆)
    if (e.legMeshes.length === 4) {
      const freq = e.type === 'boar' ? 6.5 : e.type === 'bear' ? 2.5 : 4.5;
      e.walkCycle += delta * e.speed * freq;
      const swing = Math.sin(e.walkCycle) * 0.45;

      e.legMeshes[0].rotation.x = swing;
      e.legMeshes[1].rotation.x = -swing;
      e.legMeshes[2].rotation.x = -swing;
      e.legMeshes[3].rotation.x = swing;

      // 巨熊沉重身躯左右晃动
      if (e.type === 'bear') {
        e.meshGroup.rotation.z = Math.sin(e.walkCycle * 0.5) * 0.08;
      }
    }

    // 僵尸跛行拖步 (左右摇晃)
    if (e.type === 'zombie' && e.legMeshes.length === 2) {
      e.walkCycle += delta * 3.0;
      e.legMeshes[0].rotation.x = Math.sin(e.walkCycle) * 0.35;
      e.legMeshes[1].rotation.x = -Math.sin(e.walkCycle) * 0.2;
      e.meshGroup.rotation.z = Math.sin(e.walkCycle) * 0.12;
    }

    // 南瓜怪跳跃与触地压缩形变
    if (e.type === 'pumpkin') {
      e.walkCycle += delta * 6.5;
      const hop = Math.abs(Math.sin(e.walkCycle)) * 0.55;
      e.position.y = -1.5 + hop;
      e.meshGroup.position.y = e.position.y;
      // 触地压缩弹性
      const squash = hop < 0.1 ? 0.75 : 1.0;
      e.meshGroup.scale.set(1.0 / squash, squash, 1.0 / squash);
    }
  }

  /**
   * 实体 AI 决策与转向平移
   */
  private updateEntityAI(e: GameEntity, delta: number): void {
    // 1. 太空战斗机 (Starfighter)：在正前方 180° 战区战术盘旋 + 周期性向玩家座舱发射等离子弹
    if (e.type === 'starfighter') {
      e.meshGroup.rotation.y += delta * 0.8;
      // 战术机动：限制在正前方 (Z in [-16, -6], X in [-10, 10])
      e.position.x += Math.cos(performance.now() * 0.001 + e.speed) * delta * 2.8;
      e.position.z += Math.sin(performance.now() * 0.0008 + e.speed) * delta * 1.8;
      // 强制约束在前方 180° 视野内
      if (e.position.z > -5.5) e.position.z = -5.5;
      if (e.position.z < -16.0) e.position.z = -16.0;
      if (e.position.x > 11.0) e.position.x = 11.0;
      if (e.position.x < -11.0) e.position.x = -11.0;

      e.meshGroup.position.copy(e.position);
      e.meshGroup.lookAt(this.tempCamPos);

      // 周期性朝向玩家飞船座舱开火！
      if (e.fireCooldown !== undefined) {
        e.fireCooldown -= delta;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = THREE.MathUtils.randFloat(3.2, 5.5);
          this.fireEnemyPlasma(e.position);
        }
      }
      return;
    }

    // 2. 异兽 (Alien)
    if (e.type === 'alien') {
      e.meshGroup.rotation.y += delta * 1.5;
      if (e.position.z > -4.5) e.position.z = -4.5;
      e.meshGroup.position.copy(e.position);
      return;
    }

    // 3. 幽灵 (Ghost)：准星手电筒夹角 < 12° (dot > 0.978) 显形逃逸，不破坏铁围栏
    if (e.type === 'ghost') {
      this.tempDir.subVectors(e.position, this.tempCamPos).normalize();
      const dot = this.tempCamDir.dot(this.tempDir);
      const isLitByFlashlight = dot > 0.978;
      const targetOpacity = isLitByFlashlight ? 0.92 : 0.03;
      e.currentOpacity += (targetOpacity - e.currentOpacity) * Math.min(1.0, delta * 9.0);

      e.materials.forEach((m) => {
        m.opacity = e.currentOpacity;
      });

      if (isLitByFlashlight) {
        e.state = 'fleeing';
        const fleeDir = new THREE.Vector3().crossVectors(this.tempCamDir, new THREE.Vector3(0, 1, 0)).normalize();
        if (Math.random() < 0.5) fleeDir.negate();
        e.position.addScaledVector(fleeDir, e.speed * delta);
        e.meshGroup.position.copy(e.position);
      } else {
        e.position.y += Math.sin(performance.now() * 0.002 + e.position.x) * 0.006;
        e.meshGroup.position.copy(e.position);
      }
      e.meshGroup.rotation.y += delta * 1.2;
      return;
    }

    // 4. 蝙蝠 (Bat)：万圣围栏攻防 (向铁围栏 R=3.1m 逼近，停驻攻击并倒计时；其他模式正常盘旋)
    if (e.type === 'bat') {
      if (this.currentMode === 'ghost') {
        const distToCenter = Math.sqrt(e.position.x * e.position.x + e.position.z * e.position.z);
        if (distToCenter > 3.2) {
          // 向铁围栏俯冲逼近
          const moveDir = new THREE.Vector3(-e.position.x, 0, -e.position.z).normalize();
          e.position.addScaledVector(moveDir, e.speed * delta);
          e.position.y += Math.sin(performance.now() * 0.003) * delta * 1.2;
          e.meshGroup.position.copy(e.position);
          e.meshGroup.lookAt(new THREE.Vector3(0, e.position.y, 0));
          e.fenceAttackCountdown = undefined;
          e.isAttackingFence = false;
        } else {
          // 悬停在铁围栏外圈 (R=3.2m)，开始倒计时攻击围栏 (3.0s)
          e.isAttackingFence = true;
          if (e.fenceAttackCountdown === undefined) {
            e.fenceAttackCountdown = THREE.MathUtils.randFloat(3.0, 4.0);
          }
          e.fenceAttackCountdown -= delta;
          // 扑翼爪抓动画
          e.position.y = 1.2 + Math.sin(performance.now() * 0.008) * 0.15;
          e.meshGroup.position.copy(e.position);
          e.meshGroup.lookAt(new THREE.Vector3(0, e.position.y, 0));

          if (e.fenceAttackCountdown <= 0) {
            e.fenceAttackCountdown = 3.2; // 周期性攻击
            if (this.onFenceDamageCallback) {
              this.onFenceDamageCallback(10, e.position); // 蝙蝠每次抓挠 -10 HP
            }
          }
        }
      } else {
        // 普通盘旋
        e.position.x += Math.sin(performance.now() * 0.0018 + e.speed) * delta * 3.5;
        e.position.z += Math.cos(performance.now() * 0.0018 + e.speed) * delta * 3.5;
        e.position.y += Math.sin(performance.now() * 0.003) * delta * 1.5;
        e.meshGroup.position.copy(e.position);
        e.meshGroup.lookAt(e.position.clone().add(new THREE.Vector3(1, 0, 1)));
      }
      return;
    }

    // 5. 南瓜怪 (Pumpkin)：在围栏外环跳跃 (R in [3.8, 9.0])，纯得分目标，不对铁栏造成破坏
    if (e.type === 'pumpkin') {
      const distToCenter = Math.sqrt(e.position.x * e.position.x + e.position.z * e.position.z);
      if (distToCenter < 3.8) {
        // 弹离围栏
        const pushDir = new THREE.Vector3(e.position.x, 0, e.position.z).normalize();
        e.position.addScaledVector(pushDir, 0.5 * delta);
        e.meshGroup.position.x = e.position.x;
        e.meshGroup.position.z = e.position.z;
      }
      return;
    }

    // 6. 僵尸 (Zombie)：万圣节圆形围栏防卫 (直奔围栏 R=3.1m，停在栏外倒计时 3.5~4.5s 拍打栏杆破坏)
    if (e.type === 'zombie' && this.currentMode === 'ghost') {
      const distToCenter = Math.sqrt(e.position.x * e.position.x + e.position.z * e.position.z);
      if (distToCenter > 3.1) {
        // 缓慢走向玩家所在的铁围栏
        const dir = new THREE.Vector3(-e.position.x, 0, -e.position.z).normalize();
        e.position.addScaledVector(dir, e.speed * delta);
        e.meshGroup.position.copy(e.position);
        e.meshGroup.lookAt(new THREE.Vector3(0, -1.5, 0));
        e.fenceAttackCountdown = undefined;
        e.isAttackingFence = false;
      } else {
        // 被铁围栏挡在外面，无法跨入！
        const norm = new THREE.Vector3(e.position.x, 0, e.position.z).normalize();
        e.position.x = norm.x * 3.1;
        e.position.z = norm.z * 3.1;
        e.meshGroup.position.copy(e.position);
        e.meshGroup.lookAt(new THREE.Vector3(0, -1.5, 0));

        e.isAttackingFence = true;
        if (e.fenceAttackCountdown === undefined) {
          e.fenceAttackCountdown = THREE.MathUtils.randFloat(3.5, 4.5);
        }
        e.fenceAttackCountdown -= delta;

        if (e.fenceAttackCountdown <= 0) {
          e.fenceAttackCountdown = 3.8; // 倒计时重置，继续猛砸
          if (this.onFenceDamageCallback) {
            this.onFenceDamageCallback(15, e.position); // 僵尸重击 -15 HP
          }
        }
      }
      return;
    }

    // 7. 荒野狩猎：地面动物 360° 原野漫步 (严格保持距玩家 > 5.5m 黄金安全距离，绝不在眼前贴脸突脸)
    const inStream = Math.abs(e.position.z - -4.5) < 1.6;
    let actualSpeed = e.speed;
    if (inStream) actualSpeed *= 0.6; // 溪流减速

    if (e.stateTimer <= 0) {
      e.stateTimer = THREE.MathUtils.randFloat(3, 7);

      if (e.type === 'deer' && inStream && Math.random() < 0.5) {
        e.state = 'drinking';
        if (e.headMesh) e.headMesh.rotation.x = Math.PI / 4; // 低头饮水
      } else if (e.type === 'bear') {
        // 灰熊：漫步巡逻，但与玩家保持至少 6.5m 距离
        e.state = 'wandering';
        const randAngle = Math.random() * Math.PI * 2;
        const randDist = THREE.MathUtils.randFloat(7.0, 14.0);
        e.targetPos.set(Math.sin(randAngle) * randDist, -1.5, -Math.cos(randAngle) * randDist);
      } else {
        e.state = 'wandering';
        if (e.headMesh) e.headMesh.rotation.x = 0;
        const randAngle = Math.random() * Math.PI * 2;
        // 确保游走目标点在 6.0m ~ 14.5m，绝不靠近玩家中心 5.5m 以内
        const randDist = THREE.MathUtils.randFloat(6.2, 14.0);
        e.targetPos.set(Math.sin(randAngle) * randDist, -1.5, -Math.cos(randAngle) * randDist);
      }
    }

    if (e.state === 'drinking') return;

    // 猎犬追逐猎物
    if (e.type === 'dog') {
      const closestPrey = this.entities.find((prey) => !prey.isFriendly && !prey.isDying);
      if (closestPrey) {
        e.targetPos.copy(closestPrey.position);
      }
    }

    // 朝向目标点平移与转向
    this.tempDir.subVectors(e.targetPos, e.position);
    this.tempDir.y = 0;
    const distToTarget = this.tempDir.length();

    if (distToTarget > 0.2) {
      this.tempDir.normalize();
      e.position.addScaledVector(this.tempDir, actualSpeed * delta);

      // 安全缓冲区防御：如果动物无意中靠近玩家 (< 5.5m)，自动向外推挤
      const distToPlayerOrigin = Math.sqrt(e.position.x * e.position.x + e.position.z * e.position.z);
      if (distToPlayerOrigin < 5.5) {
        const pushVector = new THREE.Vector3(e.position.x, 0, e.position.z).normalize();
        if (pushVector.lengthSq() < 0.001) pushVector.set(0, 0, 1);
        e.position.x = pushVector.x * 5.6;
        e.position.z = pushVector.z * 5.6;
      }

      e.meshGroup.position.copy(e.position);
      const lookTarget = e.position.clone().add(this.tempDir);
      e.meshGroup.lookAt(lookTarget);
    }
  }

  // ==========================================================================
  // 敌机等离子子弹弹幕射击与规避机制
  // ==========================================================================

  public getEnemyProjectiles(): { position: THREE.Vector3; velocity: THREE.Vector3; life: number }[] {
    return this.enemyProjectiles.map((p) => ({
      position: p.position.clone(),
      velocity: p.velocity.clone(),
      life: p.life,
    }));
  }

  private fireEnemyPlasma(origin: THREE.Vector3): void {
    const pGroup = new THREE.Group();

    // 1. 炽热等离子能量球核
    const coreGeo = new THREE.SphereGeometry(0.16, 10, 10);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0xff0044 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    pGroup.add(core);

    // 2. 外部脉冲能量光晕
    const haloGeo = new THREE.SphereGeometry(0.28, 8, 8);
    const haloMat = new THREE.MeshBasicMaterial({ color: 0xff6600, transparent: true, opacity: 0.5 });
    const halo = new THREE.Mesh(haloGeo, haloMat);
    pGroup.add(halo);

    // 3. 拖尾高能等离子尾锥 (面向来路)
    const tailGeo = new THREE.ConeGeometry(0.14, 0.75, 6);
    const tailMat = new THREE.MeshBasicMaterial({ color: 0xff3300, transparent: true, opacity: 0.65 });
    const tail = new THREE.Mesh(tailGeo, tailMat);
    tail.rotation.x = Math.PI / 2;
    tail.position.z = 0.38;
    pGroup.add(tail);

    pGroup.position.copy(origin);

    // 朝向玩家当前相机位置发射 (降低弹速至 4.8 m/s，留出充足从容的闪避反应窗口)
    const dir = new THREE.Vector3().subVectors(this.tempCamPos, origin).normalize();
    const speed = 4.8;
    const velocity = dir.multiplyScalar(speed);

    pGroup.lookAt(this.tempCamPos);

    this.projectileGroup.add(pGroup);
    this.enemyProjectiles.push({
      mesh: pGroup as unknown as THREE.Mesh,
      position: pGroup.position,
      velocity,
      life: 5.5,
      maxLife: 5.5,
    });

    if (this.onEnemyFireCallback) {
      this.onEnemyFireCallback();
    }
  }

  private updateEnemyProjectiles(delta: number): void {
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const p = this.enemyProjectiles[i];
      p.life -= delta;

      p.position.addScaledVector(p.velocity, delta);
      p.mesh.position.copy(p.position);

      // 判断是否击中玩家座舱 (< 0.65m)
      const distToPlayer = p.position.distanceTo(this.tempCamPos);
      if (distToPlayer < 0.65) {
        // 击中玩家！
        if (this.onPlayerHitCallback) {
          this.onPlayerHitCallback();
        }
        this.projectileGroup.remove(p.mesh);
        p.mesh.traverse((c) => {
          if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
          if ((c as THREE.Mesh).material) {
            const mat = (c as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat.dispose();
          }
        });
        this.enemyProjectiles.splice(i, 1);
        continue;
      }

      // 超出寿命或飞远清理
      if (p.life <= 0 || p.position.distanceTo(this.tempCamPos) > 45) {
        this.projectileGroup.remove(p.mesh);
        p.mesh.traverse((c) => {
          if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry.dispose();
          if ((c as THREE.Mesh).material) {
            const mat = (c as THREE.Mesh).material;
            if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
            else mat.dispose();
          }
        });
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  // ==========================================================================
  // 射击命中、射线检测与重生 (修复定时器模式穿透 Bug)
  // ==========================================================================

  public checkRayIntersection(raycaster: THREE.Raycaster): GameEntity | null {
    const active = this.entities.filter((e) => !e.isDying && e.meshGroup.visible);
    if (active.length === 0) return null;

    const meshes: THREE.Mesh[] = [];
    active.forEach((e) => {
      e.meshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh && child !== e.shadowMesh) {
          meshes.push(child);
        }
      });
    });

    const intersects = raycaster.intersectObjects(meshes, false);
    if (intersects.length > 0) {
      let curr: THREE.Object3D | null = intersects[0].object;
      while (curr && curr.parent && !curr.userData.gameEntity) {
        curr = curr.parent;
      }
      if (curr && curr.userData.gameEntity) {
        return curr.userData.gameEntity as GameEntity;
      }
    }
    return null;
  }

  public hitEntity(entity: GameEntity, damage: number = 1, hitPoint?: THREE.Vector3): EntityHitResult {
    const point = hitPoint || entity.position.clone();

    // 1. 友军误伤逻辑
    if (entity.isFriendly) {
      entity.stateTimer = 4.0;
      entity.state = 'fleeing';
      const fleeDir = entity.position.clone().sub(this.tempCamPos).normalize();
      entity.targetPos.copy(entity.position).addScaledVector(fleeDir, 8.0);
      entity.speed *= 1.6;

      const nameMap: Record<string, string> = { dog: '猎犬', cow: '奶牛', sheep: '绵羊' };
      return {
        hit: true,
        entity,
        isFriendly: true,
        killed: false,
        scoreChange: entity.scoreValue,
        point,
        name: nameMap[entity.type] || '友善生灵',
      };
    }

    // 2. 扣除生命与击退
    entity.health -= damage;

    // 丧尸与夜蝠受击后退 2.6m，并重置/打断当前攻城倒计时
    if (entity.type === 'zombie' || entity.type === 'bat') {
      const knockDir = new THREE.Vector3(entity.position.x, 0, entity.position.z).normalize();
      if (knockDir.lengthSq() < 0.001) knockDir.set(0, 0, 1);
      entity.position.addScaledVector(knockDir, 2.6);
      entity.meshGroup.position.copy(entity.position);
      entity.fenceAttackCountdown = undefined;
      entity.isAttackingFence = false;
    }

    if (entity.health <= 0) {
      entity.isDying = true;
      this.createExplosion(point, entity.type);
      this.rootGroup.remove(entity.meshGroup);

      const idx = this.entities.indexOf(entity);
      if (idx !== -1) {
        this.entities.splice(idx, 1);
      }

      // 修复核心 Bug：记录当前实体的模式，并在重生时严格校验模式是否已改变！
      const entityMode = entity.mode;
      const entityType = entity.type;

      const timerId = window.setTimeout(() => {
        // 如果当前模式已经切换，则绝不跨模式重生熊或动物！
        if (this.currentMode !== entityMode) return;
        this.spawnEntity(entityType);
      }, 2200);

      this.respawnTimerIds.push(timerId);

      const nameMap: Record<string, string> = {
        deer: '野鹿',
        boar: '野猪',
        bear: '巨熊',
        starfighter: '敌机战舰',
        alien: '星际异兽',
        ghost: '幽灵',
        bat: '夜蝠',
        zombie: '僵尸',
        pumpkin: '南瓜怪',
      };

      return {
        hit: true,
        entity,
        isFriendly: false,
        killed: true,
        scoreChange: entity.scoreValue,
        point,
        name: nameMap[entity.type] || '目标',
      };
    }

    return {
      hit: true,
      entity,
      isFriendly: false,
      killed: false,
      scoreChange: 30,
      point,
      name: '目标',
    };
  }

  private createExplosion(pos: THREE.Vector3, type: EntityType): void {
    const count = 36;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const color =
      type === 'deer'
        ? 0xb07d4f
        : type === 'boar'
        ? 0xef4444
        : type === 'bear'
        ? 0xf59e0b
        : type === 'starfighter'
        ? 0x38bdf8
        : type === 'bat'
        ? 0xa855f7
        : type === 'pumpkin'
        ? 0xf97316
        : 0x00f3ff;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = pos.x;
      positions[i3 + 1] = pos.y + 0.5;
      positions[i3 + 2] = pos.z;

      const spd = THREE.MathUtils.randFloat(3, 7);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;

      velocities[i3] = spd * Math.sin(phi) * Math.cos(theta);
      velocities[i3 + 1] = spd * Math.sin(phi) * Math.sin(theta);
      velocities[i3 + 2] = spd * Math.cos(phi);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.PointsMaterial({
      color,
      size: 0.22,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const p = new THREE.Points(geo, mat);
    p.userData = { life: 0.55, maxLife: 0.55 };
    this.rootGroup.add(p);
    this.deathParticles.push(p);
  }

  private updateParticles(delta: number): void {
    for (let i = this.deathParticles.length - 1; i >= 0; i--) {
      const p = this.deathParticles[i];
      p.userData.life -= delta;

      if (p.userData.life <= 0) {
        this.rootGroup.remove(p);
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
        this.deathParticles.splice(i, 1);
        continue;
      }

      (p.material as THREE.PointsMaterial).opacity = p.userData.life / p.userData.maxLife;
      const posAttr = p.geometry.getAttribute('position') as THREE.BufferAttribute;
      const velAttr = p.geometry.getAttribute('velocity') as THREE.BufferAttribute;
      const posArr = posAttr.array as Float32Array;
      const velArr = velAttr.array as Float32Array;

      for (let j = 0; j < posAttr.count; j++) {
        const j3 = j * 3;
        posArr[j3] += velArr[j3] * delta;
        posArr[j3 + 1] += velArr[j3 + 1] * delta;
        posArr[j3 + 2] += velArr[j3 + 2] * delta;
      }
      posAttr.needsUpdate = true;
    }
  }

  public getActiveTargets(): GameEntity[] {
    return this.entities.filter(
      (e) => !e.isFriendly && !e.isDying && (e.type !== 'ghost' || e.currentOpacity > 0.15)
    );
  }

  public getAliveTargetCount(): number {
    return this.entities.filter((e) => !e.isFriendly && !e.isDying).length;
  }

  public clearAll(): void {
    // 1. 彻底清除所有正在等待执行的延迟重生定时器！
    this.respawnTimerIds.forEach((id) => clearTimeout(id));
    this.respawnTimerIds = [];

    // 2. 清除所有实体网格
    while (this.rootGroup.children.length > 0) {
      const child = this.rootGroup.children[0];
      this.rootGroup.remove(child);
      child.traverse((node) => {
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

    // 3. 清理敌机子弹
    while (this.projectileGroup.children.length > 0) {
      const p = this.projectileGroup.children[0];
      this.projectileGroup.remove(p);
      if (p instanceof THREE.Mesh) {
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
      }
    }

    this.entities = [];
    this.enemyProjectiles = [];
    this.deathParticles = [];
  }
}
