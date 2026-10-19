/**
 * AR 空间射手 - 主游戏控制器 (main.ts)
 * 整合 Three.js 渲染管线、WebRTC 相机层、陀螺仪四元数控制、怪物管理、
 * 屏幕边缘指示雷达、屏幕中心射线射击与 Web Audio 音效系统。
 */

import * as THREE from 'three';
import { CameraManager } from './camera';
import { GyroController, SensorMode } from './gyro';
import { MonsterManager, MonsterEntity } from './monster';
import { IndicatorManager } from './indicator';

class ArShooterGame {
  // 3D 渲染核心
  private scene: THREE.Scene;
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
    this.crosshairEl = document.getElementById('crosshair')!;
    this.hitFeedbackContainer = document.getElementById('hit-feedback-container')!;
    this.startModalEl = document.getElementById('start-modal')!;
    this.startBtnEl = document.getElementById('start-btn')!;
    this.fireBtnEl = document.getElementById('fire-btn')!;
    this.recalibrateBtnEl = document.getElementById('recalibrate-btn')!;
    this.soundBtnEl = document.getElementById('sound-btn')!;
    this.soundIconOnEl = document.getElementById('sound-icon-on')!;
    this.soundIconOffEl = document.getElementById('sound-icon-off')!;

    // 2. 初始化 Three.js 场景
    this.scene = new THREE.Scene();

