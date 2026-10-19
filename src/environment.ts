/**
 * AR-Shooter 虚拟自然环境与掩体系统 (environment.ts)
 * 包含：
 * 1. 荒野狩猎：360°全开放原野、环形森林溪流带、全方位错落分布的松树、花岗岩巨石与灌木
 * 2. 星际太空：360°深空星海、超空间光速粒子雨 (Warp Speed Particle Rain)、漂浮太空陨石群
 * 3. 万圣夜惊魂：360°幽冥夜墓园、残破墓碑、枯萎扭曲古树、发光南瓜灯、漂浮鬼火流光 (Will-o'-the-wisps)
 * 以及 掩体物理击碎、破片飞溅抛射、陀螺仪歪头探身 (Peek System) 视差机制。
 */

import * as THREE from 'three';
import { TextureGenerator } from './textureGenerator';

export interface ObstacleEntity {
  id: string;
  type: 'tree' | 'rock' | 'bush' | 'shield' | 'tombstone' | 'pumpkin' | 'asteroid';
  meshGroup: THREE.Group;
  colliderMeshes: THREE.Mesh[];
  position: THREE.Vector3;
  radius: number;
  health: number;
  maxHealth: number;
  isDestroyed: boolean;
}

export interface ObstacleHitResult {
  hit: boolean;
  destroyed: boolean;
  obstacle: ObstacleEntity;
  damage: number;
  remainingHealth: number;
  name: string;
}

export class EnvironmentManager {
  private scene: THREE.Scene;
  private rootGroup = new THREE.Group();

  // 环境组件
  private groundMesh: THREE.Mesh | null = null;
  private streamMesh: THREE.Mesh | null = null;
  private waterTexture: THREE.CanvasTexture | null = null;
  private streamTime: number = 0;
  private obstacles: ObstacleEntity[] = [];

  // 太空光速粒子雨系统 (Warp Starfield)
  private warpStars: THREE.Points | null = null;
  private warpPositions: Float32Array | null = null;
  private warpVelocities: Float32Array | null = null;
  private warpStarCount: number = 380;

  // 万圣节鬼火系统 (Will-o'-the-wisps)
  private ghostFirePoints: THREE.Points | null = null;
  private ghostFireTime: number = 0;

  // 格挡火花与碎屑粒子系统
  private sparkParticles: THREE.Points[] = [];
  // 掩体崩解破片碎块系统
  private debrisMeshes: { mesh: THREE.Mesh; velocity: THREE.Vector3; rotSpeed: THREE.Vector3; life: number; maxLife: number }[] = [];

