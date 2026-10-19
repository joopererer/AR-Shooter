/**
 * AR-Shooter 第一人称星际战机座舱外框系统 (cockpit.ts)
 * 参考《星球大战：战机中队》《星际公民》《无人深空》经典太空模拟器座舱设计：
 * 挂载于相机近平面的 3D 战机座舱多面体立柱外框、战术全息航电仪表、
 * 操控惯性倾斜侧滚 (Banking & Sway) 与护盾受击红光偏转反馈。
 */

import * as THREE from 'three';
import { JoystickVector } from './joystick';

export class CockpitManager {
  private camera: THREE.Camera;
  private cockpitRig = new THREE.Group();
  private isVisible: boolean = false;

  // 仪表与护盾网格引用
  private frameMeshes: THREE.Mesh[] = [];
  private shieldIndicatorMesh: THREE.Mesh | null = null;
  private shieldGlowMat: THREE.MeshBasicMaterial | null = null;
  private wireframeMats: THREE.LineBasicMaterial[] = [];

  // 物理惯性动力学姿态
  private currentRoll: number = 0;
  private targetRoll: number = 0;
  private currentPitch: number = 0;
  private targetPitch: number = 0;
  private engineTime: number = 0;
  private isShieldFlashing: boolean = false;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    this.camera.add(this.cockpitRig);
    this.cockpitRig.position.set(0, 0, -0.42); // 挂载在玩家眼球正前方近裁剪面
    this.cockpitRig.visible = false;

    this.buildCockpitModel();
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.cockpitRig.visible = visible;
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  /**
   * 触发座舱护盾受击闪烁与警报震颤
   */
  public triggerShieldHit(): void {
    if (!this.isVisible) return;
    this.isShieldFlashing = true;

    // 变红光受击警报
    if (this.shieldGlowMat) {
      this.shieldGlowMat.color.setHex(0xff1e56);
    }
    this.wireframeMats.forEach((m) => m.color.setHex(0xff3366));

    // 受击震颤
    this.cockpitRig.position.x += (Math.random() - 0.5) * 0.04;
    this.cockpitRig.position.y += (Math.random() - 0.5) * 0.04;

    setTimeout(() => {
      this.isShieldFlashing = false;
      if (this.shieldGlowMat) {
        this.shieldGlowMat.color.setHex(0x00f3ff);
      }
      this.wireframeMats.forEach((m) => m.color.setHex(0x00e5ff));
      this.cockpitRig.position.set(0, 0, -0.42);
    }, 380);
  }

