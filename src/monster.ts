/**
 * AR-Shooter 怪物实体与生命周期管理器 (monster.ts)
 * 包含球面空间随机生成、几何体组合造型、上下自转浮动、
 * 具备连续平滑衰减 (Smoothstep + Damped Lerp) 彻底消除边缘闪烁，
 * 以及多重材质深度偏移 (polygonOffset) 消除 Z-fighting 闪烁。
 */

import * as THREE from 'three';

export interface MonsterEntity {
  id: string;
  meshGroup: THREE.Group;
  basePosition: THREE.Vector3;
  currentPosition: THREE.Vector3;
  radius: number;
  elevation: number;
  azimuth: number;
  floatSpeed: number;
  floatAmplitude: number;
  floatOffset: number;
  rotSpeed: THREE.Vector3;
  health: number;
  maxHealth: number;
  materials: THREE.Material[];
  currentOpacity: number;
  isDying: boolean;
  typeIndex: number;
}

export interface HitResult {
  hit: boolean;
  monster?: MonsterEntity;
  killed?: boolean;
  worldPoint?: THREE.Vector3;
}

export class MonsterManager {
  private scene: THREE.Scene;
  private monsters: MonsterEntity[] = [];
  private targetCount: number = 6;
  private monsterIdCounter: number = 0;

  // 粒子爆炸系统
  private explosionParticles: THREE.Points[] = [];

  // 临时向量，避免每帧 GC
  private readonly tempCamDir = new THREE.Vector3();
  private readonly tempMonsterDir = new THREE.Vector3();

  constructor(scene: THREE.Scene, targetCount: number = 6) {
    this.scene = scene;
    this.targetCount = targetCount;
  }

  /**
   * 初始化生成怪物群
   */
  public initMonsters(): void {
    for (let i = 0; i < this.targetCount; i++) {
      this.spawnMonster();
    }
  }

  /**
   * 在玩家周围空间球面/环状区域随机生成一只具有赛博能量生物造型的怪物
   * 半径 R in [6, 12] 米，仰角 -30度 ~ +45度，水平角 0 ~ 360度
   */
  public spawnMonster(): MonsterEntity {
    const radius = THREE.MathUtils.randFloat(6, 12);
    const minElev = THREE.MathUtils.degToRad(-30);
    const maxElev = THREE.MathUtils.degToRad(45);
    const elevation = THREE.MathUtils.randFloat(minElev, maxElev);
    const azimuth = THREE.MathUtils.randFloat(0, Math.PI * 2);

    const x = radius * Math.cos(elevation) * Math.sin(azimuth);
    const y = radius * Math.sin(elevation);
    const z = -radius * Math.cos(elevation) * Math.cos(azimuth);

    const basePosition = new THREE.Vector3(x, y, z);
    const group = new THREE.Group();
    group.position.copy(basePosition);

    const materials: THREE.Material[] = [];
    const typeIndex = Math.floor(Math.random() * 3);

    // 构建富有视觉冲击力的几何体组合生物
    this.buildMonsterGeometry(group, materials, typeIndex);

    const monster: MonsterEntity = {
      id: `monster_${++this.monsterIdCounter}`,
      meshGroup: group,
      basePosition: basePosition.clone(),
      currentPosition: basePosition.clone(),
      radius,
      elevation,
      azimuth,
      floatSpeed: THREE.MathUtils.randFloat(1.5, 3.0),
      floatAmplitude: THREE.MathUtils.randFloat(0.2, 0.45),
      floatOffset: Math.random() * Math.PI * 2,
      rotSpeed: new THREE.Vector3(
        THREE.MathUtils.randFloat(-1.0, 1.0),
        THREE.MathUtils.randFloat(1.0, 2.0),
        THREE.MathUtils.randFloat(-0.8, 0.8)
      ),
      health: 1,
      maxHealth: 1,
      materials,
      currentOpacity: 0.0, // 初始平滑淡入
      isDying: false,
      typeIndex,
    };

    group.userData = { monsterEntity: monster };

    this.scene.add(group);
    this.monsters.push(monster);

    return monster;
  }

