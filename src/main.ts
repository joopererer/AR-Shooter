/**
 * AR 空间射手 - 主游戏控制器 (main.ts)
 * 整合 V2.0 荒野狩猎生态、树木巨石掩体、歪头探身 (Roll-to-Peek)、
 * 多武器视模 (步枪/霰弹/穿甲狙+光学变焦)、零音频依赖合成引擎与体感切枪系统。
 */

import * as THREE from 'three';
import { CameraManager } from './camera';
import { GyroController, SensorMode } from './gyro';
import { IndicatorManager } from './indicator';
import { VirtualJoystick } from './joystick';
import { WebXRManager } from './webxr';
import { AudioManager } from './audio';
import { EnvironmentManager } from './environment';
import { EntityManager, GameEntity } from './entities';
import { WeaponManager, WeaponType, WeaponConfig } from './weapons';
import { ModeManager, GameMode } from './modes';
import { CockpitManager } from './cockpit';

export type LocomotionMode = 'joystick' | 'webxr' | 'stationary';

class ArShooterGame {
  // 3D 渲染核心与玩家控制容器
  private scene: THREE.Scene;
  private playerRig = new THREE.Group();
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private clock = new THREE.Clock();
  private raycaster = new THREE.Raycaster();
  private centerNdc = new THREE.Vector2(0, 0);

  // 临时辅助向量
  private readonly tempCamPos = new THREE.Vector3();

  // 游戏子系统管理器
  private cameraManager: CameraManager;
  private gyroController: GyroController;
  private indicatorManager: IndicatorManager;
  private virtualJoystick: VirtualJoystick;
  private webxrManager: WebXRManager;
  private audioManager: AudioManager;
  private environmentManager: EnvironmentManager;
  private entityManager: EntityManager;
  private weaponManager: WeaponManager;
  private cockpitManager: CockpitManager;
  private modeManager: ModeManager;

  // 控制模式与状态
  private locomotionMode: LocomotionMode = 'joystick';
  private score: number = 0;
  private isGameRunning: boolean = false;
  private currentlyLockedEntity: GameEntity | null = null;
  private sliderPeekOffset: number = 0;

