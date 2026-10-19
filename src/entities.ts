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

  // 临时辅助向量
  private readonly tempCamPos = new THREE.Vector3();
  private readonly tempCamDir = new THREE.Vector3();
  private readonly tempDir = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    onPlayerHit?: () => void,
    onEnemyFire?: () => void
  ) {
    this.scene = scene;
    this.scene.add(this.rootGroup);
    this.scene.add(this.projectileGroup);
    this.onPlayerHitCallback = onPlayerHit;
    this.onEnemyFireCallback = onEnemyFire;
  }

  public setMode(mode: GameMode): void {
    this.currentMode = mode;
  }

  // ==========================================================================
  // 生态群落初始化
  // ==========================================================================

  /**
   * 1. 荒野狩猎：360° 自然生灵群落 (目标猎物 + 友善禁射动物)
   */
  public initHuntingEcosystem(): void {
    this.clearAll();
    this.currentMode = 'hunting';

    // 目标猎物：野鹿、野猪、巨熊
    this.spawnEntity('deer');
    this.spawnEntity('deer');
    this.spawnEntity('boar');
    this.spawnEntity('boar');
    this.spawnEntity('bear');

    // 友善禁射生灵：敏捷猎犬、奶牛、绵羊
    this.spawnEntity('dog');
    this.spawnEntity('cow');
    this.spawnEntity('cow');
    this.spawnEntity('sheep');
    this.spawnEntity('sheep');
  }

  /**
   * 2. 星际防卫：360° 太空战机与异兽
   */
  public initSciFiEcosystem(): void {
    this.clearAll();
    this.currentMode = 'scifi';

    // 生成敌方太空战斗机 (Starfighters) 与脉冲异兽 (Aliens)
    for (let i = 0; i < 4; i++) {
      this.spawnEntity('starfighter');
    }
    for (let i = 0; i < 3; i++) {
      this.spawnEntity('alien');
    }
  }

  /**
   * 3. 万圣夜惊魂：360° 万圣节主题怪物 (幽灵、蝙蝠、僵尸、南瓜怪)
   */
  public initGhostEcosystem(): void {
    this.clearAll();
    this.currentMode = 'ghost';

    // 浮空幽灵、飞舞蝙蝠、地面蹒跚僵尸、蹦跳南瓜怪
    this.spawnEntity('ghost');
    this.spawnEntity('ghost');
    this.spawnEntity('bat');
    this.spawnEntity('bat');
    this.spawnEntity('zombie');
    this.spawnEntity('zombie');
    this.spawnEntity('pumpkin');
    this.spawnEntity('pumpkin');
  }

  // ==========================================================================
  // 实体生成系统 (360° 环绕生成)
  // ==========================================================================

  public spawnEntity(type: EntityType): GameEntity {
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

    // 360° 开放环绕生成 (0 ~ 2π)
    const angle = Math.random() * Math.PI * 2;
    const radius =
      type === 'bear'
        ? 8.0
        : type === 'starfighter'
        ? THREE.MathUtils.randFloat(7.5, 14.0)
        : THREE.MathUtils.randFloat(4.2, 9.5);

    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    let y = groundY;

    if (!isGround) {
      if (type === 'bat') {
        y = THREE.MathUtils.randFloat(0.5, 2.4);
      } else if (type === 'starfighter') {
        y = THREE.MathUtils.randFloat(-1.0, 3.5);
      } else {
        y = THREE.MathUtils.randFloat(-0.6, 2.2);
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
        scoreValue = 140;
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
    const deerMat = new THREE.MeshStandardMaterial({ color: 0xb47e4f, roughness: 0.75, flatShading: true });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.8 });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0xfffaed, roughness: 0.35 });
    mats.push(deerMat, whiteMat, antlerMat);

    // 身体流线型多边形
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.68, 0.75, 1.45), deerMat);
    body.position.y = 1.15;
    parent.add(body);

    // 浅白色下腹部与臀部
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 1.2), whiteMat);
    belly.position.set(0, 0.88, 0);
    parent.add(belly);

    // 挺拔优雅的长颈部
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 0.85, 6), deerMat);
    neck.position.set(0, 1.6, 0.55);
    neck.rotation.x = Math.PI / 5.5;
    parent.add(neck);

    // 鹿头
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.35, 0.55), deerMat);
    head.position.set(0, 1.95, 0.8);
    parent.add(head);

    // 对称多叉立体鹿角
    [-0.16, 0.16].forEach((side) => {
      const main = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.65, 5), antlerMat);
      main.position.set(side, 2.32, 0.75);
      main.rotation.z = side * -0.45;
      main.rotation.x = -0.25;
      parent.add(main);

      const branch1 = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.32, 4), antlerMat);
      branch1.position.set(side * 1.5, 2.42, 0.82);
      branch1.rotation.z = side * -0.8;
      parent.add(branch1);
    });

    // 四条修长鹿腿 (支持四足奔跑伸展跳跃)
    const legGeo = new THREE.CylinderGeometry(0.065, 0.045, 0.85, 5);
    [
      [-0.24, 0.45],
      [0.24, 0.45],
      [-0.24, -0.45],
      [0.24, -0.45],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, deerMat);
      leg.position.set(lx, 0.42, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return head;
  }

  /**
   * 2. 逼真野猪 (Boar)：厚实躯体、拱起刚毛脊椎脊棱、锋利白色反曲獠牙
   */
  private buildBoarMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const boarMat = new THREE.MeshStandardMaterial({ color: 0x3d312a, roughness: 0.9, flatShading: true });
    const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x1f1712, roughness: 0.95 });
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    mats.push(boarMat, ridgeMat, tuskMat);

    // 粗厚敦实身躯
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 1.4), boarMat);
    body.position.y = 0.75;
    parent.add(body);

    // 脊背刚毛凸起
    const ridge = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.28, 1.3), ridgeMat);
    ridge.position.set(0, 1.25, 0);
    parent.add(ridge);

    // 头部与粗大鼻吻
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 0.8), boarMat);
    head.position.set(0, 0.65, 0.85);
    parent.add(head);

    // 向上反挑的锋利獠牙
    [-0.32, 0.32].forEach((tx) => {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 5), tuskMat);
      tusk.position.set(tx, 0.55, 1.15);
      tusk.rotation.x = -Math.PI / 3;
      tusk.rotation.z = tx * -0.3;
      parent.add(tusk);
    });

    // 四条低重心短粗腿
    const legGeo = new THREE.CylinderGeometry(0.12, 0.09, 0.5, 6);
    [
      [-0.34, 0.45],
      [0.34, 0.45],
      [-0.34, -0.45],
      [0.34, -0.45],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, boarMat);
      leg.position.set(lx, 0.25, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return head;
  }

  /**
   * 3. 逼真巨熊 (Bear)：庞大肩部肌肉隆起 (Hump)、宽阔熊头、厚实巨掌
   */
  private buildBearMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const bearMat = new THREE.MeshStandardMaterial({ color: 0x2e1f16, roughness: 0.95, flatShading: true });
    mats.push(bearMat);

    // 宽厚庞大躯干
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.35, 2.1), bearMat);
    body.position.y = 1.28;
    parent.add(body);

    // 肩胛部强壮肌肉隆起
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.68, 8, 8), bearMat);
    hump.position.set(0, 1.85, 0.45);
    parent.add(hump);

    // 熊头
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.78, 0.95), bearMat);
    head.position.set(0, 1.62, 1.25);
    parent.add(head);

    // 浑圆熊耳
    [-0.32, 0.32].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), bearMat);
      ear.position.set(ex, 2.05, 1.15);
      parent.add(ear);
    });

    // 强健厚重熊腿
    const legGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.8, 7);
    [
      [-0.55, 0.65],
      [0.55, 0.65],
      [-0.55, -0.65],
      [0.55, -0.65],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, bearMat);
      leg.position.set(lx, 0.4, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return head;
  }

  /**
   * 4. 猎犬 (Hound Dog)：亮蓝色友军项圈、活跃摇摆尾巴、敏捷躯体
   */
  private buildHoundDogMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd97724, roughness: 0.8, flatShading: true });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });
    const collarMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff }); // 亮蓝色友军项圈
    mats.push(bodyMat, whiteMat, collarMat);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.95), bodyMat);
    body.position.y = 0.65;
    parent.add(body);

    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), whiteMat);
    chest.position.set(0, 0.6, 0.32);
    parent.add(chest);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.45), bodyMat);
    head.position.set(0, 0.95, 0.55);
    parent.add(head);

    // 醒目亮蓝项圈
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 16), collarMat);
    collar.position.set(0, 0.82, 0.45);
    collar.rotation.x = Math.PI / 3;
    parent.add(collar);

    // 活跃摇尾
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.45, 5), whiteMat);
    tail.position.set(0, 0.9, -0.55);
    tail.rotation.x = -Math.PI / 4;
    parent.add(tail);

    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.45, 5);
    [
      [-0.18, 0.35],
      [0.18, 0.35],
      [-0.18, -0.35],
      [0.18, -0.35],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, whiteMat);
      leg.position.set(lx, 0.22, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return tail;
  }

  /**
   * 5. 奶牛 (Cow)
   */
  private buildCowMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): THREE.Mesh {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8, flatShading: true });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
    mats.push(whiteMat, blackMat, hornMat);

    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.8), whiteMat);
    body.position.y = 1.1;
    parent.add(body);

    // 奶牛黑斑
    const patch1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.6), blackMat);
    patch1.position.set(0.4, 1.15, 0.3);
    parent.add(patch1);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.7), whiteMat);
    head.position.set(0, 1.45, 1.1);
    parent.add(head);

    [-0.32, 0.32].forEach((hx) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), hornMat);
      horn.position.set(hx, 1.85, 1.05);
      horn.rotation.z = hx * -0.6;
      parent.add(horn);
    });

    const legGeo = new THREE.CylinderGeometry(0.14, 0.11, 0.75, 6);
    [
      [-0.45, 0.6],
      [0.45, 0.6],
      [-0.45, -0.6],
      [0.45, -0.6],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, whiteMat);
      leg.position.set(lx, 0.38, lz);
      parent.add(leg);
      legs.push(leg);
    });

    return head;
  }

  /**
   * 6. 绵羊 (Sheep)
   */
  private buildSheepMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 1.0, flatShading: true });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    mats.push(woolMat, faceMat);

    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 1), woolMat);
    body.scale.set(1.1, 0.9, 1.3);
    body.position.y = 0.75;
    parent.add(body);

    const face = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.38), faceMat);
    face.position.set(0, 0.85, 0.75);
    parent.add(face);

    const legGeo = new THREE.CylinderGeometry(0.06, 0.05, 0.5, 5);
    [
      [-0.25, 0.35],
      [0.25, 0.35],
      [-0.25, -0.35],
      [0.25, -0.35],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, faceMat);
      leg.position.set(lx, 0.25, lz);
      parent.add(leg);
      legs.push(leg);
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
    // 1. 太空战斗机 (Starfighter)：战术盘旋 + 周期性向玩家座舱发射等离子弹
    if (e.type === 'starfighter') {
      e.meshGroup.rotation.y += delta * 0.8;
      // 环形战术机动轨道
      e.position.x += Math.cos(performance.now() * 0.001 + e.speed) * delta * 2.5;
      e.position.z += Math.sin(performance.now() * 0.001 + e.speed) * delta * 2.5;
      e.meshGroup.position.copy(e.position);
      e.meshGroup.lookAt(this.tempCamPos);

      // 周期性朝向玩家飞船座舱开火！
      if (e.fireCooldown !== undefined) {
        e.fireCooldown -= delta;
        if (e.fireCooldown <= 0) {
          e.fireCooldown = THREE.MathUtils.randFloat(3.2, 6.0);
          this.fireEnemyPlasma(e.position);
        }
      }
      return;
    }

    // 2. 异兽 (Alien)
    if (e.type === 'alien') {
      e.meshGroup.rotation.y += delta * 1.5;
      return;
    }

    // 3. 幽灵 (Ghost)：准星手电筒夹角 < 12° (dot > 0.978) 显形逃逸
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

    // 4. 蝙蝠 (Bat)：在 3D 空中做俯冲曲线盘旋
    if (e.type === 'bat') {
      e.position.x += Math.sin(performance.now() * 0.0018 + e.speed) * delta * 3.5;
      e.position.z += Math.cos(performance.now() * 0.0018 + e.speed) * delta * 3.5;
      e.position.y += Math.sin(performance.now() * 0.003) * delta * 1.5;
      e.meshGroup.position.copy(e.position);
      e.meshGroup.lookAt(e.position.clone().add(new THREE.Vector3(1, 0, 1)));
      return;
    }

    // 5. 地面动物与僵尸：360° 原野漫步与转向
    const inStream = Math.abs(e.position.z - -4.5) < 1.6;
    let actualSpeed = e.speed;
    if (inStream) actualSpeed *= 0.6; // 溪流减速

    if (e.stateTimer <= 0) {
      e.stateTimer = THREE.MathUtils.randFloat(3, 7);

      if (e.type === 'deer' && inStream && Math.random() < 0.5) {
        e.state = 'drinking';
        if (e.headMesh) e.headMesh.rotation.x = Math.PI / 4; // 低头饮水
      } else if (e.type === 'bear' || e.type === 'zombie') {
        // 灰熊与僵尸：缓慢朝向玩家逼近
        e.state = 'wandering';
        e.targetPos.copy(this.tempCamPos);
        e.targetPos.y = -1.5;
      } else {
        e.state = 'wandering';
        if (e.headMesh) e.headMesh.rotation.x = 0;
        const randAngle = Math.random() * Math.PI * 2;
        const randDist = THREE.MathUtils.randFloat(3.5, 9.5);
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
      e.meshGroup.position.copy(e.position);

      const lookTarget = e.position.clone().add(this.tempDir);
      e.meshGroup.lookAt(lookTarget);
    }
  }

  // ==========================================================================
  // 敌机等离子子弹弹幕射击与规避机制
  // ==========================================================================

  private fireEnemyPlasma(origin: THREE.Vector3): void {
    const geo = new THREE.SphereGeometry(0.14, 8, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff0055 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.copy(origin);

    // 朝向玩家当前相机位置发射
    const dir = new THREE.Vector3().subVectors(this.tempCamPos, origin).normalize();
    const speed = 7.5; // 7.5 m/s 适度弹速，给玩家通过摇杆或探身躲避反应时间
    const velocity = dir.multiplyScalar(speed);

    this.projectileGroup.add(mesh);
    this.enemyProjectiles.push({
      mesh,
      position: mesh.position,
      velocity,
      life: 5.0,
      maxLife: 5.0,
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

      // 判断是否击中玩家座舱 (< 0.75m)
      const distToPlayer = p.position.distanceTo(this.tempCamPos);
      if (distToPlayer < 0.75) {
        // 击中玩家！
        if (this.onPlayerHitCallback) {
          this.onPlayerHitCallback();
        }
        this.projectileGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
        this.enemyProjectiles.splice(i, 1);
        continue;
      }

      // 超出寿命或飞远清理
      if (p.life <= 0 || p.position.distanceTo(this.tempCamPos) > 40) {
        this.projectileGroup.remove(p.mesh);
        p.mesh.geometry.dispose();
        (p.mesh.material as THREE.Material).dispose();
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

    // 2. 扣除生命
    entity.health -= damage;

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