  /**
   * 组合科技感悬浮多面体异兽造型 (彻底消除 Z-fighting 深度冲突)
   */
  private buildMonsterGeometry(parent: THREE.Group, mats: THREE.Material[], type: number): void {
    const colors = [
      { primary: 0x00f3ff, core: 0xff3366, glow: 0x00ffff },
      { primary: 0xa855f7, core: 0x3b82f6, glow: 0xec4899 },
      { primary: 0xffaa00, core: 0xff0055, glow: 0xffdd00 },
    ];
    const c = colors[type % colors.length];

    // 1. 核心脉冲球体 (不透明实体核心)
    const coreGeo = new THREE.SphereGeometry(0.35, 16, 16);
    const coreMat = new THREE.MeshBasicMaterial({
      color: c.core,
      transparent: true,
      depthWrite: true,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    parent.add(coreMesh);
    mats.push(coreMat);

    // 2. 外层浮空多面体框架 (半透明发光)
    const shellGeo = type === 1 
      ? new THREE.OctahedronGeometry(0.85, 0) 
      : new THREE.IcosahedronGeometry(0.8, 0);

    const shellMat = new THREE.MeshStandardMaterial({
      color: c.primary,
      roughness: 0.2,
      metalness: 0.8,
      emissive: c.glow,
      emissiveIntensity: 0.4,
      transparent: true,
      depthWrite: false, // 禁用深度写入，防止遮挡内部与线框
    });
    const shellMesh = new THREE.Mesh(shellGeo, shellMat);
    parent.add(shellMesh);
    mats.push(shellMat);

    // 3. 线框外骨骼 (带 polygonOffset 偏置，杜绝破面闪烁)
    const wireGeo = shellGeo.clone();
    const wireMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      wireframe: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const wireMesh = new THREE.Mesh(wireGeo, wireMat);
    wireMesh.scale.setScalar(1.02);
    parent.add(wireMesh);
    mats.push(wireMat);

    // 4. 环绕轨道护盾光环
    const ringGeo = new THREE.TorusGeometry(1.2, 0.03, 8, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: c.primary,
      transparent: true,
      depthWrite: false,
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.rotation.x = Math.PI / 3;
    parent.add(ringMesh);
    mats.push(ringMat);

    // 5. 正前方机械发光眼
    const eyeGeo = new THREE.ConeGeometry(0.18, 0.4, 8);
    const eyeMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      depthWrite: false,
    });
    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.position.set(0, 0, 0.8);
    eyeMesh.rotation.x = Math.PI / 2;
    parent.add(eyeMesh);
    mats.push(eyeMat);
  }

  /**
   * 每一帧更新怪物位置、动画、FOV 点积边缘平滑衰减与粒子效果
   */
  public update(delta: number, elapsed: number, camera: THREE.Camera): void {
    camera.getWorldDirection(this.tempCamDir);

    for (let i = this.monsters.length - 1; i >= 0; i--) {
      const m = this.monsters[i];
      if (m.isDying) continue;

      // 1. 上下正弦浮动动画
      const floatY = Math.sin(elapsed * m.floatSpeed + m.floatOffset) * m.floatAmplitude;
      m.currentPosition.copy(m.basePosition).add(new THREE.Vector3(0, floatY, 0));
      m.meshGroup.position.copy(m.currentPosition);

      // 2. 自转动画
      m.meshGroup.rotation.x += m.rotSpeed.x * delta;
      m.meshGroup.rotation.y += m.rotSpeed.y * delta;
      m.meshGroup.rotation.z += m.rotSpeed.z * delta;

      // 3. FOV 点积边缘连续平滑衰减 (消除临界跳动闪烁)
      this.tempMonsterDir.copy(m.currentPosition).sub(camera.position).normalize();
      const dot = this.tempCamDir.dot(this.tempMonsterDir);

      // 使用宽域 Smoothstep 缓动曲线：
      // dot >= 0.82 (中心 ~35度视场): 100% 不透明
      // 0.50 <= dot < 0.82 (视口边缘向外): 连续 S 型曲线衰减到 0.0
      // dot < 0.50: 完全透明 0.0
      let targetOpacity = 0;
      if (dot >= 0.82) {
        targetOpacity = 1.0;
      } else if (dot >= 0.50) {
        const t = (dot - 0.50) / (0.82 - 0.50);
        targetOpacity = t * t * (3 - 2 * t); // Smoothstep 三次 Hermite 曲线
      } else {
        targetOpacity = 0;
      }

      // 时间阻尼平滑逼近 (Lerp)，彻底抹去帧间突变
      const lerpSpeed = Math.min(1.0, delta * 14);
      m.currentOpacity += (targetOpacity - m.currentOpacity) * lerpSpeed;

      // 仅在完全不可见时关闭可见性，避免每帧频繁开启关闭导致的闪烁
      if (m.currentOpacity < 0.02) {
        m.meshGroup.visible = false;
      } else {
        m.meshGroup.visible = true;
        for (let j = 0; j < m.materials.length; j++) {
          m.materials[j].opacity = m.currentOpacity;
        }
      }
    }

    // 更新爆炸粒子
    this.updateExplosionParticles(delta);

    // 自动补充存活怪物
    if (this.monsters.filter((m) => !m.isDying).length < this.targetCount) {
      this.spawnMonster();
    }
  }

  /**
   * 屏幕中心射线击中检测
   */
  public checkRayIntersection(raycaster: THREE.Raycaster): MonsterEntity | null {
    const activeMonsters = this.monsters.filter((m) => !m.isDying && m.meshGroup.visible && m.currentOpacity > 0.2);
    if (activeMonsters.length === 0) return null;

    const meshesToCheck: THREE.Object3D[] = [];
    activeMonsters.forEach((m) => {
      m.meshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshesToCheck.push(child);
        }
      });
    });

    const intersects = raycaster.intersectObjects(meshesToCheck, false);
    if (intersects.length > 0) {
      let curr: THREE.Object3D | null = intersects[0].object;
      while (curr && curr.parent && !curr.userData.monsterEntity) {
        curr = curr.parent;
      }
      if (curr && curr.userData.monsterEntity) {
        return curr.userData.monsterEntity as MonsterEntity;
      }
    }
    return null;
  }

  /**
   * 触发怪物受击与消散爆炸特效
   */
  public hitMonster(monster: MonsterEntity, hitPoint?: THREE.Vector3): HitResult {
    if (monster.isDying) return { hit: false };

    monster.health -= 1;
    const worldPos = hitPoint || monster.meshGroup.position.clone();

    if (monster.health <= 0) {
      monster.isDying = true;

      this.createExplosion(worldPos, monster.typeIndex);
      this.scene.remove(monster.meshGroup);

      monster.meshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((mat) => mat.dispose());
          } else {
            child.material.dispose();
          }
        }
      });

      const idx = this.monsters.indexOf(monster);
      if (idx !== -1) {
        this.monsters.splice(idx, 1);
      }

      return { hit: true, monster, killed: true, worldPoint: worldPos };
    }

    return { hit: true, monster, killed: false, worldPoint: worldPos };
  }

  /**
   * 创建科幻粒子爆炸效果
   */
  private createExplosion(pos: THREE.Vector3, type: number): void {
    const particleCount = 45;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3] = pos.x;
      positions[i3 + 1] = pos.y;
      positions[i3 + 2] = pos.z;

      const speed = THREE.MathUtils.randFloat(3, 8);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.randFloat(-1, 1));

      velocities[i3] = speed * Math.sin(phi) * Math.cos(theta);
      velocities[i3 + 1] = speed * Math.sin(phi) * Math.sin(theta);
      velocities[i3 + 2] = speed * Math.cos(phi);
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));

    const particleColor = type === 0 ? 0x00f3ff : type === 1 ? 0xff3366 : 0xffaa00;

    const material = new THREE.PointsMaterial({
      color: particleColor,
      size: 0.25,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particles = new THREE.Points(geometry, material);
    particles.userData = { life: 0.65, maxLife: 0.65 };
    this.scene.add(particles);
    this.explosionParticles.push(particles);
  }

  /**
   * 每一帧更新粒子移动和渐隐生命周期
   */
  private updateExplosionParticles(delta: number): void {
    for (let i = this.explosionParticles.length - 1; i >= 0; i--) {
      const p = this.explosionParticles[i];
      p.userData.life -= delta;

      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        (p.material as THREE.Material).dispose();
        this.explosionParticles.splice(i, 1);
        continue;
      }

      const progress = p.userData.life / p.userData.maxLife;
      (p.material as THREE.PointsMaterial).opacity = progress;

      const posAttr = p.geometry.getAttribute('position') as THREE.BufferAttribute;
      const velAttr = p.geometry.getAttribute('velocity') as THREE.BufferAttribute;

      const posArray = posAttr.array as Float32Array;
      const velArray = velAttr.array as Float32Array;

      for (let j = 0; j < posAttr.count; j++) {
        const j3 = j * 3;
        posArray[j3] += velArray[j3] * delta;
        posArray[j3 + 1] += velArray[j3 + 1] * delta;
        posArray[j3 + 2] += velArray[j3 + 2] * delta;
      }

      posAttr.needsUpdate = true;
    }
  }

  public getActiveMonsters(): MonsterEntity[] {
    return this.monsters.filter((m) => !m.isDying);
  }

  public getAliveCount(): number {
    return this.monsters.filter((m) => !m.isDying).length;
  }
}