  // 激光光束网格
  private laserGroup = new THREE.Group();
  private activeLasers: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];

  // DOM 节点引用
  private scoreValEl: HTMLElement;
  private targetsValEl: HTMLElement;
  private statusBadgeEl: HTMLElement;
  private sensorModeEl: HTMLElement;
  private gameModeBtnEl: HTMLElement;
  private gameModeIconEl: HTMLElement;
  private gameModeTextEl: HTMLElement;
  private modeSwitchBtnEl: HTMLElement;
  private modePillIconEl: HTMLElement;
  private modePillTextEl: HTMLElement;
  private crosshairEl: HTMLElement;
  private lockHintEl: HTMLElement;
  private friendlyBadgeEl: HTMLElement;
  private blockedBadgeEl: HTMLElement;
  private hitFeedbackContainer: HTMLElement;
  private startModalEl: HTMLElement;
  private startBtnEl: HTMLElement;
  private fireBtnEl: HTMLElement;
  private recalibrateBtnEl: HTMLElement;
  private soundBtnEl: HTMLElement;
  private soundIconOnEl: HTMLElement;
  private soundIconOffEl: HTMLElement;

  // V2.0 扩展 DOM
  private peekLeftBtnEl: HTMLElement;
  private peekCenterBtnEl: HTMLElement;
  private peekRightBtnEl: HTMLElement;
  private peekSliderEl: HTMLInputElement;
  private peekValTextEl: HTMLElement;
  private weaponBtnEls: NodeListOf<HTMLButtonElement>;
  private sniperScopeEl: HTMLElement;
  private scopeTargetTextEl: HTMLElement;
  private friendlyFlashEl: HTMLElement;
  private cameraBgEl: HTMLElement;

  constructor() {
    // 1. 获取核心 HUD DOM 节点
    this.scoreValEl = document.getElementById('score-val')!;
    this.targetsValEl = document.getElementById('targets-val')!;
    this.statusBadgeEl = document.getElementById('status-badge')!;
    this.sensorModeEl = document.getElementById('sensor-mode')!;
    this.gameModeBtnEl = document.getElementById('game-mode-btn')!;
    this.gameModeIconEl = document.getElementById('game-mode-icon')!;
    this.gameModeTextEl = document.getElementById('game-mode-text')!;
    this.modeSwitchBtnEl = document.getElementById('mode-switch-btn')!;
    this.modePillIconEl = document.getElementById('mode-pill-icon')!;
    this.modePillTextEl = document.getElementById('mode-pill-text')!;
    this.crosshairEl = document.getElementById('crosshair')!;
    this.lockHintEl = document.getElementById('lock-hint')!;
    this.friendlyBadgeEl = document.getElementById('friendly-warning-badge')!;
    this.blockedBadgeEl = document.getElementById('cover-blocked-badge')!;
    this.hitFeedbackContainer = document.getElementById('hit-feedback-container')!;
    this.startModalEl = document.getElementById('start-modal')!;
    this.startBtnEl = document.getElementById('start-btn')!;
    this.fireBtnEl = document.getElementById('fire-btn')!;
    this.recalibrateBtnEl = document.getElementById('recalibrate-btn')!;
    this.soundBtnEl = document.getElementById('sound-btn')!;
    this.soundIconOnEl = document.getElementById('sound-icon-on')!;
    this.soundIconOffEl = document.getElementById('sound-icon-off')!;

    // V2.0 节点
    this.peekLeftBtnEl = document.getElementById('peek-left-btn')!;
    this.peekCenterBtnEl = document.getElementById('peek-center-btn')!;
    this.peekRightBtnEl = document.getElementById('peek-right-btn')!;
    this.peekSliderEl = document.getElementById('peek-slider') as HTMLInputElement;
    this.peekValTextEl = document.getElementById('peek-val-text')!;
    this.weaponBtnEls = document.querySelectorAll('.weapon-btn');
    this.sniperScopeEl = document.getElementById('sniper-scope-overlay')!;
    this.scopeTargetTextEl = document.getElementById('scope-target-text')!;
    this.friendlyFlashEl = document.getElementById('friendly-flash-overlay')!;
    this.cameraBgEl = document.getElementById('camera-bg')!;

    // 2. 初始化 Three.js 场景与玩家 Rig 控制容器
    this.scene = new THREE.Scene();
    this.scene.add(this.playerRig);

    // 3. 初始化透视相机并挂载到 playerRig 下
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(70, aspect, 0.1, 1000);
    this.camera.position.set(0, 0, 0);
    this.playerRig.add(this.camera);

    // 4. 初始化透明 WebGL 画布
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

    // 5. 构建光照体系与激光容器
    this.setupLighting();
    this.scene.add(this.laserGroup);

    // 6. 初始化各子系统
    this.audioManager = new AudioManager();
    this.cameraManager = new CameraManager('camera-bg');
    this.gyroController = new GyroController(this.camera, {
      onModeChange: (mode: SensorMode) => this.handleSensorModeChange(mode),
    });
    this.indicatorManager = new IndicatorManager('indicator-container');
    this.virtualJoystick = new VirtualJoystick('joystick-zone');
    this.environmentManager = new EnvironmentManager(this.scene);
    this.entityManager = new EntityManager(
      this.scene,
      () => this.handlePlayerHitByEnemy(),
      () => this.audioManager.playEnemyLaserFire()
    );
    this.weaponManager = new WeaponManager(this.camera, (cfg) => this.onWeaponSwitched(cfg));
    this.cockpitManager = new CockpitManager(this.camera);
    this.modeManager = new ModeManager('hunting', (mode) => this.onModeSwitched(mode));

    // WebXR 会话管理器
    this.webxrManager = new WebXRManager(this.renderer, {
      onSessionStarted: () => {
        this.locomotionMode = 'webxr';
        this.updateModeUI();
        this.showStatusNotification('已开启 WebXR 真实物理行走');
      },
      onSessionEnded: async () => {
        this.locomotionMode = 'joystick';
        this.updateModeUI();
        this.showStatusNotification('已恢复 WebRTC 摇杆推进模式');
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

    // 初始场景生态生成
    this.applyCurrentModeContent('hunting');

    // 7. 绑定所有 UI 与体感控制事件
    this.bindEvents();
    this.checkSecurityContext();

    // 8. 启动渲染主循环
    this.animate = this.animate.bind(this);
    this.renderer.setAnimationLoop(this.animate);
  }

  /**
   * 获取当前有效用于视野判断的相机
   */
  public getActiveCamera(): THREE.Camera {
    if (this.renderer.xr.enabled && this.renderer.xr.isPresenting) {
      return this.renderer.xr.getCamera();
    }
    return this.camera;
  }

  private checkSecurityContext(): void {
    const errorHintEl = document.getElementById('permission-error-hint');
    if (!errorHintEl) return;

    if (window.isSecureContext === false) {
      errorHintEl.innerHTML = `
        <strong>⚠️ 警告：当前处于 HTTP 非安全连接</strong><br/>
        Android 12 及现代手机浏览器出于安全隐私，<strong>强制要求 HTTPS</strong> 才能弹出摄像头与陀螺仪授权！<br/>
        👉 请使用 https:// 协议或部署至 Vercel 体验完整体感功能。
      `;
      errorHintEl.classList.remove('hidden');
    }
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight1.position.set(5, 12, 7);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x00f3ff, 1.2);
    dirLight2.position.set(-6, 2, -6);
    this.scene.add(dirLight2);
  }

  /**
   * 绑定全部交互事件
   */
  private bindEvents(): void {
    window.addEventListener('resize', () => this.handleResize(), false);

    // 开启游戏
    this.startBtnEl.addEventListener('click', () => this.handleGameStart());

    // 开火按钮
    this.fireBtnEl.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      this.triggerFire();
    });

    // 屏幕触摸/点击快速开火 (避开 HUD 控制区)
    window.addEventListener('pointerdown', (e) => {
      if (!this.isGameRunning) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('#top-bar') ||
        target.closest('#joystick-zone') ||
        target.closest('#peek-controller') ||
        target.closest('#weapon-dock')
      ) {
        return;
      }
      this.triggerFire();
    });

    // 游戏模式切换 (荒野狩猎 / 星际防卫 / 幽灵猎手)
    this.gameModeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.modeManager.switchNextMode();
    });

    // 空间位移模式切换 (摇杆推进 / WebXR 空间走动)
    this.modeSwitchBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.cycleLocomotionMode();
    });

    // 视角重新校准
    this.recalibrateBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.gyroController.recalibrate();
      this.playerRig.position.set(0, 0, 0);
      this.camera.position.set(0, 0, 0);
      this.showStatusNotification('视角与站位已重置');
      this.audioManager.playLockSound();
    });

    // 音效开关
    this.soundBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = this.audioManager.getIsEnabled();
      this.audioManager.setEnabled(!current);
      if (!current) {
        this.soundIconOnEl.classList.remove('hidden');
        this.soundIconOffEl.classList.add('hidden');
      } else {
        this.soundIconOnEl.classList.add('hidden');
        this.soundIconOffEl.classList.remove('hidden');
      }
    });

    // 歪头探身控制器 (Peek Buttons & Slider)
    this.peekLeftBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setPeekOffsetDirect(-1.8);
    });
    this.peekCenterBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setPeekOffsetDirect(0);
    });
    this.peekRightBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setPeekOffsetDirect(1.8);
    });
    this.peekSliderEl.addEventListener('input', () => {
      this.sliderPeekOffset = parseFloat(this.peekSliderEl.value);
    });

    // 武器切换基座 (Weapon Dock)
    this.weaponBtnEls.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const weaponType = btn.dataset.weapon as WeaponType;
        if (weaponType) {
          this.weaponManager.setWeapon(weaponType);
        }
      });
    });
  }

  private setPeekOffsetDirect(val: number): void {
    this.sliderPeekOffset = val;
    this.peekSliderEl.value = val.toString();
  }

  /**
   * 当切换武器时回调
   */
  private onWeaponSwitched(cfg: WeaponConfig): void {
    // 1. 更新 HUD 按钮高亮
    this.weaponBtnEls.forEach((btn) => {
      if (btn.dataset.weapon === cfg.type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // 2. 播放机械上膛音效
    this.audioManager.playWeaponSwitch();
    this.showStatusNotification(`已装备: ${cfg.name}`);

    // 3. 狙击枪光学 2X 变焦机制
    if (cfg.type === 'sniper') {
      this.camera.fov = 70 / 2.0;
      this.camera.updateProjectionMatrix();
      this.cameraBgEl.style.transform = 'scale(2.0)';
      this.cameraBgEl.style.transition = 'transform 0.25s ease';
      this.sniperScopeEl.classList.remove('hidden');
    } else {
      this.camera.fov = 70;
      this.camera.updateProjectionMatrix();
      this.cameraBgEl.style.transform = 'scale(1.0)';
      this.sniperScopeEl.classList.add('hidden');
    }
  }

  /**
   * 当切换玩法模式时回调
   */
  private onModeSwitched(mode: GameMode): void {
    const cfg = this.modeManager.getModeConfig(mode);
    this.gameModeIconEl.textContent = cfg.icon;
    this.gameModeTextEl.textContent = cfg.name;
    this.showStatusNotification(`进入【${cfg.name}】模式`);

    this.applyCurrentModeContent(mode);
  }

  private applyCurrentModeContent(mode: GameMode): void {
    this.entityManager.setMode(mode);
    if (mode === 'hunting') {
      this.environmentManager.initHuntingEnvironment();
      this.entityManager.initHuntingEcosystem();
      this.cockpitManager.setVisible(false);
      this.weaponManager.setVisible(true);
    } else if (mode === 'scifi') {
      this.environmentManager.initSciFiEnvironment();
      this.entityManager.initSciFiEcosystem();
      this.cockpitManager.setVisible(true);
      this.weaponManager.setVisible(false); // 星际模式下由战机外置双主炮开火
    } else if (mode === 'ghost') {
      this.environmentManager.initHalloweenEnvironment();
      this.entityManager.initGhostEcosystem();
      this.cockpitManager.setVisible(false);
      this.weaponManager.setVisible(true);
    }
    this.updateTargetCountUI();
  }

  /**
   * 玩家飞船遭受敌方战机等离子光弹击中
   */
  private handlePlayerHitByEnemy(): void {
    if (this.modeManager.getMode() === 'scifi') {
      this.cockpitManager.triggerShieldHit();
    }
    this.audioManager.playShipShieldHit();
    this.triggerFriendlyWarningFlash();
    this.score = Math.max(0, this.score - 150);
    this.scoreValEl.textContent = this.score.toString();
    this.showHitPopup('⚠️ 战机护盾遭受等离子轰击 -150', true, 'friendly-penalty');
  }

  private cycleLocomotionMode(): void {
    if (this.locomotionMode === 'joystick') {
      this.webxrManager.startSession();
    } else {
      this.webxrManager.endSession();
    }
  }

  private updateModeUI(): void {
    if (this.locomotionMode === 'webxr') {
      this.modePillIconEl.textContent = '👓';
      this.modePillTextEl.textContent = 'WebXR空间';
      this.virtualJoystick.setVisible(false);
      this.sensorModeEl.textContent = '6DoF XR';
      this.sensorModeEl.style.color = '#10b981';
    } else {
      this.modePillIconEl.textContent = '🕹️';
      this.modePillTextEl.textContent = '摇杆推进';
      this.virtualJoystick.setVisible(true);
      this.sensorModeEl.textContent = '6DoF HYBRID';
      this.sensorModeEl.style.color = '#00f3ff';
    }
  }

  private async handleGameStart(): Promise<void> {
    this.audioManager.init();

    try {
      await this.cameraManager.initCamera();
    } catch (e) {
      console.warn('[Camera] 摄像头初始化异常，已降级虚拟背景', e);
    }

    try {
      await this.gyroController.requestPermission();
    } catch (e) {
      console.warn('[Gyro] 陀螺仪初始化异常，已降级触控', e);
    }

    this.startModalEl.classList.add('hidden');
    this.isGameRunning = true;
    this.updateModeUI();
    this.audioManager.playLockSound();
  }

  private handleSensorModeChange(mode: SensorMode): void {
    if (this.locomotionMode === 'webxr') return;
    if (mode === 'gyro') {
      this.sensorModeEl.textContent = '6DoF HYBRID';
      this.sensorModeEl.style.color = '#00f3ff';
      this.statusBadgeEl.textContent = 'AR SENSORS OK';
    } else {
      this.sensorModeEl.textContent = 'TOUCH / MOUSE';
      this.sensorModeEl.style.color = '#ffaa00';
      this.statusBadgeEl.textContent = 'MANUAL MODE';
    }
  }

  /**
   * 触发射击：多武器散射、掩体物理遮挡与击中/误伤处理
   */
  private triggerFire(): void {
    if (!this.isGameRunning) return;

    // 检查武器冷却
    if (!this.weaponManager.canFire()) return;

    const activeCam = this.getActiveCamera();
    activeCam.getWorldPosition(this.tempCamPos);
    const cfg = this.weaponManager.getCurrentConfig();

    // 武器音效与触觉反馈
    if (cfg.type === 'rifle') {
      this.audioManager.playRifleShot();
      if (navigator.vibrate) navigator.vibrate([25, 20, 35]);
    } else if (cfg.type === 'shotgun') {
      this.audioManager.playShotgunShot();
      if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    } else {
      this.audioManager.playSniperShot();
      if (navigator.vibrate) navigator.vibrate([35, 25, 45]);
    }

    // 遍历当前武器弹丸 (霰弹枪为 8 颗，步枪/狙击为 1 发)
    const pellets = cfg.pellets;
    const spread = cfg.spread;

    for (let p = 0; p < pellets; p++) {
      const spreadX = (Math.random() - 0.5) * spread;
      const spreadY = (Math.random() - 0.5) * spread;
      const pelletNdc = new THREE.Vector2(spreadX, spreadY);

      this.raycaster.setFromCamera(pelletNdc, activeCam);

      // 1. 掩体物理遮挡检测
      const obsHit = this.environmentManager.checkObstacleIntersection(this.raycaster);
      // 2. 动物实体检测
      const entHit = this.entityManager.checkRayIntersection(this.raycaster);

      let endPoint: THREE.Vector3;
      let bulletBlocked = false;

      // 判定逻辑：若击中掩体且掩体比猎物更近，并且当前武器不具备穿甲属性，则子弹被拦截！
      if (obsHit && !cfg.penetratesCover) {
        if (!entHit) {
          bulletBlocked = true;
        } else {
          const distToEntity = this.tempCamPos.distanceTo(entHit.position);
          if (obsHit.distance < distToEntity) {
            bulletBlocked = true;
          }
        }
      }

      // 如果是穿甲狙击枪击中掩体，狙击弹穿透掩体的同时对掩体造成重创甚至直接打碎！
      if (obsHit && obsHit.obstacle && cfg.penetratesCover) {
        const obsRes = this.environmentManager.hitObstacle(obsHit.obstacle, cfg.obstacleDamage, obsHit.point);
        if (obsRes.destroyed) {
          this.audioManager.playObstacleDestroyed(obsRes.obstacle.type);
          this.showHitPopup(`💥 穿甲贯穿！${obsRes.name}被轰碎`, false, 'blocked-hint');
        }
      }

      if (bulletBlocked && obsHit && obsHit.obstacle) {
        // 掩体格挡！扣除掩体耐久并判断是否崩碎
        endPoint = obsHit.point;
        const obsRes = this.environmentManager.hitObstacle(obsHit.obstacle, cfg.obstacleDamage, obsHit.point);

        if (obsRes.destroyed) {
          // 掩体耐久归零彻底碎裂！
          this.audioManager.playObstacleDestroyed(obsRes.obstacle.type);
          this.showHitPopup(`💥 ${obsRes.name}崩塌碎裂！`, false, 'blocked-hint');
        } else {
          // 未彻底碎裂：播放格挡音并显示剩余耐久
          this.audioManager.playObstacleHit();
          this.showHitPopup(`🛡️ ${obsRes.name}耐久 [${obsRes.remainingHealth}/${obsRes.obstacle.maxHealth}]`, false, 'blocked-hint');
        }
      } else if (entHit) {
        // 击中实体 (目标猎物 或 友善动物)
        endPoint = entHit.position.clone();
        const hitRes = this.entityManager.hitEntity(entHit, cfg.damage, entHit.position);

        if (hitRes.isFriendly) {
          // 误伤禁射目标！屏幕泛红警报、大额扣分与哀鸣
          this.score = Math.max(0, this.score + hitRes.scoreChange);
          this.scoreValEl.textContent = this.score.toString();
          this.audioManager.playFriendlyHurt();
          this.triggerFriendlyWarningFlash();
          this.showHitPopup(`${hitRes.scoreChange} 误伤${hitRes.name}！`, true, 'friendly-penalty');
        } else {
          // 命中猎物目标！
          this.score += hitRes.scoreChange;
          this.scoreValEl.textContent = this.score.toString();
          this.audioManager.playTargetHit(hitRes.killed || false);
          this.showHitPopup(`+${hitRes.scoreChange} ${hitRes.name}`, false);
        }
      } else {
        // 未中目标，射向远空
        endPoint = this.tempCamPos.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(22));
      }

      // 创建激光弹道
      const beamColor = cfg.type === 'sniper' ? 0x22d3ee : cfg.type === 'shotgun' ? 0xf59e0b : 0x00f3ff;
      this.createLaserBeam(this.tempCamPos, endPoint, beamColor);
    }

    this.updateTargetCountUI();
  }

  /**
   * 触发误伤刺眼全屏泛光
   */
  private triggerFriendlyWarningFlash(): void {
    this.friendlyFlashEl.classList.remove('hidden');
    setTimeout(() => {
      this.friendlyFlashEl.classList.add('hidden');
    }, 450);
  }

  /**
   * 浮动飘字特效
   */
  private showHitPopup(text: string, isDanger: boolean = false, customClass?: string): void {
    const floatText = document.createElement('div');
    floatText.className = `hit-float-text ${customClass || ''}`;
    floatText.textContent = text;
    if (isDanger) {
      floatText.style.color = '#ef4444';
    }
    floatText.style.left = `${window.innerWidth / 2}px`;
    floatText.style.top = `${window.innerHeight / 2 - 40}px`;
    this.hitFeedbackContainer.appendChild(floatText);

    setTimeout(() => {
      floatText.remove();
    }, 850);
  }

  private createLaserBeam(start: THREE.Vector3, end: THREE.Vector3, colorHex: number = 0x00f3ff): void {
    const activeCam = this.getActiveCamera();
    const origin = start.clone().add(new THREE.Vector3(0.18, -0.16, -0.4).applyQuaternion(activeCam.quaternion));
    const dir = new THREE.Vector3().subVectors(end, origin);
    const len = dir.length();

    const geom = new THREE.CylinderGeometry(0.03, 0.03, len, 6);
    geom.translate(0, len / 2, 0);
    geom.rotateX(Math.PI / 2);

    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.95,
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
   * 智能准星分类识别与遮挡预警检测 (每帧运行)
   */
  private updateSmartReticle(): void {
    if (!this.isGameRunning) return;

    const activeCam = this.getActiveCamera();
    this.raycaster.setFromCamera(this.centerNdc, activeCam);

    const obsHit = this.environmentManager.checkObstacleIntersection(this.raycaster);
    const entHit = this.entityManager.checkRayIntersection(this.raycaster);
    const cfg = this.weaponManager.getCurrentConfig();

    let isCoverBlocking = false;
    if (obsHit && !cfg.penetratesCover) {
      if (!entHit) {
        isCoverBlocking = true;
      } else {
        activeCam.getWorldPosition(this.tempCamPos);
        const distToEntity = this.tempCamPos.distanceTo(entHit.position);
        if (obsHit.distance < distToEntity) {
          isCoverBlocking = true;
        }
      }
    }

    if (isCoverBlocking) {
      // 准星被岩石或树木遮挡
      this.crosshairEl.classList.add('blocked');
      this.crosshairEl.classList.remove('locked', 'friendly-warning');
      this.blockedBadgeEl.classList.remove('hidden');
      this.friendlyBadgeEl.classList.add('hidden');
      this.lockHintEl.classList.add('hidden');
      this.scopeTargetTextEl.textContent = 'TARGET: BLOCKED BY COVER';
      return;
    }

    this.crosshairEl.classList.remove('blocked');
    this.blockedBadgeEl.classList.add('hidden');

    if (entHit) {
      if (entHit.isFriendly) {
        // 准星对准友军禁射目标 (黄绿警告态 + ⚠️ 友军禁射)
        this.crosshairEl.classList.add('friendly-warning');
        this.crosshairEl.classList.remove('locked');
        this.friendlyBadgeEl.classList.remove('hidden');
        this.lockHintEl.classList.add('hidden');
        this.scopeTargetTextEl.textContent = 'WARNING: FRIENDLY TARGET';
      } else {
        // 准星锁定目标猎物 (红色放大态 + LOCKED)
        this.crosshairEl.classList.add('locked');
        this.crosshairEl.classList.remove('friendly-warning');
        this.lockHintEl.classList.remove('hidden');
        this.friendlyBadgeEl.classList.add('hidden');
        this.scopeTargetTextEl.textContent = 'TARGET: LOCKED & READY';

        if (this.currentlyLockedEntity !== entHit) {
          this.currentlyLockedEntity = entHit;
          this.audioManager.playLockSound();
        }
      }
    } else {
      // 准星无目标
      this.crosshairEl.classList.remove('locked', 'friendly-warning');
      this.lockHintEl.classList.add('hidden');
      this.friendlyBadgeEl.classList.add('hidden');
      this.scopeTargetTextEl.textContent = 'TARGET: ACQUIRING';
      this.currentlyLockedEntity = null;
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
    this.targetsValEl.textContent = this.entityManager.getAliveTargetCount().toString();
  }

  private handleResize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();

    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  /**
   * 游戏渲染主循环 (60FPS)
   */
  private animate(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const activeCam = this.getActiveCamera();

    // 1. 传感器姿态更新
    if (!this.webxrManager.getIsActive()) {
      this.gyroController.update(delta);
    }

    // 2. 歪头探身机制 (Roll-to-Peek & Slider)
    // 结合陀螺仪横滚角与 UI 滑块进行视差偏移
    const rollAngle = this.gyroController.getRollAngle();
    // 横滚角度映射至 [-1.8m, +1.8m]
    const rollPeek = Math.max(-1.8, Math.min(1.8, (rollAngle / 25) * 1.8));
    const combinedPeek = Math.max(-2.2, Math.min(2.2, this.sliderPeekOffset + rollPeek));
    this.environmentManager.setPeekOffset(combinedPeek);
    this.environmentManager.update(delta, this.camera);
    this.peekValTextEl.textContent = `${this.environmentManager.getPeekOffset().toFixed(1)}m`;

    // 3. 虚拟摇杆空间位移推进
    if (this.virtualJoystick.getIsVisible() && this.isGameRunning) {
      this.virtualJoystick.applyMovement(this.playerRig, activeCam, delta, 4.0);
    }

    // 强制同步世界矩阵
    this.scene.updateMatrixWorld(true);

    // 4. 生态实体 AI 移动与更新
    this.entityManager.update(delta, activeCam);

    // 5. 3D 枪模呼吸摆动与后坐力回弹 / 战机座舱姿态
    this.weaponManager.update(delta);
    this.cockpitManager.update(delta, this.virtualJoystick.getOutputVector());

    // 6. 激光弹道生命期
    this.updateLasers(delta);

    // 7. 智能准星分类识别
    this.updateSmartReticle();

    // 8. 屏外边缘指示箭头 (仅针对敌对猎物目标，友善动物不显箭头)
    if (this.isGameRunning) {
      const activeTargets = this.entityManager.getActiveTargets().map((e) => ({
        id: e.id,
        isDying: e.isDying,
        currentPosition: e.position,
      }));
      this.indicatorManager.update(activeCam, activeTargets);
    }

    // 9. 画面透明渲染
    this.renderer.render(this.scene, this.camera);
  }
}

// 启动游戏实例
window.addEventListener('DOMContentLoaded', () => {
  new ArShooterGame();
});
