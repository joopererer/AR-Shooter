/**
 * AR 空间射手 - 主游戏控制器 (main.ts)
 * 整合 Three.js 渲染管线、WebRTC 相机层、陀螺仪四元数控制、怪物管理、
 * 屏幕边缘指示雷达、虚拟战术移动摇杆 (6DoF 近大远小走动)、WebXR 原生空间行走与 Web Audio 音效系统。
 */

import * as THREE from 'three';
import { CameraManager } from './camera';
import { GyroController, SensorMode } from './gyro';
import { MonsterManager, MonsterEntity } from './monster';
import { IndicatorManager } from './indicator';
import { VirtualJoystick } from './joystick';
import { WebXRManager } from './webxr';

export type LocomotionMode = 'joystick' | 'webxr' | 'stationary';

class ArShooterGame {
  // 3D 渲染核心与玩家控制容器 (PlayerRig 解决 WebXR 模式下摇杆坐标被底层覆写失效的问题)
  private scene: THREE.Scene;
  private playerRig = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private centerNdc = new THREE.Vector2(0, 0);

  // 游戏子系统
  private cameraManager: CameraManager;
  private gyroController: GyroController;
  private monsterManager: MonsterManager;
  private indicatorManager: IndicatorManager;
  private virtualJoystick: VirtualJoystick;
  private webxrManager: WebXRManager;

  // 空间位移与控制模式
  private locomotionMode: LocomotionMode = 'joystick';

  // 游戏数值与状态
  private score: number = 0;
  private isGameRunning: boolean = false;
  private isSoundEnabled: boolean = true;
  private currentlyLockedMonster: MonsterEntity | null = null;
  private audioCtx: AudioContext | null = null;