  /**
   * 构建极具辨识度与沉浸感的深空星际战机座舱
   */
  private buildCockpitModel(): void {
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.3,
      metalness: 0.85,
      emissive: 0x0369a1,
      emissiveIntensity: 0.35,
    });

    const edgeMat = new THREE.LineBasicMaterial({
      color: 0x00f3ff,
      linewidth: 2.0,
      transparent: true,
      opacity: 0.9,
    });
    this.wireframeMats.push(edgeMat);

    // 1. 下方战术航电主控制台 (Main Flight Avionics Deck)
    const dashGeo = new THREE.BoxGeometry(0.96, 0.18, 0.28);
    const dashMesh = new THREE.Mesh(dashGeo, frameMat);
    dashMesh.position.set(0, -0.26, 0);
    dashMesh.rotation.x = -Math.PI / 9;
    this.cockpitRig.add(dashMesh);
    this.frameMeshes.push(dashMesh);

    const dashWire = new THREE.LineSegments(new THREE.EdgesGeometry(dashGeo), edgeMat);
    dashMesh.add(dashWire);

    // 2. 左右两侧前倾斜风挡 A 柱框架 (Canopy Left & Right A-Pillars)
    [-0.36, 0.36].forEach((side) => {
      const pillarGeo = new THREE.BoxGeometry(0.055, 0.58, 0.08);
      const pillarMesh = new THREE.Mesh(pillarGeo, frameMat);
      pillarMesh.position.set(side, 0.03, 0);
      pillarMesh.rotation.z = side > 0 ? 0.34 : -0.34;
      pillarMesh.rotation.y = side > 0 ? -0.18 : 0.18;
      this.cockpitRig.add(pillarMesh);
      this.frameMeshes.push(pillarMesh);

      const pillarWire = new THREE.LineSegments(new THREE.EdgesGeometry(pillarGeo), edgeMat);
      pillarMesh.add(pillarWire);
    });

    // 3. 顶部战机座舱合金大梁 (Overhead Canopy Arch)
    const topArchGeo = new THREE.BoxGeometry(0.72, 0.06, 0.14);
    const topArchMesh = new THREE.Mesh(topArchGeo, frameMat);
    topArchMesh.position.set(0, 0.29, 0);
    this.cockpitRig.add(topArchMesh);
    this.frameMeshes.push(topArchMesh);

    const topWire = new THREE.LineSegments(new THREE.EdgesGeometry(topArchGeo), edgeMat);
    topArchMesh.add(topWire);

    // 4. 左右对称全息侧翼舷窗角标 (Side Triangular Glass Braces)
    [-0.32, 0.32].forEach((bx) => {
      const braceGeo = new THREE.BoxGeometry(0.04, 0.32, 0.05);
      const brace = new THREE.Mesh(braceGeo, frameMat);
      brace.position.set(bx, -0.05, 0.02);
      brace.rotation.z = bx > 0 ? -0.65 : 0.65;
      this.cockpitRig.add(brace);
    });

    // 5. 中央全息飞控仪表盘 (Central Holographic Attitude Horizon)
    const horizonMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.85,
    });
    const horizonGeo = new THREE.PlaneGeometry(0.12, 0.06);
    const horizon = new THREE.Mesh(horizonGeo, horizonMat);
    horizon.position.set(0, -0.16, 0.06);
    horizon.rotation.x = -Math.PI / 9;
    this.cockpitRig.add(horizon);

    // 6. 左侧全息能量护盾槽 (Shield Energy Gauge)
    this.shieldGlowMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.95,
    });
    const shieldPlateGeo = new THREE.PlaneGeometry(0.15, 0.045);
    this.shieldIndicatorMesh = new THREE.Mesh(shieldPlateGeo, this.shieldGlowMat);
    this.shieldIndicatorMesh.position.set(-0.25, -0.18, 0.05);
    this.shieldIndicatorMesh.rotation.x = -Math.PI / 9;
    this.cockpitRig.add(this.shieldIndicatorMesh);

    // 护盾多边形晶格小指示环
    const shieldRingGeo = new THREE.RingGeometry(0.024, 0.03, 6);
    const shieldRing = new THREE.Mesh(shieldRingGeo, this.shieldGlowMat);
    shieldRing.position.set(-0.34, -0.18, 0.05);
    shieldRing.rotation.x = -Math.PI / 9;
    this.cockpitRig.add(shieldRing);

    // 7. 右侧曲率引擎推力指示 (Warp Thruster Output Gauge)
    const warpMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.85,
    });
    const warpPlate = new THREE.Mesh(new THREE.PlaneGeometry(0.13, 0.04), warpMat);
    warpPlate.position.set(0.25, -0.18, 0.05);
    warpPlate.rotation.x = -Math.PI / 9;
    this.cockpitRig.add(warpPlate);

    // 8. 双联战机等离子主炮 (Twin Heavy Plasma Cannons with Coils)
    [-0.38, 0.38].forEach((cx) => {
      const cannonGeo = new THREE.CylinderGeometry(0.022, 0.026, 0.32, 6);
      const cannonMat = new THREE.MeshStandardMaterial({
        color: 0x1f2937,
        metalness: 0.92,
        roughness: 0.25,
      });
      const cannon = new THREE.Mesh(cannonGeo, cannonMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(cx, -0.22, 0.06);
      this.cockpitRig.add(cannon);

      // 炮口能量脉冲光环
      const muzzleRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.028, 0.006, 4, 12),
        new THREE.MeshBasicMaterial({ color: 0x00f3ff })
      );
      muzzleRing.position.set(cx, -0.22, -0.09);
      this.cockpitRig.add(muzzleRing);
    });

    // 9. 战机左右手操纵摇杆 (Flight Control Yokes)
    [-0.18, 0.18].forEach((jx) => {
      const yokeGrip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.014, 0.016, 0.12, 6),
        new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 })
      );
      yokeGrip.rotation.x = -Math.PI / 6;
      yokeGrip.position.set(jx, -0.2, 0.07);
      this.cockpitRig.add(yokeGrip);

      // 操纵杆顶部红色开火安全盖
      const fireCover = new THREE.Mesh(
        new THREE.BoxGeometry(0.02, 0.015, 0.025),
        new THREE.MeshBasicMaterial({ color: 0xef4444 })
      );
      fireCover.position.set(jx, -0.15, 0.06);
      this.cockpitRig.add(fireCover);
    });

    // 0. 机鼻流线装甲前锥 (Forward Chiseled Nose Cone)
    const noseGeo = new THREE.ConeGeometry(0.13, 0.46, 4);
    const noseMesh = new THREE.Mesh(noseGeo, frameMat);
    noseMesh.rotation.x = -Math.PI / 2 + 0.14;
    noseMesh.rotation.y = Math.PI / 4; // 菱形切面机甲
    noseMesh.position.set(0, -0.32, -0.18);
    this.cockpitRig.add(noseMesh);
    this.frameMeshes.push(noseMesh);
    noseMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(noseGeo), edgeMat));

    // 左右前掠翼与战术航行灯 (Canard Swept Wings & Navigation Strobes)
    [-0.52, 0.52].forEach((side) => {
      const isRight = side > 0;
      const wingGeo = new THREE.BoxGeometry(0.38, 0.024, 0.22);
      const wingMesh = new THREE.Mesh(wingGeo, frameMat);
      wingMesh.position.set(side, -0.28, -0.06);
      wingMesh.rotation.y = isRight ? -0.24 : 0.24;
      wingMesh.rotation.z = isRight ? -0.12 : 0.12;
      this.cockpitRig.add(wingMesh);
      this.frameMeshes.push(wingMesh);
      wingMesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(wingGeo), edgeMat));

      // 翼尖航行警示灯 (左舷红光，右舷绿光，经典星际航空标准)
      const beaconMat = new THREE.MeshBasicMaterial({ color: isRight ? 0x10b981 : 0xef4444 });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.016, 6, 6), beaconMat);
      beacon.position.set(isRight ? 0.19 : -0.19, 0.015, -0.08);
      wingMesh.add(beacon);
    });

    // 5. 中央全息战术雷达投影仪 (Central Holographic Tactical Radar Deck)
    const radarGroup = new THREE.Group();
    radarGroup.position.set(0, -0.15, 0.06);
    radarGroup.rotation.x = -Math.PI / 7;
    this.cockpitRig.add(radarGroup);

    // 雷达圆形半透明全息底盘
    const discGeo = new THREE.CircleGeometry(0.075, 24);
    const discMat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 0.15,
      side: THREE.DoubleSide,
    });
    const discMesh = new THREE.Mesh(discGeo, discMat);
    discMesh.rotation.x = -Math.PI / 2;
    radarGroup.add(discMesh);

    // 环形同心圆刻度圈 (10m, 20m, 30m)
    [0.025, 0.05, 0.075].forEach((r) => {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.0015, r, 24),
        new THREE.MeshBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
      );
      ring.rotation.x = -Math.PI / 2;
      radarGroup.add(ring);
    });

    // 雷达扫描十字轴线
    const axisMat = new THREE.LineBasicMaterial({ color: 0x00f3ff, transparent: true, opacity: 0.35 });
    const crossGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.075, 0.001, 0),
      new THREE.Vector3(0.075, 0.001, 0),
      new THREE.Vector3(0, 0.001, -0.075),
      new THREE.Vector3(0, 0.001, 0.075),
    ]);
    radarGroup.add(new THREE.LineSegments(crossGeo, axisMat));

    // 战机在雷达上的全息三角指示标 (随着玩家侧闪左右灵动偏移)
    const shipIconGeo = new THREE.ConeGeometry(0.012, 0.025, 3);
    const shipIconMat = new THREE.MeshBasicMaterial({ color: 0x00ffff });
    this.radarPlayerIcon = new THREE.Mesh(shipIconGeo, shipIconMat);
    this.radarPlayerIcon.rotation.x = -Math.PI / 2;
    this.radarPlayerIcon.position.set(0, 0.003, 0);
    radarGroup.add(this.radarPlayerIcon);

    // 雷达动态光点容器
    this.radarBlipsGroup = new THREE.Group();
    radarGroup.add(this.radarBlipsGroup);
  }

  // 雷达网格属性
  private radarPlayerIcon?: THREE.Mesh;
  private radarBlipsGroup?: THREE.Group;

  /**
   * 刷新全息战术雷达 (显示战机当前闪避横向机位、敌机光点及迎面等离子弹道)
   */
  public updateRadar(
    peekOffset: number,
    enemies: { position: THREE.Vector3; isDying: boolean }[],
    projectiles: { position: THREE.Vector3 }[],
    camera: THREE.Camera
  ): void {
    if (!this.isVisible || !this.radarPlayerIcon || !this.radarBlipsGroup) return;

    // 战机在雷达上的位置随着探身/闪避偏移 (peekOffset in [-2.2, 2.2] 映射到 [-0.035, 0.035])
    this.radarPlayerIcon.position.x = (peekOffset / 2.2) * 0.035;

    // 清空上一帧雷达光点
    while (this.radarBlipsGroup.children.length > 0) {
      const child = this.radarBlipsGroup.children.pop()!;
      if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose();
    }

    const camMatrixInv = camera.matrixWorldInverse;

    // 绘制敌机光点 (菱形方块，红色)
    enemies.forEach((e) => {
      if (e.isDying) return;
      const local = e.position.clone().applyMatrix4(camMatrixInv);
      const scale = 0.0022; // 30m -> ~0.066
      const rx = local.x * scale;
      const rz = -local.z * scale;
      if (rx * rx + rz * rz < 0.075 * 0.075) {
        const blip = new THREE.Mesh(
          new THREE.BoxGeometry(0.007, 0.007, 0.007),
          new THREE.MeshBasicMaterial({ color: 0xff3366 })
        );
        blip.position.set(rx, 0.004, -rz);
        this.radarBlipsGroup!.add(blip);
      }
    });

    // 绘制敌方等离子子弹光点 (亮红小球)
    projectiles.forEach((p) => {
      const local = p.position.clone().applyMatrix4(camMatrixInv);
      const scale = 0.0022;
      const rx = local.x * scale;
      const rz = -local.z * scale;
      if (rx * rx + rz * rz < 0.075 * 0.075) {
        const blip = new THREE.Mesh(
          new THREE.SphereGeometry(0.005, 6, 6),
          new THREE.MeshBasicMaterial({ color: 0xff0022 })
        );
        blip.position.set(rx, 0.005, -rz);
        this.radarBlipsGroup!.add(blip);
      }
    });
  }

  /**
   * 每一帧更新战机物理操控动力学 (摇杆侧滚倾斜、探身闪避、俯仰、引擎微抖动)
   */
  public update(delta: number, joystickVector?: JoystickVector, peekOffset: number = 0): void {
    if (!this.isVisible) return;
    this.engineTime += delta;

    // 1. 操控倾斜侧滚 (Banking on Turn & Roll Dodge)
    const joyX = joystickVector ? joystickVector.x : 0;
    const joyY = joystickVector ? joystickVector.y : 0;

    // 左右转向或战术滚转闪避时，座舱向转弯侧大幅侧倾 (增大倾角产生真实太空狗斗感)
    this.targetRoll = -joyX * 0.16 - (peekOffset * 0.14);
    // 前进推力后仰，后退前倾
    this.targetPitch = joyY * 0.08;

    this.currentRoll += (this.targetRoll - this.currentRoll) * Math.min(1.0, delta * 9.5);
    this.currentPitch += (this.targetPitch - this.currentPitch) * Math.min(1.0, delta * 9.5);

    this.cockpitRig.rotation.z = this.currentRoll;
    this.cockpitRig.rotation.x = this.currentPitch;

    // 2. 超高速巡航引擎高频微振颤与侧向闪避惯性平移
    if (!this.isShieldFlashing) {
      const hum = Math.sin(this.engineTime * 35.0) * 0.0008;
      this.cockpitRig.position.y = hum;
      this.cockpitRig.position.x = Math.cos(this.engineTime * 28.0) * 0.0005 + (peekOffset * 0.05);
    }
  }
}