    // 3. 初始化透视相机 (视场角 70 度，适配大多数手机后置镜头垂直广角)
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 0);

    // 4. 初始化透明渲染画布
    const canvas = document.getElementById('ar-canvas') as HTMLCanvasElement;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true, // 核心配置：背景透明以透显视频流
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 0); // 完全透明
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);

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

    // 8. 绑定事件并检查安全上下文
    this.bindEvents();
    this.checkSecurityContext();

    // 9. 启动渲染循环
    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
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
    // 窗口尺寸变更
    window.addEventListener('resize', () => this.handleResize(), false);

    // 启动游戏按钮：必须在用户点击事件直接调用 iOS 权限与摄像头
    this.startBtnEl.addEventListener('click', () => this.handleGameStart());

    // 开火按钮
    this.fireBtnEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.triggerFire();
    });

    // 屏幕触摸/点击也可快速开火 (除特定按钮区域外)
    window.addEventListener('pointerdown', (e) => {
      if (!this.isGameRunning) return;
      const target = e.target as HTMLElement;
      if (target.closest('button') || target.closest('#top-bar')) return;
      this.triggerFire();
    });

    // 重新定格校准按钮
    this.recalibrateBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.gyroController.recalibrate();
      this.showStatusNotification('场景已重新定格对齐');
      this.playCalibrateSound();
    });

    // 音效开关
    this.soundBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleSound();
    });
  }

  /**
   * 用户点击开始游戏流程
   */
  private async handleGameStart(): Promise<void> {
    this.initAudioContext();

    // 同步触发权限申请 (关键：iOS 13+ 需要在用户手势链中直接调用)
    const gyroAllowed = await this.gyroController.requestPermission();
    console.log('[ArShooterGame] 陀螺仪授权状态:', gyroAllowed);

    // 同步请求后置摄像头视频流
    const cameraResult = await this.cameraManager.initCamera();
    console.log('[ArShooterGame] 摄像头初始化结果:', cameraResult);

    // 生成怪物群
    this.monsterManager.initMonsters();
    this.updateTargetCountUI();

    // 首次定格校准：将当前朝向设为 (0, 0, -1)
    this.gyroController.recalibrate();

    // 隐藏启动弹窗
    this.startModalEl.classList.add('fade-out');
    setTimeout(() => {
      this.startModalEl.style.display = 'none';
    }, 400);

    this.isGameRunning = true;
    this.playCalibrateSound();
  }

  /**
   * 传感器模式切换提示
   */
  private handleSensorModeChange(mode: SensorMode): void {
    if (mode === 'gyro') {
      this.sensorModeEl.textContent = 'GYRO 3DoF';
      this.sensorModeEl.style.color = '#00f3ff';
      this.statusBadgeEl.textContent = 'AR SENSORS OK';
    } else {
      this.sensorModeEl.textContent = 'MOUSE / TOUCH';
      this.sensorModeEl.style.color = '#ffaa00';
      this.statusBadgeEl.textContent = 'MANUAL MODE';
    }
  }

  /**
   * 触发射击逻辑
   */
  private triggerFire(): void {
    if (!this.isGameRunning) return;

    // 播放开火音效与触感震动
    this.playShootSound();
    if (navigator.vibrate) {
      navigator.vibrate([25, 20, 35]);
    }

    // 从屏幕中心检测射线命中
    this.raycaster.setFromCamera(this.centerNdc, this.camera);
    const hitTarget = this.monsterManager.checkRayIntersection(this.raycaster);

    let endPoint: THREE.Vector3;

    if (hitTarget) {
      // 命中怪物
      const hitRes = this.monsterManager.hitMonster(hitTarget);
      endPoint = hitRes.worldPoint || hitTarget.currentPosition;

      // 击中反馈动画
      this.handleHitFeedback(hitTarget, hitRes.killed || false);
      this.playHitSound();
    } else {
      // 未命中，激光射向射线远方
      endPoint = this.camera.position.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(20));
    }

    // 生成瞬态激光束动画
    this.createLaserBeam(this.camera.position, endPoint);
  }

  /**
   * 击中/击杀视觉与得分反馈
   */
  private handleHitFeedback(monster: MonsterEntity, killed: boolean): void {
    const pts = killed ? 100 : 30;
    this.score += pts;
    this.scoreValEl.textContent = this.score.toString();

    // 屏幕中央漂浮跳字 (按怪物类型定制高亮色)
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

    // 全屏轻微闪白光晕
    const flash = document.createElement('div');
    flash.className = 'screen-flash-hit';
    document.body.appendChild(flash);
    setTimeout(() => flash.remove(), 250);

    // 更新存活计数
    this.updateTargetCountUI();
  }

  /**
   * 创建科幻激光束
   */
  private createLaserBeam(start: THREE.Vector3, end: THREE.Vector3): void {
    // 从相机略偏下方发出（模拟武器手持位置）
    const origin = start.clone().add(new THREE.Vector3(0, -0.2, 0).applyQuaternion(this.camera.quaternion));
    const dir = new THREE.Vector3().subVectors(end, origin);
    const len = dir.length();

    const geom = new THREE.CylinderGeometry(0.04, 0.04, len, 8);
    // 旋转圆柱体使其对准方向
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

  /**
   * 激光束随时间缩短淡出
   */
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

    this.raycaster.setFromCamera(this.centerNdc, this.camera);
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

  /**
   * 状态栏简短飘字通知
   */
  private showStatusNotification(msg: string): void {
    const originalText = this.statusBadgeEl.textContent;
    this.statusBadgeEl.textContent = msg;
    this.statusBadgeEl.style.color = '#ffaa00';
    setTimeout(() => {
      this.statusBadgeEl.textContent = originalText;
      this.statusBadgeEl.style.color = '#00ffaa';
    }, 1500);
  }

  /**
   * 更新存活怪物数量 UI
   */
  private updateTargetCountUI(): void {
    this.targetsValEl.textContent = this.monsterManager.getAliveCount().toString();
  }

  /**
   * 窗口尺寸自适应
   */
  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  /**
   * Web Audio API 音效合成引擎 (零网络依赖，原生产生)
   */
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

  /**
   * 激光发射音效 (快速滑降频调频振荡)
   */
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
    } catch {
      // 忽略音频异常
    }
  }

  /**
   * 怪物击中/爆炸音效
   */
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
    } catch {
      // 忽略音频异常
    }
  }

  /**
   * 锁定目标时的轻微蜂鸣音
   */
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
    } catch {
      // 忽略音频异常
    }
  }

  /**
   * 校准对齐提示音
   */
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
    } catch {
      // 忽略音频异常
    }
  }

  /**
   * 游戏每一帧渲染主循环
   */
  private animate(): void {
    requestAnimationFrame(this.animate);

    const delta = Math.min(this.clock.getDelta(), 0.1);
    const elapsed = this.clock.getElapsedTime();

    // 1. 更新陀螺仪姿态数据 (带 delta 阻尼平滑)
    this.gyroController.update(delta);

    // 2. 更新怪物动画与 FOV 衰减
    this.monsterManager.update(delta, elapsed, this.camera);

    // 3. 更新激光束
    this.updateLasers(delta);

    // 4. 实时检测准星是否锁定怪物
    this.updateCrosshairLocking();

    // 5. 更新屏外边缘指示箭头
    if (this.isGameRunning) {
      this.indicatorManager.update(this.camera, this.monsterManager.getActiveMonsters());
    }

    // 6. 执行透明 WebGL 渲染
    this.renderer.render(this.scene, this.camera);
  }
}

// 页面加载完成后实例化游戏
window.addEventListener('DOMContentLoaded', () => {
  new ArShooterGame();
});
