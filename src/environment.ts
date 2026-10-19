/**
 * AR-Shooter 虚拟自然环境与掩体系统 (environment.ts)
 * 构建 Y = -1.5 虚拟地平线、动态波光森林溪流、不可破坏的天然障碍物 (树木/巨石/灌木)，
 * 射线格挡碰撞检测与粒子火花，以及体感陀螺仪横滚角与 UI 探身 (Peek Mechanic) 视差机制。
 */

import * as THREE from 'three';

export interface ObstacleEntity {
  id: string;
  type: 'tree' | 'rock' | 'bush' | 'shield';
  meshGroup: THREE.Group;
  colliderMeshes: THREE.Mesh[];
  position: THREE.Vector3;
  radius: number;
}

export class EnvironmentManager {
  private scene: THREE.Scene;
  private rootGroup = new THREE.Group();

  // 环境组件
  private groundMesh: THREE.Mesh | null = null;
  private streamMesh: THREE.Mesh | null = null;
  private streamTime: number = 0;
  private obstacles: ObstacleEntity[] = [];

  // 格挡火花与碎屑粒子系统
  private sparkParticles: THREE.Points[] = [];

  // 歪头探身视差状态 (Peek System)
  private currentPeekX: number = 0;
  private targetPeekX: number = 0;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.scene.add(this.rootGroup);
  }

  /**
   * 初始化荒野狩猎自然环境
   */
  public initHuntingEnvironment(): void {
    this.clearEnvironment();

    // 1. 虚拟地面地平线 (Y = -1.5, 半径 25m 的淡隐圆形地表网格)
    const groundGeo = new THREE.CircleGeometry(24, 32);
    const groundMat = new THREE.MeshBasicMaterial({
      color: 0x1a2e1d,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
    });
    this.groundMesh = new THREE.Mesh(groundGeo, groundMat);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.position.set(0, -1.5, 0);
    this.rootGroup.add(this.groundMesh);

    // 2. 森林蜿蜒溪流带 (Y = -1.48，自左向右横穿场景)
    this.buildForestStream();

    // 3. 不可破坏的天然掩体 (松树、巨石、灌木)
    this.buildIndestructibleObstacles();
  }

  /**
   * 初始化星际防卫能量掩体环境
   */
  public initSciFiEnvironment(): void {
    this.clearEnvironment();

    // 浮空科幻能量护盾掩体
    for (let i = 0; i < 4; i++) {
      const angle = (i * Math.PI) / 2 + Math.PI / 4;
      const radius = 6.5;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      const shieldGroup = new THREE.Group();
      shieldGroup.position.set(x, 0.5, z);
      shieldGroup.lookAt(0, 0.5, 0);

      const shieldGeo = new THREE.BoxGeometry(2.4, 2.0, 0.15);
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
      shieldGroup.add(shieldMesh);

      // 边框发光线
      const wire = new THREE.LineSegments(
        new THREE.EdgesGeometry(shieldGeo),
        new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 })
      );
      shieldGroup.add(wire);

      this.rootGroup.add(shieldGroup);
      this.obstacles.push({
        id: `shield_${i}`,
        type: 'shield',
        meshGroup: shieldGroup,
        colliderMeshes: [shieldMesh],
        position: shieldGroup.position.clone(),
        radius: 1.4,
      });
    }
  }

  /**
   * 构造蜿蜒森林溪流带
   */
  private buildForestStream(): void {
    // 弯曲溪流平面带
    const streamGeo = new THREE.PlaneGeometry(36, 3.2, 32, 4);
    const pos = streamGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      // 让溪流形成自然的正弦蜿蜒河道
      const zOffset = Math.sin(x * 0.25) * 1.8;
      pos.setY(i, pos.getY(i) + zOffset);
    }
    streamGeo.computeVertexNormals();

    const streamMat = new THREE.MeshStandardMaterial({
      color: 0x00b4d8,
      transparent: true,
      opacity: 0.65,
      roughness: 0.1,
      metalness: 0.5,
      emissive: 0x0077b6,
      emissiveIntensity: 0.25,
      depthWrite: false,
    });

    this.streamMesh = new THREE.Mesh(streamGeo, streamMat);
    this.streamMesh.rotation.x = -Math.PI / 2;
    this.streamMesh.position.set(0, -1.48, -4.5);
    this.rootGroup.add(this.streamMesh);

    // 溪流两侧小鹅卵石点缀
    for (let i = 0; i < 14; i++) {
      const pebbleGeo = new THREE.DodecahedronGeometry(0.12 + Math.random() * 0.15, 0);
      const pebbleMat = new THREE.MeshStandardMaterial({ color: 0x718096, roughness: 0.8 });
      const pebble = new THREE.Mesh(pebbleGeo, pebbleMat);
      const px = -12 + i * 1.8 + (Math.random() - 0.5) * 0.6;
      const pz = -4.5 + Math.sin(px * 0.25) * 1.8 + (Math.random() > 0.5 ? 1.8 : -1.8);
      pebble.position.set(px, -1.45, pz);
      this.rootGroup.add(pebble);
    }
  }

  /**
   * 构造天然不可破坏掩体 (大松树、花岗岩巨石与茂密灌木)
   */
  private buildIndestructibleObstacles(): void {
    // 预设 6 个关键掩体点位 (分布在玩家前方扇形视界 R in [5, 9] 米)
    const obstacleConfigs = [
      { type: 'tree' as const, angle: -0.65, dist: 6.2 },
      { type: 'rock' as const, angle: -0.22, dist: 5.5 },
      { type: 'rock' as const, angle: 0.35, dist: 5.0 },
      { type: 'tree' as const, angle: 0.75, dist: 7.2 },
      { type: 'bush' as const, angle: -1.1, dist: 7.8 },
      { type: 'rock' as const, angle: 1.2, dist: 6.8 },
    ];

    obstacleConfigs.forEach((cfg, idx) => {
      const x = Math.sin(cfg.angle) * cfg.dist;
      const z = -Math.cos(cfg.angle) * cfg.dist;
      const groundY = -1.5;

      const group = new THREE.Group();
      group.position.set(x, groundY, z);

      const colliders: THREE.Mesh[] = [];

      if (cfg.type === 'tree') {
        // 低多边形高大松树
        // 1. 粗壮树干
        const trunkGeo = new THREE.CylinderGeometry(0.35, 0.55, 3.2, 7);
        const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a2e18, roughness: 0.9 });
        const trunk = new THREE.Mesh(trunkGeo, trunkMat);
        trunk.position.y = 1.6;
        group.add(trunk);
        colliders.push(trunk);

        // 2. 三层多面体锥形树冠
        const foliageMat = new THREE.MeshStandardMaterial({
          color: 0x1b4332,
          roughness: 0.7,
          flatShading: true,
        });
        for (let l = 0; l < 3; l++) {
          const coneGeo = new THREE.ConeGeometry(1.6 - l * 0.35, 1.8, 6);
          const cone = new THREE.Mesh(coneGeo, foliageMat);
          cone.position.y = 2.8 + l * 1.0;
          group.add(cone);
          colliders.push(cone);
        }
      } else if (cfg.type === 'rock') {
        // 青灰色花岗岩大巨石 (不规则多面体)
        const rockGeo = new THREE.DodecahedronGeometry(1.2 + Math.random() * 0.4, 1);
        // 拉伸并微调形态产生天然厚重石块感
        rockGeo.scale(1.3, 0.95, 1.1);
        const rockMat = new THREE.MeshStandardMaterial({
          color: 0x5a6577,
          roughness: 0.85,
          metalness: 0.1,
          flatShading: true,
        });
        const rock = new THREE.Mesh(rockGeo, rockMat);
        rock.position.y = 0.9;
        rock.rotation.set(Math.random(), Math.random(), Math.random());
        group.add(rock);
        colliders.push(rock);
      } else {
        // 茂密低矮灌木丛
        const bushGeo = new THREE.IcosahedronGeometry(1.0, 1);
        bushGeo.scale(1.4, 0.85, 1.3);
        const bushMat = new THREE.MeshStandardMaterial({
          color: 0x2d6a4f,
          roughness: 0.8,
          flatShading: true,
        });
        const bush = new THREE.Mesh(bushGeo, bushMat);
        bush.position.y = 0.65;
        group.add(bush);
        colliders.push(bush);
      }

      this.rootGroup.add(group);
      this.obstacles.push({
        id: `obs_${idx}_${cfg.type}`,
        type: cfg.type,
        meshGroup: group,
        colliderMeshes: colliders,
        position: group.position.clone(),
        radius: cfg.type === 'tree' ? 1.5 : 1.3,
      });
    });
  }

  /**
   * 物理遮挡判定：发射射线时判断子弹是否被树木或大岩石拦截
   */
  public checkObstacleIntersection(raycaster: THREE.Raycaster): {
    hit: boolean;
    distance: number;
    point: THREE.Vector3;
    obstacle?: ObstacleEntity;
  } | null {
    if (this.obstacles.length === 0) return null;

    const allMeshes: THREE.Mesh[] = [];
    this.obstacles.forEach((obs) => {
      obs.colliderMeshes.forEach((mesh) => allMeshes.push(mesh));
    });

    const intersects = raycaster.intersectObjects(allMeshes, false);
    if (intersects.length > 0) {
      const first = intersects[0];
      // 寻找对应的 ObstacleEntity
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

  /**
   * 掩体受击爆出石屑/木屑火星粒子特效
   */
  public createObstacleHitSparks(pos: THREE.Vector3, type: 'tree' | 'rock' | 'bush' | 'shield'): void {
    const count = 28;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);

    const sparkColor = type === 'tree' ? 0xd4a373 : type === 'shield' ? 0x00f3ff : 0xd1d5db;

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

  /**
   * 歪头探身视差控制 (Roll-to-Peek & UI Peek)
   * 结合陀螺仪横滚角与 UI 滑块设置相机 X 轴偏移 [-2.2m, +2.2m]
   */
  public setPeekOffset(val: number): void {
    // 限制范围在 [-2.2m, +2.2m]
    this.targetPeekX = Math.max(-2.2, Math.min(2.2, val));
  }

  public getPeekOffset(): number {
    return this.currentPeekX;
  }

  /**
   * 每一帧更新环境流光、粒子与探身平滑插值
   */
  public update(delta: number, camera: THREE.Camera): void {
    this.streamTime += delta;

    // 1. 溪流流光波纹微动动画
    if (this.streamMesh) {
      const wave = Math.sin(this.streamTime * 2.0) * 0.05;
      (this.streamMesh.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25 + wave;
    }

    // 2. 歪头探身平滑阻尼过渡 (平滑平移 camera.position.x)
    this.currentPeekX += (this.targetPeekX - this.currentPeekX) * Math.min(1.0, delta * 10);
    camera.position.x = this.currentPeekX;

    // 3. 更新掩体碎屑粒子
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

      const progress = p.userData.life / p.userData.maxLife;
      (p.material as THREE.PointsMaterial).opacity = progress;

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

  /**
   * 清理并销毁环境对象
   */
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
    this.currentPeekX = 0;
    this.targetPeekX = 0;
  }

  public getObstacles(): ObstacleEntity[] {
    return this.obstacles;
  }
}