  // 激光光束网格
  private laserGroup = new THREE.Group();
  private activeLasers: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];

  // DOM 节点引用
  private scoreValEl: HTMLElement;
  private targetsValEl: HTMLElement;
  private statusBadgeEl: HTMLElement;
  private sensorModeEl: HTMLElement;
  private modeSwitchBtnEl: HTMLElement;
  private modePillIconEl: HTMLElement;
  private modePillTextEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private hitFeedbackContainer: HTMLElement;
  private startModalEl: HTMLElement;
  private startBtnEl: HTMLElement;
  private fireBtnEl: HTMLElement;
  private recalibrateBtnEl: HTMLElement;
  private soundBtnEl: HTMLElement;
  private soundIconOnEl: HTMLElement;
  private soundIconOffEl: HTMLElement;

  constructor() {
    // 1. 获取 DOM 节点
    this.scoreValEl = document.getElementById('score-val')!;
    this.targetsValEl = document.getElementById('targets-val')!;
    this.statusBadgeEl = document.getElementById('status-badge')!;
    this.sensorModeEl = document.getElementById('sensor-mode')!;
    this.modeSwitchBtnEl = document.getElementById('mode-switch-btn')!;
    this.modePillIconEl = document.getElementById('mode-pill-icon')!;
    this.modePillTextEl = document.getElementById('mode-pill-text')!;
    this.crosshairEl = document.getElementById('crosshair')!;
    this.hitFeedbackContainer = document.getElementById('hit-feedback-container')!;
    this.startModalEl = document.getElementById('start-modal')!;
    this.startBtnEl = document.getElementById('start-btn')!;
    this.fireBtnEl = document.getElementById('fire-btn')!;
    this.recalibrateBtnEl = document.getElementById('recalibrate-btn')!;
    this.soundBtnEl = document.getElementById('sound-btn')!;
    this.soundIconOnEl = document.getElementById('sound-icon-on')!;
    this.soundIconOffEl = document.getElementById('sound-icon-off')!;

    // 2. 初始化 Three.js 场景与玩家 Rig 控制容器
    this.scene = new THREE.Scene();
    this.scene.add(this.playerRig);

    // 3. 初始化透视相机并挂载到 playerRig 下
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.playerRig.add(this.camera);

    // 4. 初始化透明渲染画布
    const canvas = document.getElementById('ar-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.setReferenceSpaceType('local');

    // 5. 构建光照体系
    this.setupLighting();

    // 6. 添加激光束容器
    this.scene.add(this.laserGroup);

    // 7. 初始化各子系统
    this.cameraManager = new CameraManager('camera-bg');
    this.gyroController = new GyroController(this.camera, {
      onModeChange: (mode: SensorMode) => this.handleSensorModeChange(mode),
    });
    this.monsterManager = new MonsterManager(this.scene, 6);
    this.indicatorManager = new IndicatorManager('indicator-container');
    this.virtualJoystick = new VirtualJoystick('joystick-zone');

    // 初始化 WebXR 管理器 (进入前释放 WebRTC 摄像头避免独占冲突，退出后恢复)
    this.webxrManager = new WebXRManager(this.renderer, {
      onSessionStarted: () => {
        this.locomotionMode = 'webxr';
        this.updateModeUI();
        this.showStatusNotification('已开启 WebXR 真实空间行走');
      },
      onSessionEnded: async () => {
        this.locomotionMode = 'joystick';
        this.updateModeUI();
        this.showStatusNotification('已恢复 WebRTC 摇杆推进模式');
        // 恢复后置摄像头流
        await this.cameraManager.initCamera();
        const video = document.getElementById('camera-bg');
        if (video) video.style.display = 'block';
      },
      onError: async (err) => {
        this.showStatusNotification(`WebXR 异常: ${err.message}`);
        this.locomotionMode = 'joystick';
        this.updateModeUI();
        await this.cameraManager.initCamera();
        const video = document.getElementById('camera-bg');
        if (video) video.style.display = 'block';
      },
    });

    // 默认开启摇杆可见
    this.virtualJoystick.setVisible(true);

    // 8. 绑定事件并检查安全上下文
    this.bindEvents();
    this.checkSecurityContext();

    // 9. 启动渲染循环
    this.animate = this.animate.bind(this);
    this.renderer.setAnimationLoop(this.animate);
  }

  /**
   * 获取当前实际用于渲染与空间定位的相机
   * (在 WebXR 激活时返回由 ARCore 管理的 XRCamera，否则返回主相机)
   */
  public getActiveCamera(): THREE.Camera {
    if (this.renderer.xr.enabled && this.renderer.xr.isPresenting) {
      return this.renderer.xr.getCamera();
    }
    return this.camera;
  }

  /**
   * 检查是否处于移动端允许调用传感器与相机的 HTTPS 安全上下文
   */
  private checkSecurityContext(): void {
    const errorHintEl = document.getElementById('permission-error-hint');
    if (!errorHintEl) return;

    if (window.isSecureContext === false) {
      errorHintEl.innerHTML = `
        <strong>⚠️ 警告：当前处于 HTTP 非安全连接</strong><br/>
        Android 12 及现代手机浏览器出于安全隐私，<strong>强制要求 HTTPS</strong> 才能弹出摄像头与陀螺仪授权！<br/>
        👉 <strong>手机测试请使用：</strong><br/>
        1. 确保以 <code>https://</code> 访问本地服务（在高级选项中信任自签名证书）；<br/>
        2. 或直接推送到 Vercel 线上访问（自带权威 HTTPS 证书）。
      `;
      errorHintEl.classList.remove('hidden');
    }
  }

  /**
   * 构造科幻场景光照
   */
  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.4);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0x00f3ff, 2.0);
    dirLight1.position.set(5, 10, 7);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xff3366, 1.5);
    dirLight2.position.set(-5, -5, -7);
    this.scene.add(dirLight2);
  }

  /**
   * 绑定所有交互事件
   */
  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleResize(), false);

    // 启动游戏按钮
    this.startBtnEl.addEventListener('click', () => this.handleGameStart());

    // 开火按钮
    this.fireBtnEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.triggerFire();
    });

    // 屏幕触摸/点击也可快速开火 (避开摇杆区与按钮区)
    window.addEventListener('pointerdown', (e) => {
      if (!this.isGameRunning) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('#top-bar') ||
        target.closest('#joystick-zone')
      ) {
        return;
      }
      this.triggerFire();
    });

    // 模式切换按钮 (摇杆推进 / WebXR 物理行走 / 定点 3DoF)
    this.modeSwitchBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleLocomotionMode();
    });

    // 重新定格校准按钮 (视角重置正前，位置与玩家 Rig 重置回原点)
    this.recalibrateBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.gyroController.recalibrate();
      this.playerRig.position.set(0, 0, 0);
      this.camera.position.set(0, 0, 0);
      this.showStatusNotification('视角与站位已重置');
      this.playCalibrateSound();
    });

    // 音效开关
    this.soundBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSound();
    });
  }

  /**
   * 循环切换位移控制模式
   */
  private async cycleLocomotionMode(): Promise<void> {
    if (this.locomotionMode === 'joystick') {
      const isXRSupported = await this.webxrManager.checkSupport();
      if (isXRSupported) {
        // 关键避坑：Android 摄像头硬件是排他的！
        // 必须先释放 WebRTC 摄像头流，ARCore 才能成功获取摄像头硬件，否则会瞬间崩溃退出
        this.cameraManager.stopCamera();
        const video = document.getElementById('camera-bg') as HTMLVideoElement;
        if (video) video.style.display = 'none';

        const hud = document.getElementById('hud') || undefined;
        const success = await this.webxrManager.startSession(hud);
        if (success) {
          return;
        } else {
          // 启动失败恢复 WebRTC
          await this.cameraManager.initCamera();
          if (video) video.style.display = 'block';
        }
      }
      this.showStatusNotification('当前设备未检测到 WebXR，转为定点 3DoF');
      this.locomotionMode = 'stationary';
      this.updateModeUI();
    } else if (this.locomotionMode === 'webxr') {
      // 退出 WebXR 会话，恢复 WebRTC
      await this.webxrManager.endSession();
      await this.cameraManager.initCamera();
      const video = document.getElementById('camera-bg') as HTMLVideoElement;
      if (video) video.style.display = 'block';

      this.locomotionMode = 'stationary';
      this.updateModeUI();
    } else {
      // 切换到摇杆推进模式
      this.locomotionMode = 'joystick';
      this.updateModeUI();
      this.showStatusNotification('已开启左手虚拟摇杆推进');
    }
  }

  /**
   * 更新模式 UI 显示
   */
  private updateModeUI(): void {
    if (this.locomotionMode === 'joystick') {
      this.modePillIconEl.textContent = '🕹️';
      this.modePillTextEl.textContent = '摇杆推进';
      this.virtualJoystick.setVisible(true);
      this.sensorModeEl.textContent = '6DoF HYBRID';
    } else if (this.locomotionMode === 'webxr') {
      this.modePillIconEl.textContent = '🌐';
      this.modePillTextEl.textContent = 'WebXR实景';
      // 在 WebXR 下同样开放摇杆，支持真实物理走动 + 摇杆双重位移！
      this.virtualJoystick.setVisible(true);
      this.sensorModeEl.textContent = '6DoF SLAM';
    } else {
      this.modePillIconEl.textContent = '🎯';
      this.modePillTextEl.textContent = '定点3DoF';
      this.virtualJoystick.setVisible(false);
      this.sensorModeEl.textContent = '3DoF GYRO';
    }
  }

  /**
   * 用户点击开始游戏流程
   */
  private async handleGameStart(): Promise<void> {
    this.initAudioContext();

    // 申请陀螺仪与摄像头权限
    await this.gyroController.requestPermission();
    await this.cameraManager.initCamera();

    // 生成怪物群
    this.monsterManager.initMonsters();
    this.updateTargetCountUI();

    // 首次定格校准
    this.gyroController.recalibrate();
    this.playerRig.position.set(0, 0, 0);
    this.camera.position.set(0, 0, 0);

    // 隐藏启动弹窗
    this.startModalEl.classList.add('fade-out');
    setTimeout(() => {
      this.startModalEl.style.display = 'none';
    }, 400);

    this.isGameRunning = true;
    this.updateModeUI();
    this.playCalibrateSound();
  }

  private handleSensorModeChange(mode: SensorMode): void {
    if (this.locomotionMode === 'webxr') return;

    if (mode === 'gyro') {
      this.sensorModeEl.textContent = this.locomotionMode === 'joystick' ? '6DoF HYBRID' : '3DoF GYRO';
      this.sensorModeEl.style.color = '#00f3ff';
      this.statusBadgeEl.textContent = 'AR SENSORS OK';
    } else {
      this.sensorModeEl.textContent = 'TOUCH / MOUSE';
      this.sensorModeEl.style.color = '#ffaa00';
      this.statusBadgeEl.textContent = 'MANUAL MODE';
    }
  }

  /**
   * 触发射击逻辑
   */
  private triggerFire(): void {
    if (!this.isGameRunning) return;

    this.playShootSound();
    if (navigator.vibrate) {
      navigator.vibrate([25, 20, 35]);
    }

    const activeCam = this.getActiveCamera();
    const camWorldPos = new THREE.Vector3();
    activeCam.getWorldPosition(camWorldPos);

    // 从屏幕中心检测射线命中 (使用当前真实活动相机)
    this.raycaster.setFromCamera(this.centerNdc, activeCam);
    const hitTarget = this.monsterManager.checkRayIntersection(this.raycaster);

    let endPoint: THREE.Vector3;

    if (hitTarget) {
      const hitRes = this.monsterManager.hitMonster(hitTarget);
      endPoint = hitRes.worldPoint || hitTarget.currentPosition;

      this.handleHitFeedback(hitTarget, hitRes.killed || false);
      this.playHitSound();
    } else {
      endPoint = camWorldPos.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(20));
    }

    this.createLaserBeam(camWorldPos, endPoint);
  }

  /**
   * 击中/击杀视觉与得分反馈
   */
  private handleHitFeedback(monster: MonsterEntity, killed: boolean): void {
    const pts = killed ? 100 : 30;
    this.score += pts;
    this.scoreValEl.textContent = this.score.toString();

    // 屏幕中央漂浮跳字
    const floatText = document.createElement('div');
    floatText.className = 'hit-float-text';
    floatText.textContent = `+${pts} PTS`;
    if (monster.typeIndex === 1) {
      floatText.style.color = '#ec4899';
    } else if (monster.typeIndex === 2) {
      floatText.style.color = '#ffaa00';
    }
    floatText.style.left = `${window.innerWidth / 2}px`;
    floatText.style.top = `${window.innerHeight / 2 - 40}px`;
    this.hitFeedbackContainer.appendChild(floatText);

    setTimeout(() => {
      floatText.remove();
    }, 800);

    const flash = document.createElement('div');
    flash.className = 'screen-flash-hit';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 250);

    this.updateTargetCountUI();
  }

  /**
   * 创建科幻激光束
   */
  private createLaserBeam(start: THREE.Vector3, end: THREE.Vector3): void {
    const activeCam = this.getActiveCamera();
    const origin = start.clone().add(new THREE.Vector3(0, -0.2, 0).applyQuaternion(activeCam.quaternion));
    const dir = new THREE.Vector3().subVectors(end, origin);
    const len = dir.length();

    const geom = new THREE.CylinderGeometry(0.04, 0.04, len, 8);
    geom.translate(0, len / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: 0x00f3ff,
      transparent: true,
      opacity: 1.0,
      blending: THREE.AdditiveBlending,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.copy(origin);
    mesh.lookAt(end);

    this.laserGroup.add(mesh);
    this.activeLasers.push({
      mesh,
      life: 0.12,
      maxLife: 0.12,
    });
  }

  private updateLasers(delta: number): void {
    for (let i = this.activeLasers.length - 1; i >= 0; i--) {
      const item = this.activeLasers[i];
      item.life -= delta;

      if (item.life <= 0) {
        this.laserGroup.remove(item.mesh);
        item.mesh.geometry.dispose();
        (item.mesh.material as THREE.Material).dispose();
        this.activeLasers.splice(i, 1);
        continue;
      }

      const factor = item.life / item.maxLife;
      (item.mesh.material as THREE.MeshBasicMaterial).opacity = factor;
    }
  }

  /**
   * 准星锁定状态实时检测
   */
  private updateCrosshairLocking(): void {
    if (!this.isGameRunning) return;

    const activeCam = this.getActiveCamera();
    this.raycaster.setFromCamera(this.centerNdc, activeCam);
    const hitMonster = this.monsterManager.checkRayIntersection(this.raycaster);

    if (hitMonster) {
      if (this.currentlyLockedMonster !== hitMonster) {
        this.currentlyLockedMonster = hitMonster;
        this.crosshairEl.classList.add('locked');
        this.playLockBeepSound();
      }
    } else {
      if (this.currentlyLockedMonster !== null) {
        this.currentlyLockedMonster = null;
        this.crosshairEl.classList.remove('locked');
      }
    }
  }

  private showStatusNotification(msg: string): void {
    const originalText = this.statusBadgeEl.textContent;
    this.statusBadgeEl.textContent = msg;
    this.statusBadgeEl.style.color = '#ffaa00';
    setTimeout(() => {
      this.statusBadgeEl.textContent = originalText;
      this.statusBadgeEl.style.color = '#00ffaa';
    }, 1800);
  }

  private updateTargetCountUI(): void {
    this.targetsValEl.textContent = this.monsterManager.getAliveCount().toString();
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  private initAudioContext(): void {
    if (!this.audioCtx) {
      const AudioCtxClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  private toggleSound(): void {
    this.isSoundEnabled = !this.isSoundEnabled;
    if (this.isSoundEnabled) {
      this.soundIconOnEl.classList.remove('hidden');
      this.soundIconOffEl.classList.add('hidden');
    } else {
      this.soundIconOnEl.classList.add('hidden');
      this.soundIconOffEl.classList.remove('hidden');
    }
  }

  private playShootSound(): void {
    if (!this.isSoundEnabled || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      const now = ctx.currentTime;

      osc.frequency.setValueAtTime(880, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.15);

      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.16);
    } catch {}
  }

  private playHitSound(): void {
    if (!this.isSoundEnabled || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      const now = ctx.currentTime;

      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(40, now + 0.35);

      gain.gain.setValueAtTime(0.4, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.36);
    } catch {}
  }

  private playLockBeepSound(): void {
    if (!this.isSoundEnabled || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      const now = ctx.currentTime;

      osc.frequency.setValueAtTime(1200, now);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  private playCalibrateSound(): void {
    if (!this.isSoundEnabled || !this.audioCtx) return;
    try {
      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      const notes = [440, 660, 880];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        const start = now + idx * 0.06;
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.12, start);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.12);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(start);
        osc.stop(start + 0.13);
      });
    } catch {}
  }

  /**
   * 游戏每一帧渲染主循环
   */
  private animate(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();
    const activeCam = this.getActiveCamera();

    // 1. 如果不在 WebXR 模式下，更新自定义陀螺仪四元数
    if (!this.webxrManager.getIsActive()) {
      this.gyroController.update(delta);
    }

    // 2. 摇杆位移推进 (无论普通模式还是 WebXR 模式均平移 playerRig，彻底解决 WebXR 下摇杆失效的问题)
    if (this.virtualJoystick.getIsVisible() && this.isGameRunning) {
      this.virtualJoystick.applyMovement(this.playerRig, activeCam, delta, 4.0);
    }

    // 核心关键：强制刷新整个三维空间图的世界矩阵！
    // 确保相机与 Rig 移动后的世界坐标即时同步，彻底杜绝准星空锁与判定错位！
    this.scene.updateMatrixWorld(true);

    // 3. 更新怪物动画与 FOV 衰减 (使用当前真实活动相机)
    this.monsterManager.update(delta, elapsed, activeCam);

    // 4. 更新激光束
    this.updateLasers(delta);

    // 5. 准星锁定目标检测
    this.updateCrosshairLocking();

    // 6. 屏外边缘指示箭头更新 (使用当前真实相机的世界坐标计算距离与方位角)
    if (this.isGameRunning) {
      this.indicatorManager.update(activeCam, this.monsterManager.getActiveMonsters());
    }

    // 7. 执行渲染
    this.renderer.render(this.scene, this.camera);
  }
}

// 页面加载完成后实例化游戏
window.addEventListener('DOMContentLoaded', () => {
  new ArShooterGame();
});
