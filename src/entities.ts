/**
 * AR-Shooter 生态实体与动物管理器 (entities.ts)
 * 包含荒野猎物 (野鹿、野猪、巨熊) 与友善禁射动物 (猎犬、奶牛、绵羊) 的低多边形 3D 几何建模，
 * 脚底圆形接触阴影 (Blob Shadow)、溪流减速与饮水行为 AI、
 * 准星智能分类识别与误伤倒扣分判定逻辑。
 */

import * as THREE from 'three';

export type EntityType = 'deer' | 'boar' | 'bear' | 'dog' | 'cow' | 'sheep' | 'alien' | 'ghost';

export interface GameEntity {
  id: string;
  type: EntityType;
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

  // AI 行为状态机
  state: 'wandering' | 'drinking' | 'hiding' | 'sprinting' | 'chasing' | 'fleeing';
  stateTimer: number;
  targetPos: THREE.Vector3;
  legMeshes: THREE.Mesh[];
  walkCycle: number;
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

  // 粒子与爆炸系统
  private deathParticles: THREE.Points[] = [];

  // 临时辅助向量
  private readonly tempCamPos = new THREE.Vector3();
  private readonly tempCamDir = new THREE.Vector3();
  private readonly tempDir = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.rootGroup);
  }

  /**
   * 初始化荒野狩猎生态群落
   */
  public initHuntingEcosystem(): void {
    this.clearAll();

    // 生成目标猎物: 2只野鹿、2只野猪、1只巨熊
    this.spawnEntity('deer');
    this.spawnEntity('deer');
    this.spawnEntity('boar');
    this.spawnEntity('boar');
    this.spawnEntity('bear');

    // 生成友善禁射目标: 1只敏捷猎犬、2头奶牛、2只绵羊
    this.spawnEntity('dog');
    this.spawnEntity('cow');
    this.spawnEntity('cow');
    this.spawnEntity('sheep');
    this.spawnEntity('sheep');
  }

  /**
   * 初始化经典星际防卫异兽群落
   */
  public initSciFiEcosystem(): void {
    this.clearAll();
    for (let i = 0; i < 6; i++) {
      this.spawnEntity('alien');
    }
  }

  /**
   * 初始化幽灵猎手生态群落
   */
  public initGhostEcosystem(): void {
    this.clearAll();
    for (let i = 0; i < 5; i++) {
      this.spawnEntity('ghost');
    }
  }

  /**
   * 创建并生成特定类型的三维实体
   */
  public spawnEntity(type: EntityType): GameEntity {
    const group = new THREE.Group();
    const materials: THREE.Material[] = [];
    const legs: THREE.Mesh[] = [];

    // 地面动物固定在 Y = -1.5，星际异兽与幽灵浮空
    const isGround = type !== 'alien' && type !== 'ghost';
    const groundY = -1.5;

    // 随机扇形方位 (围绕玩家前方 R in [3.5, 9.0] 米)
    const angle = THREE.MathUtils.randFloat(-Math.PI * 0.75, Math.PI * 0.75);
    const radius = type === 'bear' ? 7.5 : THREE.MathUtils.randFloat(3.8, 7.8);
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    const y = isGround ? groundY : THREE.MathUtils.randFloat(-0.8, 2.2);

    const pos = new THREE.Vector3(x, y, z);
    group.position.copy(pos);

    let shadow: THREE.Mesh | undefined;
    let isFriendly = false;
    let scoreValue = 100;
    let health = 1;
    let speed = 1.2;

    // 根据物种构建高辨识度低多边形三维模型
    switch (type) {
      case 'deer':
        this.buildDeerMesh(group, materials, legs);
        isFriendly = false;
        scoreValue = 100;
        health = 1;
        speed = 2.4;
        break;
      case 'boar':
        this.buildBoarMesh(group, materials, legs);
        isFriendly = false;
        scoreValue = 150;
        health = 1;
        speed = 3.6;
        break;
      case 'bear':
        this.buildBearMesh(group, materials, legs);
        isFriendly = false;
        scoreValue = 300;
        health = 3; // 高血量耐打
        speed = 0.9;
        break;
      case 'dog':
        this.buildHoundDogMesh(group, materials, legs);
        isFriendly = true;
        scoreValue = -200; // 误伤巨额扣分
        health = 999;
        speed = 4.2;
        break;
      case 'cow':
        this.buildCowMesh(group, materials, legs);
        isFriendly = true;
        scoreValue = -150;
        health = 999;
        speed = 0.6;
        break;
      case 'sheep':
        this.buildSheepMesh(group, materials, legs);
        isFriendly = true;
        scoreValue = -100;
        health = 999;
        speed = 1.8;
        break;
      case 'alien':
        this.buildAlienMesh(group, materials);
        isFriendly = false;
        scoreValue = 100;
        health = 1;
        speed = 1.5;
        break;
      case 'ghost':
        this.buildGhostMesh(group, materials);
        isFriendly = false;
        scoreValue = 200;
        health = 1;
        speed = 3.2;
        break;
    }

    // 地面动物脚底圆形接触阴影 (Blob Shadow)
    if (isGround) {
      const shadowRadius = type === 'bear' ? 1.2 : type === 'cow' ? 1.4 : 0.8;
      const shadowGeo = new THREE.CircleGeometry(shadowRadius, 16);
      const shadowMat = new THREE.MeshBasicMaterial({
        color: 0x050a0f,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
      });
      shadow = new THREE.Mesh(shadowGeo, shadowMat);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(0, 0.02, 0); // 微贴地面
      group.add(shadow);
      materials.push(shadowMat);
    }

    const entity: GameEntity = {
      id: `entity_${++this.entityIdCounter}_${type}`,
      type,
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
      state: 'wandering',
      stateTimer: THREE.MathUtils.randFloat(2, 5),
      targetPos: pos.clone(),
      legMeshes: legs,
      walkCycle: Math.random() * Math.PI * 2,
    };

    group.userData = { gameEntity: entity };
    this.rootGroup.add(group);
    this.entities.push(entity);

    return entity;
  }

  // ==========================================================================
  // 低多边形动物几何模型构造
  // ==========================================================================

  /**
   * 1. 野鹿 (Deer)：棕黄修长身躯、高挑长腿与分叉雄鹿角
   */
  private buildDeerMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const deerMat = new THREE.MeshStandardMaterial({ color: 0xb07d4f, roughness: 0.8, flatShading: true });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xdfbc9a, roughness: 0.9, flatShading: true });
    const antlerMat = new THREE.MeshStandardMaterial({ color: 0xfffaed, roughness: 0.4 });
    mats.push(deerMat, bellyMat, antlerMat);

    // 身体躯干 (椭圆柱)
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.75, 1.4), deerMat);
    body.position.y = 1.15;
    parent.add(body);

    // 腹部浅色提亮
    const belly = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.25, 1.2), bellyMat);
    belly.position.set(0, 0.9, 0);
    parent.add(belly);

    // 细长鹿颈与头部
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.28, 0.85, 6), deerMat);
    neck.position.set(0, 1.6, 0.55);
    neck.rotation.x = Math.PI / 6;
    parent.add(neck);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.35, 0.55), deerMat);
    head.position.set(0, 1.95, 0.8);
    parent.add(head);

    // 分叉金色鹿角 (对称树枝多面体)
    [-0.18, 0.18].forEach((side) => {
      const antlerMain = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.65, 5), antlerMat);
      antlerMain.position.set(side, 2.3, 0.75);
      antlerMain.rotation.z = side * -0.4;
      antlerMain.rotation.x = -0.2;
      parent.add(antlerMain);

      const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.04, 0.35, 4), antlerMat);
      branch.position.set(side * 1.5, 2.4, 0.85);
      branch.rotation.z = side * -0.8;
      parent.add(branch);
    });

    // 四条修长鹿腿
    const legGeo = new THREE.CylinderGeometry(0.07, 0.05, 0.85, 5);
    [
      [-0.25, 0.45],
      [0.25, 0.45],
      [-0.25, -0.45],
      [0.25, -0.45],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, deerMat);
      leg.position.set(lx, 0.42, lz);
      parent.add(leg);
      legs.push(leg);
    });
  }

  /**
   * 2. 野猪 (Boar)：黑褐色厚实躯体、拱形刚毛脊椎与白色弯曲獠牙
   */
  private buildBoarMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const boarMat = new THREE.MeshStandardMaterial({ color: 0x3d312a, roughness: 0.9, flatShading: true });
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 });
    mats.push(boarMat, tuskMat);

    // 粗厚敦实身体
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.85, 1.4), boarMat);
    body.position.y = 0.75;
    parent.add(body);

    // 宽阔头部与猪吻
    const snout = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.6, 0.8), boarMat);
    snout.position.set(0, 0.65, 0.85);
    parent.add(snout);

    // 向上挑起的锋利白色獠牙
    [-0.32, 0.32].forEach((tx) => {
      const tusk = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.32, 5), tuskMat);
      tusk.position.set(tx, 0.55, 1.15);
      tusk.rotation.x = -Math.PI / 3;
      tusk.rotation.z = tx * -0.3;
      parent.add(tusk);
    });

    // 四条粗壮短腿
    const legGeo = new THREE.CylinderGeometry(0.12, 0.09, 0.5, 6);
    [
      [-0.35, 0.45],
      [0.35, 0.45],
      [-0.35, -0.45],
      [0.35, -0.45],
    ].forEach(([lx, lz]) => {
      const leg = new THREE.Mesh(legGeo, boarMat);
      leg.position.set(lx, 0.25, lz);
      parent.add(leg);
      legs.push(leg);
    });
  }

  /**
   * 3. 灰熊 (Bear)：深褐色庞大躯干、浑圆耳朵、厚重巨掌
   */
  private buildBearMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const bearMat = new THREE.MeshStandardMaterial({ color: 0x2b1e16, roughness: 0.95, flatShading: true });
    mats.push(bearMat);

    // 庞大躯体
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.3, 2.0), bearMat);
    body.position.y = 1.25;
    parent.add(body);

    // 强壮肩部隆起
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.65, 8, 8), bearMat);
    hump.position.set(0, 1.8, 0.4);
    parent.add(hump);

    // 熊头与吻部
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.75, 0.9), bearMat);
    head.position.set(0, 1.6, 1.2);
    parent.add(head);

    // 浑圆熊耳
    [-0.32, 0.32].forEach((ex) => {
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.16, 6, 6), bearMat);
      ear.position.set(ex, 2.0, 1.1);
      parent.add(ear);
    });

    // 强健厚重熊掌腿
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
  }

  /**
   * 4. 猎犬 (Hound Dog)：橘白相间皮毛、显眼亮蓝色项圈、竖起小尾巴
   */
  private buildHoundDogMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xd97724, roughness: 0.8, flatShading: true });
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 });
    const collarMat = new THREE.MeshBasicMaterial({ color: 0x00f3ff }); // 鲜艳蓝色项圈
    mats.push(bodyMat, whiteMat, collarMat);

    // 敏捷身躯
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.5, 0.95), bodyMat);
    body.position.y = 0.65;
    parent.add(body);

    // 白色胸脯
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.35, 0.4), whiteMat);
    chest.position.set(0, 0.6, 0.32);
    parent.add(chest);

    // 狗头与下垂耳朵
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.35, 0.45), bodyMat);
    head.position.set(0, 0.95, 0.55);
    parent.add(head);

    // 亮蓝色发光项圈 (便于玩家一眼分辨友军防误伤)
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.05, 6, 16), collarMat);
    collar.position.set(0, 0.82, 0.45);
    collar.rotation.x = Math.PI / 3;
    parent.add(collar);

    // 欢快摇摆的尾巴
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.45, 5), whiteMat);
    tail.position.set(0, 0.9, -0.55);
    tail.rotation.x = -Math.PI / 4;
    parent.add(tail);

    // 敏捷四腿
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
  }

  /**
   * 5. 奶牛 (Cow)：黑白大斑块、一对小牛角与粉色口鼻
   */
  private buildCowMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1f5f9, roughness: 0.8, flatShading: true });
    const blackMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.9 });
    const hornMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.4 });
    mats.push(whiteMat, blackMat, hornMat);

    // 宽大白色牛身
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.1, 1.8), whiteMat);
    body.position.y = 1.1;
    parent.add(body);

    // 黑色几何奶牛斑块
    const patch1 = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.6, 0.6), blackMat);
    patch1.position.set(0.4, 1.15, 0.3);
    parent.add(patch1);

    const patch2 = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.5, 0.5), blackMat);
    patch2.position.set(-0.45, 1.05, -0.4);
    parent.add(patch2);

    // 牛头与牛角
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.65, 0.7), whiteMat);
    head.position.set(0, 1.45, 1.1);
    parent.add(head);

    [-0.32, 0.32].forEach((hx) => {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), hornMat);
      horn.position.set(hx, 1.85, 1.05);
      horn.rotation.z = hx * -0.6;
      parent.add(horn);
    });

    // 稳重四腿
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
  }

  /**
   * 6. 绵羊 (Sheep)：白色蓬松云朵状绒毛、小巧黑脸
   */
  private buildSheepMesh(parent: THREE.Group, mats: THREE.Material[], legs: THREE.Mesh[]): void {
    const woolMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 1.0, flatShading: true });
    const faceMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
    mats.push(woolMat, faceMat);

    // 云团状圆润绒毛身体 (多层球体重叠)
    const body = new THREE.Mesh(new THREE.DodecahedronGeometry(0.65, 1), woolMat);
    body.scale.set(1.1, 0.9, 1.3);
    body.position.y = 0.75;
    parent.add(body);

    // 黑色呆萌羊脸
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.38), faceMat);
    face.position.set(0, 0.85, 0.75);
    parent.add(face);

    // 细小黑腿
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
   * 7. 星际异兽 (Alien)：保留升级版脉冲核心多面体
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
   * 8. 幽灵猎手 (Ghost)：半透明浮空灵体，默认隐匿
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

    // 幽灵头部与上身
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 16), ghostMat);
    head.position.set(0, 0.4, 0);
    parent.add(head);

    // 幽灵下摆飘动身形
    const skirt = new THREE.Mesh(new THREE.ConeGeometry(0.48, 0.85, 16), ghostMat);
    skirt.rotation.x = Math.PI;
    skirt.position.set(0, -0.1, 0);
    parent.add(skirt);

    // 幽灵双眼 (红光)
    [-0.14, 0.14].forEach((ex) => {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.065, 8, 8), eyeMat);
      eye.position.set(ex, 0.45, 0.36);
      parent.add(eye);
    });
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

      // 1. AI 决策状态机更新
      this.updateEntityAI(e, delta);

      // 2. 肢体跑动摆腿步态动画 (如果有四肢)
      if (e.legMeshes.length === 4) {
        e.walkCycle += delta * e.speed * 4.5;
        const swing = Math.sin(e.walkCycle) * 0.45;
        e.legMeshes[0].rotation.x = swing;
        e.legMeshes[1].rotation.x = -swing;
        e.legMeshes[2].rotation.x = -swing;
        e.legMeshes[3].rotation.x = swing;
      }

      // 3. 巨熊逼近警戒距离判断
      if (e.type === 'bear') {
        const distToPlayer = e.position.distanceTo(this.tempCamPos);
        if (distToPlayer < 2.4) {
          // 逼近至贴脸，重置到远处防穿模
          e.position.set(e.position.x * 2.5, -1.5, e.position.z * 2.5);
          e.meshGroup.position.copy(e.position);
        }
      }
    }

    // 更新爆炸金币与粒子
    this.updateParticles(delta);
  }

  /**
   * 动物 AI 行为决策与转向平移
   */
  private updateEntityAI(e: GameEntity, delta: number): void {
    if (e.type === 'alien') {
      // 浮空异兽上下浮动与自转
      e.meshGroup.rotation.y += delta * 1.5;
      return;
    }

    if (e.type === 'ghost') {
      // 幽灵与相机射线夹角 (手电筒照亮机制：中心夹角 < 12 度显形)
      this.tempDir.subVectors(e.position, this.tempCamPos).normalize();
      const dot = this.tempCamDir.dot(this.tempDir);
      // 12 度夹角: cos(12°) ≈ 0.9781
      const isLitByFlashlight = dot > 0.978;
      const targetOpacity = isLitByFlashlight ? 0.92 : 0.03;
      e.currentOpacity += (targetOpacity - e.currentOpacity) * Math.min(1.0, delta * 9.0);

      // 同步材质透明度
      e.materials.forEach((m) => {
        m.opacity = e.currentOpacity;
      });

      // 幽灵在被照亮时试图遁逃 (横向或远离中心)
      if (isLitByFlashlight) {
        e.state = 'fleeing';
        const fleeDir = new THREE.Vector3().crossVectors(this.tempCamDir, new THREE.Vector3(0, 1, 0)).normalize();
        if (Math.random() < 0.5) fleeDir.negate();
        e.position.addScaledVector(fleeDir, e.speed * delta);
        e.meshGroup.position.copy(e.position);
      } else {
        // 未照亮时缓慢漂浮
        e.position.y += Math.sin(performance.now() * 0.002 + e.position.x) * 0.006;
        e.meshGroup.position.copy(e.position);
      }
      e.meshGroup.rotation.y += delta * 1.2;
      return;
    }

    // 溪流区域判定 (Z 处于 [-6.0, -3.0] 附近为溪流带)
    const inStream = Math.abs(e.position.z - -4.5) < 1.6;
    let actualSpeed = e.speed;
    if (inStream) {
      actualSpeed *= 0.6; // 经过溪流减速 40%
    }

    if (e.stateTimer <= 0) {
      e.stateTimer = THREE.MathUtils.randFloat(3, 7);

      if (e.type === 'deer' && inStream && Math.random() < 0.5) {
        // 野鹿在溪边停下做“低头饮水”动作
        e.state = 'drinking';
        e.meshGroup.rotation.x = Math.PI / 8; // 俯身低头
      } else if (e.type === 'bear') {
        // 灰熊始终缓慢朝向玩家逼近
        e.state = 'wandering';
        e.targetPos.copy(this.tempCamPos);
        e.targetPos.y = -1.5;
      } else {
        // 随机在地面漫游奔跑
        e.state = 'wandering';
        e.meshGroup.rotation.x = 0;
        const randAngle = Math.random() * Math.PI * 2;
        const randDist = THREE.MathUtils.randFloat(3.5, 8.5);
        e.targetPos.set(Math.sin(randAngle) * randDist, -1.5, -Math.cos(randAngle) * randDist);
      }
    }

    if (e.state === 'drinking') {
      return; // 饮水静止状态
    }

    // 猎犬追逐附近猎物 AI
    if (e.type === 'dog') {
      const closestPrey = this.entities.find((prey) => !prey.isFriendly && !prey.isDying);
      if (closestPrey) {
        e.targetPos.copy(closestPrey.position);
      }
    }

    // 向目标点平滑插值移动与朝向转向
    this.tempDir.subVectors(e.targetPos, e.position);
    this.tempDir.y = 0;
    const distToTarget = this.tempDir.length();

    if (distToTarget > 0.2) {
      this.tempDir.normalize();
      e.position.addScaledVector(this.tempDir, actualSpeed * delta);
      e.meshGroup.position.copy(e.position);

      // 面向移动方向
      const lookTarget = e.position.clone().add(this.tempDir);
      e.meshGroup.lookAt(lookTarget);
    }
  }

  /**
   * 准星射线精准相交检测 (返回优先击中的实体)
   */
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

  /**
   * 触发受击逻辑 (区分猎物与友军误伤)
   */
  public hitEntity(entity: GameEntity, damage: number = 1, hitPoint?: THREE.Vector3): EntityHitResult {
    const point = hitPoint || entity.position.clone();

    // 1. 误伤友善动物处理 (不死亡，但受惊逃窜并扣大分)
    if (entity.isFriendly) {
      entity.stateTimer = 4.0;
      entity.state = 'fleeing';
      // 快速向远离玩家方向受惊狂奔
      const fleeDir = entity.position.clone().sub(this.tempCamPos).normalize();
      entity.targetPos.copy(entity.position).addScaledVector(fleeDir, 8.0);
      entity.speed *= 1.6;

      const nameMap: Record<string, string> = { dog: '猎犬', cow: '奶牛', sheep: '绵羊' };
      return {
        hit: true,
        entity,
        isFriendly: true,
        killed: false,
        scoreChange: entity.scoreValue, // 负数扣分
        point,
        name: nameMap[entity.type] || '友善动物',
      };
    }

    // 2. 目标猎物受击扣血
    entity.health -= damage;

    if (entity.health <= 0) {
      entity.isDying = true;
      this.createExplosion(point, entity.type);
      this.rootGroup.remove(entity.meshGroup);

      // 从集合中移除并计划在 2 秒后补充新动物
      const idx = this.entities.indexOf(entity);
      if (idx !== -1) {
        this.entities.splice(idx, 1);
      }

      setTimeout(() => {
        this.spawnEntity(entity.type);
      }, 2200);

      const nameMap: Record<string, string> = { deer: '野鹿', boar: '野猪', bear: '巨熊', alien: '异兽', ghost: '幽灵' };
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

  /**
   * 击杀粒子爆炸
   */
  private createExplosion(pos: THREE.Vector3, type: EntityType): void {
    const count = 36;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const color = type === 'deer' ? 0xb07d4f : type === 'boar' ? 0xef4444 : type === 'bear' ? 0xf59e0b : 0x00f3ff;

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
    // 仅返回非友善的敌对目标 (幽灵仅在被探照照亮时显示指示箭头)
    return this.entities.filter((e) => !e.isFriendly && !e.isDying && (e.type !== 'ghost' || e.currentOpacity > 0.15));
  }

  public getAliveTargetCount(): number {
    return this.entities.filter((e) => !e.isFriendly && !e.isDying).length;
  }

  public clearAll(): void {
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
    this.entities = [];
    this.deathParticles = [];
  }
}