  // 歪头探身视差状态 (Peek System)
  private currentPeekX: number = 0;
  private targetPeekX: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.rootGroup);
  }

  // ==========================================================================
  // 1. 荒野狩猎：360° 全开放大自然场景
  // ==========================================================================

  public initHuntingEnvironment(): void {
    this.clearEnvironment();

    // 1. 360° 开放圆形地面 (Y = -1.5, 半径 32m)
    const groundGeo = new THREE.CircleGeometry(32, 48);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x162819,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, -1.5, 0);
    this.rootGroup.add(this.groundMesh);

    // 2. 360° 环形蜿蜒自然森林溪流 (围绕玩家半径 6.5m ~ 9.0m 环形带)
    this.build360CircularStream();

    // 3. 360° 全方位随机分布的天然掩体 (粗壮松树、花岗岩巨石与茂密灌木)
    this.build360HuntingObstacles();
  }

  /**
   * 构造 360° 环绕玩家流淌的高仿真动态溪流与两岸鹅卵石
   */
  private build360CircularStream(): void {
    const segments = 64;
    const innerRadius = 6.8;
    const outerRadius = 9.4;
    const streamGeo = new THREE.RingGeometry(innerRadius, outerRadius, segments, 4);
    const pos = streamGeo.attributes.position;

    // 让溪流环边缘产生天然弯曲起伏正弦形态与多重波纹
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i);
      const v = pos.getY(i);
      const angle = Math.atan2(v, u);
      const rad = Math.hypot(u, v);
      const wobble = Math.sin(angle * 5.0) * 0.42 + Math.cos(angle * 11.0) * 0.18;
      const newRad = rad + wobble;
      pos.setX(i, Math.cos(angle) * newRad);
      pos.setY(i, Math.sin(angle) * newRad);
    }
    streamGeo.computeVertexNormals();

    this.waterTexture = TextureGenerator.getWaterTexture();

    const streamMat = new THREE.MeshStandardMaterial({
      map: this.waterTexture,
      emissiveMap: this.waterTexture,
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.82,
      roughness: 0.15,
      metalness: 0.4,
      emissive: 0x0284c7,
      emissiveIntensity: 0.45,
      depthWrite: false,
    });

    this.streamMesh = new THREE.Mesh(streamGeo, streamMat);
    this.streamMesh.rotation.x = -Math.PI / 2;
    this.streamMesh.position.set(0, -1.48, 0);
    this.rootGroup.add(this.streamMesh);

    // 沿 360 度溪流环两侧布置 32 块不同大小的天然鹅卵石与苔藓石
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
      const isInner = Math.random() > 0.45;
      const pebbleRad = (isInner ? innerRadius - 0.35 : outerRadius + 0.35) + (Math.random() - 0.5) * 0.4;
      const pebbleGeo = new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.22, 1);
      pebbleGeo.scale(1.2, 0.7, 1.0);
      const isMossy = Math.random() > 0.5;
      const pebbleMat = new THREE.MeshStandardMaterial({
        color: isMossy ? 0x475569 : 0x64748b,
        roughness: 0.88,
      });
      const pebble = new THREE.Mesh(pebbleGeo, pebbleMat);
      pebble.position.set(Math.cos(angle) * pebbleRad, -1.45, Math.sin(angle) * pebbleRad);
      pebble.rotation.set(Math.random(), Math.random(), Math.random());
      this.rootGroup.add(pebble);
    }
  }

  /**
   * 360° 全景环绕分布的自然掩体
   */
  private build360HuntingObstacles(): void {
    // 360° 全方位分布自然掩体：中心 6m 范围内绝对净空，正前方留出开阔射击走廊，掩体位于 7.5m~14m
    const configs: { type: 'tree' | 'rock' | 'bush'; angle: number; dist: number }[] = [
      // 正前偏右与东部 (East, 30°~90°)
      { type: 'tree', angle: 0.65, dist: 9.2 },
      { type: 'rock', angle: 1.15, dist: 8.4 },
      { type: 'bush', angle: 1.57, dist: 7.8 },
      // 东南与背后偏右 (120°~165°)
      { type: 'tree', angle: 2.1, dist: 8.8 },
      { type: 'rock', angle: 2.65, dist: 9.5 },
      // 转身正后方林带 (South, 180°/PI，丰满视界，不留空档)
      { type: 'tree', angle: 3.14, dist: 8.2 },
      { type: 'rock', angle: 3.45, dist: 10.5 },
      { type: 'bush', angle: 3.85, dist: 7.9 },
      // 西南与西部 (West, 210°~270°)
      { type: 'tree', angle: 4.35, dist: 9.0 },
      { type: 'rock', angle: 4.75, dist: 8.6 },
      { type: 'bush', angle: 5.15, dist: 7.6 },
      // 西北与正前偏左 (300°~340°)
      { type: 'tree', angle: 5.65, dist: 9.4 },
      { type: 'rock', angle: 5.95, dist: 8.5 },
    ];

    configs.forEach((cfg, idx) => {
      const x = Math.sin(cfg.angle) * cfg.dist;
      const z = -Math.cos(cfg.angle) * cfg.dist;
      const group = new THREE.Group();
      group.position.set(x, -1.5, z);

      const colliders: THREE.Mesh[] = [];

      if (cfg.type === 'tree') {
        // 高仿真林中高大松树：真实树皮纹理树干 + 隆起树根 + 多层繁茂墨绿针叶松冠
        const barkTex = TextureGenerator.getTreeBarkTexture();
        const trunkGeo = new THREE.CylinderGeometry(0.3, 0.58, 3.4, 8);
        const trunkMat = new THREE.MeshStandardMaterial({
          map: barkTex,
          roughness: 0.88,
          metalness: 0.05,
        });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.7;
        group.add(trunk);
        colliders.push(trunk);

        // 树根向四周外扩抓地
        const rootGeo = new THREE.ConeGeometry(0.85, 0.6, 7);
        const root = new THREE.Mesh(rootGeo, trunkMat);
        root.position.y = 0.3;
        group.add(root);

        // 4 层层叠渐进针叶松冠
        const foliageColors = [0x143625, 0x1b4332, 0x2d6a4f, 0x40916c];
        for (let l = 0; l < 4; l++) {
          const foliageMat = new THREE.MeshStandardMaterial({
            color: foliageColors[l],
            roughness: 0.75,
            flatShading: true,
          });
          const cone = new THREE.Mesh(
            new THREE.ConeGeometry(1.8 - l * 0.38, 1.6, 7),
            foliageMat
          );
          cone.position.y = 2.6 + l * 0.95;
          cone.rotation.y = l * 0.45;
          group.add(cone);
          colliders.push(cone);
        }
      } else if (cfg.type === 'rock') {
        // 青灰色花岗岩巨石
        const rockGeo = new THREE.DodecahedronGeometry(1.3 + Math.random() * 0.35, 1);
        rockGeo.scale(1.35, 0.9, 1.15);
        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x526071,
          roughness: 0.85,
          metalness: 0.12,
          flatShading: true,
        });
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 0.95;
        rock.rotation.set(Math.random() * 0.5, Math.random() * Math.PI, Math.random() * 0.3);
        group.add(rock);
        colliders.push(rock);
      } else {
        // 茂密低矮浆果灌木
        const bushGroup = new THREE.Group();
        const bushMat = new THREE.MeshStandardMaterial({ color: 0x2d6a4f, roughness: 0.82, flatShading: true });
        const berryMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.3 }); // 鲜红野生浆果

        const bushMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1.05, 1), bushMat);
        bushMesh.scale.set(1.4, 0.85, 1.3);
        bushMesh.position.y = 0.65;
        bushGroup.add(bushMesh);
        colliders.push(bushMesh);

        // 鲜红浆果点缀
        for (let b = 0; b < 6; b++) {
          const berry = new THREE.Mesh(new THREE.SphereGeometry(0.08, 5, 5), berryMat);
          berry.position.set(
            (Math.random() - 0.5) * 1.1,
            0.65 + Math.random() * 0.45,
            (Math.random() - 0.5) * 1.1
          );
          bushGroup.add(berry);
        }
        group.add(bushGroup);
      }

      const hp = cfg.type === 'rock' ? 3 : cfg.type === 'tree' ? 4 : 1;
      this.rootGroup.add(group);
      this.obstacles.push({
        id: `obs_hunt_${idx}_${cfg.type}`,
        type: cfg.type,
        meshGroup: group,
        colliderMeshes: colliders,
        position: group.position.clone(),
        radius: cfg.type === 'tree' ? 1.5 : 1.3,
        health: hp,
        maxHealth: hp,
        isDestroyed: false,
      });
    });
  }

  // ==========================================================================
  // 2. 星际防卫：360° 深空星海 + 高速曲率光速粒子雨 + 太空漂浮陨石
  // ==========================================================================

  public initSciFiEnvironment(): void {
    this.clearEnvironment();

    // 1. 360° 远景静态恒星海 (800 颗璀璨恒星)
    this.buildDeepSpaceStarfield();

    // 2. 超空间光速粒子雨 (Warp Speed Particle Rain): 迎面飞掠的高速星流
    this.buildWarpStarStreaks();

    // 3. 漂浮在 360° 太空中的可破坏陨石小行星与浮空能量掩体
    this.buildSpaceAsteroidsAndShields();
  }

  private buildDeepSpaceStarfield(): void {
    const count = 750;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = THREE.MathUtils.randFloat(35, 65);

      pos[i3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i3 + 2] = r * Math.cos(phi);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.35,
      transparent: true,
      opacity: 0.85,
    });
    const stars = new THREE.Points(geo, mat);
    this.rootGroup.add(stars);
  }

  /**
   * 构造迎面高速飞掠的曲率光速粒子流 (Hyper-speed Warp Streaks)
   */
  private buildWarpStarStreaks(): void {
    const count = this.warpStarCount;
    const geo = new THREE.BufferGeometry();
    this.warpPositions = new Float32Array(count * 3);
    this.warpVelocities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      // 分布在玩家前方隧道区域
      this.warpPositions[i3] = THREE.MathUtils.randFloat(-14, 14);
      this.warpPositions[i3 + 1] = THREE.MathUtils.randFloat(-8, 8);
      this.warpPositions[i3 + 2] = THREE.MathUtils.randFloat(-60, 4);

      // 高速流动速度 (45 ~ 75 m/s)
      this.warpVelocities[i] = THREE.MathUtils.randFloat(48, 78);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(this.warpPositions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x93c5fd,
      size: 0.38,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.warpStars = new THREE.Points(geo, mat);
    this.rootGroup.add(this.warpStars);
  }

  /**
   * 360° 太空漂浮多面体陨石小行星与能量护盾
   */
  private buildSpaceAsteroidsAndShields(): void {
    // 6 颗太空陨石与 2 个浮空护盾，环绕分布
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2 + Math.PI / 6;
      const radius = THREE.MathUtils.randFloat(5.5, 9.5);
      const x = Math.cos(angle) * radius;
      const y = THREE.MathUtils.randFloat(-1.2, 2.2);
      const z = Math.sin(angle) * radius;

      const group = new THREE.Group();
      group.position.set(x, y, z);

      // 低多边形岩石多面体
      const geo = new THREE.DodecahedronGeometry(THREE.MathUtils.randFloat(1.1, 1.6), 1);
      geo.scale(1.2, 0.9, 1.1);
      const mat = new THREE.MeshStandardMaterial({
        color: 0x475569,
        roughness: 0.85,
        metalness: 0.25,
        flatShading: true,
      });
      const asteroid = new THREE.Mesh(geo, mat);
      group.add(asteroid);

      this.rootGroup.add(group);
      this.obstacles.push({
        id: `obs_asteroid_${i}`,
        type: 'asteroid',
        meshGroup: group,
        colliderMeshes: [asteroid],
        position: group.position.clone(),
        radius: 1.4,
        health: 3,
        maxHealth: 3,
        isDestroyed: false,
      });
    }

    // 2 个浮空科幻能量护盾
    [0.75, 3.85].forEach((angle, idx) => {
      const radius = 6.2;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const group = new THREE.Group();
      group.position.set(x, 0.4, z);
      group.lookAt(0, 0.4, 0);

      const shieldGeo = new THREE.BoxGeometry(2.4, 1.8, 0.15);
      const shieldMat = new THREE.MeshStandardMaterial({
        color: 0x00f3ff,
        transparent: true,
        opacity: 0.45,
        roughness: 0.1,
        metalness: 0.9,
        emissive: 0x00f3ff,
        emissiveIntensity: 0.35,
      });
      const shieldMesh = new THREE.Mesh(shieldGeo, shieldMat);
      group.add(shieldMesh);

      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(shieldGeo),
        new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
      );
      group.add(wire);

      this.rootGroup.add(group);
      this.obstacles.push({
        id: `obs_shield_${idx}`,
        type: 'shield',
        meshGroup: group,
        colliderMeshes: [shieldMesh],
        position: group.position.clone(),
        radius: 1.4,
        health: 3,
        maxHealth: 3,
        isDestroyed: false,
      });
    });
  }

  // ==========================================================================
  // 3. 万圣夜惊魂：360° 万圣幽冥墓园 + 残破石碑 + 枯萎死树 + 南瓜灯 + 鬼火
  // ==========================================================================

  public initHalloweenEnvironment(): void {
    this.clearEnvironment();

    // 1. 幽暗墓园大地 (深暗黑紫)
    const groundGeo = new THREE.CircleGeometry(32, 48);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x120d1c,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, -1.5, 0);
    this.rootGroup.add(this.groundMesh);

    // 2. 玩家所在的 360° 圆形哥特铁围栏庇护所 (R = 3.0m)
    this.buildCircularIronFence();

    // 3. 360° 环绕分布在铁栏外的墓碑、枯萎老树与南瓜灯 (R >= 6.5m)
    this.build360HalloweenObstacles();

    // 4. 360° 浮空鬼火冷焰粒子 (Will-o'-the-wisps)
    this.buildHalloweenGhostFire();
  }

  private fenceMat?: THREE.MeshStandardMaterial;

  /**
   * 构造 360° 圆形哥特铁围栏庇护所 (半径 R = 3.0m, 高 1.4m)
   */
  private buildCircularIronFence(): void {
    const radius = 3.0;
    const picketCount = 36;
    const fenceGroup = new THREE.Group();
    fenceGroup.position.set(0, -1.5, 0);

    const ironMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.85,
      roughness: 0.35,
    });
    this.fenceMat = ironMat;

    // 上下两道圆弧铁横梁
    [0.35, 1.15].forEach((railY) => {
      const railGeo = new THREE.TorusGeometry(radius, 0.025, 6, 48);
      const rail = new THREE.Mesh(railGeo, ironMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.y = railY;
      fenceGroup.add(rail);
    });

    // 36 根带尖锐枪头矛尖的垂直铸铁铁栏杆
    const picketGeo = new THREE.CylinderGeometry(0.022, 0.022, 1.35, 5);
    const spearGeo = new THREE.ConeGeometry(0.045, 0.16, 5);

    for (let i = 0; i < picketCount; i++) {
      const angle = (i / picketCount) * Math.PI * 2;
      const px = Math.sin(angle) * radius;
      const pz = -Math.cos(angle) * radius;

      const picket = new THREE.Mesh(picketGeo, ironMat);
      picket.position.set(px, 0.7, pz);
      fenceGroup.add(picket);

      const spear = new THREE.Mesh(spearGeo, ironMat);
      spear.position.set(px, 1.42, pz);
      fenceGroup.add(spear);
    }

    // 8 根粗壮哥特灰石立柱与柱顶幽紫火灯笼
    const pillarCount = 8;
    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.9, flatShading: true });
    const lanternMat = new THREE.MeshBasicMaterial({ color: 0xa855f7 });

    for (let i = 0; i < pillarCount; i++) {
      const angle = (i / pillarCount) * Math.PI * 2;
      const px = Math.sin(angle) * radius;
      const pz = -Math.cos(angle) * radius;

      const post = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.55, 0.18), pillarMat);
      post.position.set(px, 0.77, pz);
      post.rotation.y = angle;
      fenceGroup.add(post);

      const lantern = new THREE.Mesh(new THREE.DodecahedronGeometry(0.09, 0), lanternMat);
      lantern.position.set(px, 1.62, pz);
      fenceGroup.add(lantern);
    }

    // 围栏内圆形青石地面 (Inner Sanctuary Cobblestone Circle)
    const floorGeo = new THREE.CircleGeometry(radius - 0.05, 36);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0x1e1b4b,
      roughness: 0.9,
    });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.02;
    fenceGroup.add(floor);

    this.rootGroup.add(fenceGroup);
  }

  public flashFenceDamage(): void {
    if (!this.fenceMat) return;
    this.fenceMat.color.setHex(0xef4444);
    setTimeout(() => {
      if (this.fenceMat) this.fenceMat.color.setHex(0x1e293b);
    }, 280);
  }

  private build360HalloweenObstacles(): void {
    const items: { type: 'tombstone' | 'tree' | 'pumpkin'; angle: number; dist: number }[] = [
      { type: 'tombstone', angle: 0.4, dist: 7.2 },
      { type: 'tree', angle: 1.1, dist: 8.8 },
      { type: 'pumpkin', angle: 1.7, dist: 6.8 },
      { type: 'tombstone', angle: 2.3, dist: 7.5 },
      { type: 'tombstone', angle: 3.1, dist: 8.0 },
      { type: 'tree', angle: 3.8, dist: 9.2 },
      { type: 'pumpkin', angle: 4.4, dist: 7.0 },
      { type: 'tombstone', angle: 5.0, dist: 7.6 },
      { type: 'tree', angle: 5.7, dist: 8.5 },
      { type: 'pumpkin', angle: 6.1, dist: 6.8 },
    ];

    items.forEach((item, idx) => {
      const x = Math.sin(item.angle) * item.dist;
      const z = -Math.cos(item.angle) * item.dist;
      const group = new THREE.Group();
      group.position.set(x, -1.5, z);

      const colliders: THREE.Mesh[] = [];

      if (item.type === 'tombstone') {
        // 残破灰石墓碑 + 十字雕饰
        const stoneGeo = new THREE.BoxGeometry(0.7, 1.2, 0.25);
        const stoneMat = new THREE.MeshStandardMaterial({
          color: 0x4b5563,
          roughness: 0.9,
          flatShading: true,
        });
        const stone = new THREE.Mesh(stoneGeo, stoneMat);
        stone.position.y = 0.6;
        stone.rotation.y = Math.random() * 0.4 - 0.2;
        group.add(stone);
        colliders.push(stone);

        // 墓碑顶部拱形
        const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.24, 8), stoneMat);
        arch.rotation.x = Math.PI / 2;
        arch.position.y = 1.2;
        group.add(arch);
        colliders.push(arch);
      } else if (item.type === 'tree') {
        // 枯萎扭曲无叶老树
        const trunkGeo = new THREE.CylinderGeometry(0.24, 0.48, 3.2, 6);
        const deadWoodMat = new THREE.MeshStandardMaterial({ color: 0x271e2b, roughness: 0.95 });
        const trunk = new THREE.Mesh(trunkGeo, deadWoodMat);
        trunk.position.y = 1.6;
        trunk.rotation.z = (Math.random() - 0.5) * 0.25;
        group.add(trunk);
        colliders.push(trunk);

        // 粗大扭曲枯枝
        [-0.35, 0.35].forEach((bx) => {
          const branch = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.14, 1.4, 5), deadWoodMat);
          branch.position.set(bx, 2.5, 0);
          branch.rotation.z = bx > 0 ? 0.7 : -0.7;
          group.add(branch);
          colliders.push(branch);
        });
      } else {
        // 雕刻发光杰克南瓜灯 (Jack-o'-lantern)
        const pumpkinGeo = new THREE.SphereGeometry(0.55, 10, 8);
        pumpkinGeo.scale(1.2, 0.95, 1.2);
        const pumpkinMat = new THREE.MeshStandardMaterial({
          color: 0xea580c,
          roughness: 0.7,
          flatShading: true,
        });
        const pumpkin = new THREE.Mesh(pumpkinGeo, pumpkinMat);
        pumpkin.position.y = 0.45;
        group.add(pumpkin);
        colliders.push(pumpkin);

        // 发光镂空眼眶与大嘴 (暖黄火光)
        const glowFaceMat = new THREE.MeshBasicMaterial({ color: 0xfef08a });
        [-0.2, 0.2].forEach((ex) => {
          const eye = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.08, 3), glowFaceMat);
          eye.position.set(ex, 0.55, 0.62);
          eye.rotation.x = Math.PI / 2;
          group.add(eye);
        });

        // 绿色瓜蒂
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 0.22, 5), new THREE.MeshStandardMaterial({ color: 0x4d7c0f }));
        stem.position.set(0, 0.95, 0);
        group.add(stem);
      }

      const hp = item.type === 'tombstone' ? 3 : item.type === 'tree' ? 4 : 1;
      this.rootGroup.add(group);
      this.obstacles.push({
        id: `obs_hal_${idx}_${item.type}`,
        type: item.type,
        meshGroup: group,
        colliderMeshes: colliders,
        position: group.position.clone(),
        radius: item.type === 'tree' ? 1.5 : 1.2,
        health: hp,
        maxHealth: hp,
        isDestroyed: false,
      });
    });
  }

  /**
   * 360° 万圣节鬼火点阵流光 (Will-o'-the-wisps)
   */
  private buildHalloweenGhostFire(): void {
    const count = 48;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const angle = (i / count) * Math.PI * 2;
      const r = THREE.MathUtils.randFloat(3.5, 9.5);
      pos[i3] = Math.cos(angle) * r;
      pos[i3 + 1] = THREE.MathUtils.randFloat(-0.8, 2.2);
      pos[i3 + 2] = Math.sin(angle) * r;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x8b5cf6, // 幽紫与青绿混合幽火
      size: 0.32,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.ghostFirePoints = new THREE.Points(geo, mat);
    this.rootGroup.add(this.ghostFirePoints);
  }

  // ==========================================================================
  // 掩体射线格挡碰撞判定与破坏系统
  // ==========================================================================

  public checkObstacleIntersection(raycaster: THREE.Raycaster): {
    hit: boolean;
    distance: number;
    point: THREE.Vector3;
    obstacle?: ObstacleEntity;
  } | null {
    if (this.obstacles.length === 0) return null;

    const allMeshes: THREE.Mesh[] = [];
    this.obstacles.forEach((obs) => {
      if (!obs.isDestroyed) {
        obs.colliderMeshes.forEach((mesh) => allMeshes.push(mesh));
      }
    });

    const intersects = raycaster.intersectObjects(allMeshes, false);
    if (intersects.length > 0) {
      const first = intersects[0];
      let hitObs: ObstacleEntity | undefined;
      for (const obs of this.obstacles) {
        if (obs.colliderMeshes.includes(first.object as THREE.Mesh)) {
          hitObs = obs;
          break;
        }
      }
      return {
        hit: true,
        distance: first.distance,
        point: first.point,
        obstacle: hitObs,
      };
    }

    return null;
  }

  public hitObstacle(obstacle: ObstacleEntity, damage: number = 1, hitPoint?: THREE.Vector3): ObstacleHitResult {
    const point = hitPoint || obstacle.position.clone();
    obstacle.health -= damage;

    const nameMap: Record<string, string> = {
      rock: '大岩石',
      tree: '粗壮松树',
      bush: '低矮灌木',
      shield: '能量护盾',
      tombstone: '古墓残碑',
      pumpkin: '南瓜怪灯',
      asteroid: '太空陨石',
    };

    if (obstacle.health <= 0) {
      obstacle.isDestroyed = true;
      this.createObstacleShatterDebris(point, obstacle.type);

      this.rootGroup.remove(obstacle.meshGroup);
      const idx = this.obstacles.indexOf(obstacle);
      if (idx !== -1) {
        this.obstacles.splice(idx, 1);
      }

      return {
        hit: true,
        destroyed: true,
        obstacle,
        damage,
        remainingHealth: 0,
        name: nameMap[obstacle.type] || '掩体',
      };
    }

    this.createObstacleHitSparks(point, obstacle.type);
    obstacle.meshGroup.position.x += (Math.random() - 0.5) * 0.1;
    setTimeout(() => {
      if (!obstacle.isDestroyed) {
        obstacle.meshGroup.position.copy(obstacle.position);
      }
    }, 60);

    return {
      hit: true,
      destroyed: false,
      obstacle,
      damage,
      remainingHealth: obstacle.health,
      name: nameMap[obstacle.type] || '掩体',
    };
  }

  public createObstacleHitSparks(pos: THREE.Vector3, type: ObstacleEntity['type']): void {
    const count = 28;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const sparkColor =
      type === 'tree'
        ? 0xd4a373
        : type === 'shield'
        ? 0x00f3ff
        : type === 'pumpkin'
        ? 0xf97316
        : type === 'tombstone' || type === 'asteroid'
        ? 0x94a3b8
        : 0xd1d5db;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      positions[i3] = pos.x;
      positions[i3 + 1] = pos.y;
      positions[i3 + 2] = pos.z;

      const speed = THREE.MathUtils.randFloat(2, 6);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;

      velocities[i3] = speed * Math.sin(phi) * Math.cos(theta);
      velocities[i3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
      velocities[i3 + 2] = speed * Math.cos(phi);
    }

    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const mat = new THREE.PointsMaterial({
      color: sparkColor,
      size: 0.18,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geo, mat);
    particles.userData = { life: 0.45, maxLife: 0.45 };
    this.rootGroup.add(particles);
    this.sparkParticles.push(particles);
  }

  private createObstacleShatterDebris(pos: THREE.Vector3, type: ObstacleEntity['type']): void {
    this.createObstacleHitSparks(pos, type);

    const pieceCount = type === 'bush' || type === 'pumpkin' ? 7 : 11;
    const color =
      type === 'tree'
        ? 0x6b4423
        : type === 'shield'
        ? 0x00f3ff
        : type === 'pumpkin'
        ? 0xea580c
        : type === 'asteroid'
        ? 0x334155
        : 0x5a6577;

    for (let i = 0; i < pieceCount; i++) {
      const geo = new THREE.DodecahedronGeometry(THREE.MathUtils.randFloat(0.12, 0.28), 0);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.7,
        transparent: true,
        opacity: 0.95,
      });

      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      mesh.position.x += THREE.MathUtils.randFloat(-0.3, 0.3);
      mesh.position.y += THREE.MathUtils.randFloat(0.1, 0.6);
      mesh.position.z += THREE.MathUtils.randFloat(-0.3, 0.3);

      const angle = Math.random() * Math.PI * 2;
      const spd = THREE.MathUtils.randFloat(2.5, 6.0);
      const vel = new THREE.Vector3(
        Math.cos(angle) * spd,
        THREE.MathUtils.randFloat(2.5, 5.5),
        Math.sin(angle) * spd
      );

      const rot = new THREE.Vector3(
        THREE.MathUtils.randFloat(-8, 8),
        THREE.MathUtils.randFloat(-8, 8),
        THREE.MathUtils.randFloat(-8, 8)
      );

      this.rootGroup.add(mesh);
      this.debrisMeshes.push({
        mesh,
        velocity: vel,
        rotSpeed: rot,
        life: 0.9,
        maxLife: 0.9,
      });
    }
  }

  public setPeekOffset(val: number): void {
    this.targetPeekX = Math.max(-2.2, Math.min(2.2, val));
  }

  public getPeekOffset(): number {
    return this.currentPeekX;
  }

  // ==========================================================================
  // 每一帧动画渲染更新 (溪流波光、光速粒子雨、鬼火漂浮、碎块物理)
  // ==========================================================================

  public update(delta: number, camera: THREE.Camera): void {
    this.streamTime += delta;
    this.ghostFireTime += delta;

    // 1. 溪流流光波纹微动与水纹偏移流淌动画
    if (this.streamMesh) {
      const wave = Math.sin(this.streamTime * 2.0) * 0.08;
      (this.streamMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.4 + wave;
      if (this.waterTexture) {
        this.waterTexture.offset.x += delta * 0.035;
        this.waterTexture.offset.y += delta * 0.018;
      }
    }

    // 2. 超空间光速粒子雨 (Warp Speed Star Streaks) 更新
    if (this.warpStars && this.warpPositions && this.warpVelocities) {
      const posAttr = this.warpStars.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < this.warpStarCount; i++) {
        const i3 = i * 3;
        // 沿 Z 轴高速向前迎面飞向玩家
        this.warpPositions[i3 + 2] += this.warpVelocities[i] * delta;
        // 飞过玩家眼球后重置到远方深空
        if (this.warpPositions[i3 + 2] > 3) {
          this.warpPositions[i3 + 2] = THREE.MathUtils.randFloat(-65, -45);
          this.warpPositions[i3] = THREE.MathUtils.randFloat(-15, 15);
          this.warpPositions[i3 + 1] = THREE.MathUtils.randFloat(-9, 9);
        }
      }
      posAttr.needsUpdate = true;
    }

    // 3. 万圣节鬼火 (Will-o'-the-wisps) 360° 环绕缓慢浮游
    if (this.ghostFirePoints) {
      this.ghostFirePoints.rotation.y += delta * 0.25;
      const gfMat = this.ghostFirePoints.material as THREE.PointsMaterial;
      gfMat.opacity = 0.65 + Math.sin(this.ghostFireTime * 3.5) * 0.25;
    }

    // 4. 歪头探身平滑过渡
    this.currentPeekX += (this.targetPeekX - this.currentPeekX) * Math.min(1.0, delta * 10);
    camera.position.x = this.currentPeekX;

    // 5. 更新受击火花粒子
    for (let i = this.sparkParticles.length - 1; i >= 0; i--) {
      const p = this.sparkParticles[i];
      p.userData.life -= delta;

      if (p.userData.life <= 0) {
        this.rootGroup.remove(p);
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
        this.sparkParticles.splice(i, 1);
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

    // 6. 更新物理碎石碎块重力抛射
    for (let i = this.debrisMeshes.length - 1; i >= 0; i--) {
      const d = this.debrisMeshes[i];
      d.life -= delta;

      if (d.life <= 0) {
        this.rootGroup.remove(d.mesh);
        d.mesh.geometry.dispose();
        (d.mesh.material as THREE.Material).dispose();
        this.debrisMeshes.splice(i, 1);
        continue;
      }

      d.velocity.y -= 9.8 * delta;
      d.mesh.position.addScaledVector(d.velocity, delta);
      d.mesh.rotation.x += d.rotSpeed.x * delta;
      d.mesh.rotation.y += d.rotSpeed.y * delta;
      d.mesh.rotation.z += d.rotSpeed.z * delta;

      if (d.mesh.position.y < -1.45) {
        d.mesh.position.y = -1.45;
        d.velocity.y = -d.velocity.y * 0.35;
        d.velocity.x *= 0.6;
        d.velocity.z *= 0.6;
      }

      (d.mesh.material as THREE.MeshStandardMaterial).opacity = d.life / d.maxLife;
    }
  }

  public clearEnvironment(): void {
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
    this.obstacles = [];
    this.sparkParticles = [];
    this.groundMesh = null;
    this.streamMesh = null;
    this.waterTexture = null;
    this.warpStars = null;
    this.warpPositions = null;
    this.warpVelocities = null;
    this.ghostFirePoints = null;
    this.currentPeekX = 0;
    this.targetPeekX = 0;
  }

  public getObstacles(): ObstacleEntity[] {
    return this.obstacles;
  }
}
