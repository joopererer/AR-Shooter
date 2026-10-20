/**
 * AR 空间射手 - 主游戏控制器 (main.ts)
 * 整合 V3.0 二级游戏大厅 (Game Hub)、FC 经典打鸭子 (Duck Hunt 1984 1:1复刻)、
 * 360° 全景射击沙盒、体感切枪、歪头探身与 WebXR 空间位移推进。
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
import { ModeManager, GameMode } from './modeManager';
import { CockpitManager } from './cockpit';
import { DuckHuntEngine, DuckHuntHUDState } from './duckHunt';
import { WildGunmanEngine, GunmanHUDState } from './wildGunman';

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
  private duckHuntEngine: DuckHuntEngine;

  // 控制模式与状态
  private locomotionMode: LocomotionMode = 'joystick';
  private score: number = 0;
  private isGameRunning: boolean = false;
  private currentlyLockedEntity: GameEntity | null = null;
  private sliderPeekOffset: number = 0;

  // 激光光束网格
  private laserGroup = new THREE.Group();
  private activeLasers: { mesh: THREE.Mesh; life: number; maxLife: number }[] = [];

  // DOM 节点引用 - 核心顶栏与 360 HUD
  private hubBtnEl: HTMLElement;
  private scoreValEl: HTMLElement;
  private targetsValEl: HTMLElement;
  private statusBadgeEl: HTMLElement;
  private sensorModeEl: HTMLElement | null;
  private gameModeBtnEl: HTMLElement;
  private gameModeIconEl: HTMLElement;
  private gameModeTextEl: HTMLElement;
  private modeSwitchBtnEl: HTMLElement | null;
  private modePillIconEl: HTMLElement | null;
  private modePillTextEl: HTMLElement | null;
  private modernScoreCardEl: HTMLElement | null;
  private modernCenterStatusEl: HTMLElement | null;
  private modernTargetsCardEl: HTMLElement | null;
  private modernStatsWrapperEl: HTMLElement | null;

  // 顶栏实时健康与护盾监控 DOM
  private fenceHpContainerEl: HTMLElement | null;
  private fenceHpFillEl: HTMLElement | null;
  private fenceHpTextEl: HTMLElement | null;
  private shieldHpContainerEl: HTMLElement | null;
  private shieldHpFillEl: HTMLElement | null;
  private shieldHpTextEl: HTMLElement | null;
  private generalStatusBoxEl: HTMLElement | null;

  // 耐久与护盾数值
  private fenceHealth: number = 100;
  private shieldHealth: number = 100;

  // 全屏控制
  private fullscreenBtnEl: HTMLElement | null;
  private fullscreenIconEl: HTMLElement | null;
  private fullscreenTextEl: HTMLElement | null;
  private hubFullscreenBtnEl: HTMLElement | null;

  // 幽灵猎手受击四向红光指示
  private dmgGlowTopEl: HTMLElement | null;
  private dmgGlowBottomEl: HTMLElement | null;
  private dmgGlowLeftEl: HTMLElement | null;
  private dmgGlowRightEl: HTMLElement | null;

  // 星际战术雷达与来袭锁定预警
  private scifiRadarHudEl: HTMLElement | null;
  private radarPlayerShipEl: HTMLElement | null;
  private radarBlipsContainerEl: HTMLElement | null;
  private radarAlertTagEl: HTMLElement | null;
  private incomingPlasmaWarningEl: HTMLElement | null;
  private lastIncomingAlarmTime: number = 0;
  private dodgedProjectiles = new Set<string>();

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

  // 360 度特有控制部件
  private peekControllerEl: HTMLElement;
  private peekLeftBtnEl: HTMLElement;
  private peekCenterBtnEl: HTMLElement;
  private peekRightBtnEl: HTMLElement;
  private peekSliderEl: HTMLInputElement;
  private peekValTextEl: HTMLElement;
  private weaponDockEl: HTMLElement;
  private weaponBtnEls: NodeListOf<HTMLButtonElement>;
  private sniperScopeEl: HTMLElement;
  private scopeTargetTextEl: HTMLElement;
  private friendlyFlashEl: HTMLElement;
  private cameraBgEl: HTMLElement;

  // 二级游戏大厅 DOM
  private gameHubModalEl: HTMLElement;
  private hubCloseBtnEl: HTMLElement;
  private hubLaunchBtnEls: NodeListOf<HTMLButtonElement>;

  // NES 复古打鸭子 HUD 与弹窗 DOM
  private nesHudEl: HTMLElement;
  private nesRoundValEl: HTMLElement;
  private nesShotIconsEl: HTMLElement;
  private nesHitSlotsEl: HTMLElement;
  private nesPassMarkerEl: HTMLElement;
  private nesScoreValEl: HTMLElement;
  private flyAwayBannerEl: HTMLElement;
  private crtFlashEl: HTMLElement;
  private nesGameoverModalEl: HTMLElement;
  private nesModalTitleEl: HTMLElement;
  private nesFinalScoreEl: HTMLElement;
  private nesFinalRoundEl: HTMLElement;
  private nesFinalBestEl: HTMLElement;
  private nesRetryBtnEl: HTMLElement;
  private nesHubReturnBtnEl: HTMLElement;

  // 荒野大镖客专属 HUD 与特效 DOM
  private wildGunmanEngine: WildGunmanEngine;
  private gunmanHudEl: HTMLElement;
  private gunmanEnemyValEl: HTMLElement;
  private gunmanPlayerValEl: HTMLElement;
  private gunmanLivesIconsEl: HTMLElement;
  private gunmanScoreValEl: HTMLElement;
  private gunmanFireBannerEl: HTMLElement;
  private gunmanFoulBannerEl: HTMLElement;
  private gunmanShatterOverlayEl: HTMLElement;
  private hubHiGunmanEl: HTMLElement | null = null;

  constructor() {
    // 1. 获取核心 HUD DOM 节点
    this.hubBtnEl = document.getElementById('hub-btn')!;
    this.scoreValEl = document.getElementById('score-val')!;
    this.targetsValEl = document.getElementById('targets-val')!;
    this.statusBadgeEl = document.getElementById('status-badge')!;
    this.sensorModeEl = document.getElementById('sensor-mode');
    this.gameModeBtnEl = document.getElementById('game-mode-btn')!;
    this.gameModeIconEl = document.getElementById('game-mode-icon')!;
    this.gameModeTextEl = document.getElementById('game-mode-text')!;
    this.modeSwitchBtnEl = document.getElementById('mode-switch-btn');
    this.modePillIconEl = document.getElementById('mode-pill-icon');
    this.modePillTextEl = document.getElementById('mode-pill-text');
    this.modernScoreCardEl = document.getElementById('modern-score-card');
    this.modernCenterStatusEl = document.getElementById('modern-center-status');
    this.modernTargetsCardEl = document.getElementById('modern-targets-card');
    this.modernStatsWrapperEl = document.getElementById('modern-stats-wrapper');

    this.fenceHpContainerEl = document.getElementById('fence-hp-bar-container');
    this.fenceHpFillEl = document.getElementById('fence-hp-fill');
    this.fenceHpTextEl = document.getElementById('fence-hp-text');
    this.shieldHpContainerEl = document.getElementById('shield-hp-bar-container');
    this.shieldHpFillEl = document.getElementById('shield-hp-fill');
    this.shieldHpTextEl = document.getElementById('shield-hp-text');
    this.generalStatusBoxEl = document.getElementById('general-status-box');

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

    // 360 度特有控制部件
    this.peekControllerEl = document.getElementById('peek-controller')!;
    this.peekLeftBtnEl = document.getElementById('peek-left-btn')!;
    this.peekCenterBtnEl = document.getElementById('peek-center-btn')!;
    this.peekRightBtnEl = document.getElementById('peek-right-btn')!;
    this.peekSliderEl = document.getElementById('peek-slider') as HTMLInputElement;
    this.peekValTextEl = document.getElementById('peek-val-text')!;
    this.weaponDockEl = document.getElementById('weapon-dock')!;
    this.weaponBtnEls = document.querySelectorAll('.weapon-btn');
    this.sniperScopeEl = document.getElementById('sniper-scope-overlay')!;
    this.scopeTargetTextEl = document.getElementById('scope-target-text')!;
    this.friendlyFlashEl = document.getElementById('friendly-flash-overlay')!;
    this.cameraBgEl = document.getElementById('camera-bg')!;

    // 二级游戏大厅 DOM
    this.gameHubModalEl = document.getElementById('game-hub-modal')!;
    this.hubCloseBtnEl = document.getElementById('hub-close-btn')!;
    this.hubLaunchBtnEls = document.querySelectorAll('.hub-launch-btn');

    // NES 打鸭子 HUD DOM
    this.nesHudEl = document.getElementById('nes-hud')!;
    this.nesRoundValEl = document.getElementById('nes-round-val')!;
    this.nesShotIconsEl = document.getElementById('nes-shot-icons')!;
    this.nesHitSlotsEl = document.getElementById('nes-hit-slots')!;
    this.nesPassMarkerEl = document.getElementById('nes-pass-marker')!;
    this.nesScoreValEl = document.getElementById('nes-score-val')!;
    this.flyAwayBannerEl = document.getElementById('fly-away-banner')!;
    this.crtFlashEl = document.getElementById('crt-flash-overlay')!;
    this.nesGameoverModalEl = document.getElementById('nes-gameover-modal')!;
    this.nesModalTitleEl = document.getElementById('nes-modal-title')!;
    this.nesFinalScoreEl = document.getElementById('nes-final-score')!;
    this.nesFinalRoundEl = document.getElementById('nes-final-round')!;
    this.nesFinalBestEl = document.getElementById('nes-final-best')!;
    this.nesRetryBtnEl = document.getElementById('nes-retry-btn')!;
    this.nesHubReturnBtnEl = document.getElementById('nes-hub-return-btn')!;

    // 荒野大镖客专属 HUD 与特效 DOM 绑定
    this.gunmanHudEl = document.getElementById('gunman-hud')!;
    this.gunmanEnemyValEl = document.getElementById('gunman-enemy-val')!;
    this.gunmanPlayerValEl = document.getElementById('gunman-player-val')!;
    this.gunmanLivesIconsEl = document.getElementById('gunman-lives-icons')!;
    this.gunmanScoreValEl = document.getElementById('gunman-score-val')!;
    this.gunmanFireBannerEl = document.getElementById('gunman-fire-banner')!;
    this.gunmanFoulBannerEl = document.getElementById('gunman-foul-banner')!;
    this.gunmanShatterOverlayEl = document.getElementById('gunman-shatter-overlay')!;
    this.hubHiGunmanEl = document.getElementById('hub-hi-gunman');

    // 全屏按钮与方向受击指示绑定
    this.fullscreenBtnEl = document.getElementById('fullscreen-btn');
    this.fullscreenIconEl = document.getElementById('fullscreen-icon');
    this.fullscreenTextEl = document.getElementById('fullscreen-text');
    this.hubFullscreenBtnEl = document.getElementById('hub-fullscreen-btn');
    this.dmgGlowTopEl = document.getElementById('dmg-glow-top');
    this.dmgGlowBottomEl = document.getElementById('dmg-glow-bottom');
    this.dmgGlowLeftEl = document.getElementById('dmg-glow-left');
    this.dmgGlowRightEl = document.getElementById('dmg-glow-right');

    // 星际战术雷达与来袭锁定预警绑定
    this.scifiRadarHudEl = document.getElementById('scifi-tactical-radar');
    this.radarPlayerShipEl = document.getElementById('radar-player-ship');
    this.radarBlipsContainerEl = document.getElementById('radar-blips-container');
    this.radarAlertTagEl = document.getElementById('radar-alert-tag');
    this.incomingPlasmaWarningEl = document.getElementById('incoming-plasma-warning');

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
      () => this.audioManager.playEnemyLaserFire(),
      (dmg, pos) => this.handleFenceDamaged(dmg, pos)
    );
    this.weaponManager = new WeaponManager(this.camera, (cfg) => this.onWeaponSwitched(cfg));
    this.cockpitManager = new CockpitManager(this.camera);
    this.modeManager = new ModeManager('hunting');

    // 初始化 FC 经典打鸭子引擎
    this.duckHuntEngine = new DuckHuntEngine(this.scene, this.camera, this.audioManager, {
      onHUDUpdate: (s) => this.updateNesHUD(s),
      onGameOver: (sc, r) => this.handleDuckHuntGameOver(sc, r),
      onRoundClear: (r, b) => this.handleDuckHuntRoundClear(r, b),
    });

    // 初始化 FC 经典荒野大镖客引擎
    this.wildGunmanEngine = new WildGunmanEngine(this.scene, this.camera, this.audioManager, {
      onHUDUpdate: (s) => this.updateGunmanHUD(s),
      onGameOver: (sc, r) => this.handleGunmanGameOver(sc, r),
      onRoundClear: (r, b) => this.handleGunmanRoundClear(r, b),
    });

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

    // 7. 绑定所有 UI 与体感控制事件
    this.bindEvents();
    this.checkSecurityContext();

    // 8. 启动渲染主循环
    this.animate = this.animate.bind(this);
    this.renderer.setAnimationLoop(this.animate);
  }

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

    // 授权并开启游戏大厅
    this.startBtnEl.addEventListener('click', () => this.handleGameStart());

    // 🏠 打开游戏大厅按钮
    this.hubBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openGameHub();
    });

    // ✕ 关闭游戏大厅按钮
    this.hubCloseBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeGameHub();
    });

    // 大厅所有模式卡片启动按钮 (360全景与复古光枪)
    this.hubLaunchBtnEls.forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const mode = btn.dataset.mode as GameMode;
        if (mode) this.launchMode(mode);
      });
    });

    // 监听横向滑动更新轮播圆点指示器
    this.setupCarouselTrack('track-360', 'dots-360');
    this.setupCarouselTrack('track-retro', 'dots-retro');

    // NES Game Over 重玩与返回大厅
    this.nesRetryBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nesGameoverModalEl.classList.add('hidden');
      this.launchMode(this.modeManager.getMode());
    });

    this.nesHubReturnBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.nesGameoverModalEl.classList.add('hidden');
      this.openGameHub();
    });

    // 开火按钮多事件全兼容监听 (Pointer, Touch, Click 全响应 + 60ms 极速防抖)
    let lastFireTrigger = 0;
    const onFireButtonAction = (e: Event) => {
      e.stopPropagation();
      if (e.cancelable && e.type === 'touchstart') {
        e.preventDefault();
      }
      const now = performance.now();
      if (now - lastFireTrigger < 60) return;
      lastFireTrigger = now;
      this.triggerFire();
    };

    this.fireBtnEl.addEventListener('pointerdown', onFireButtonAction);
    this.fireBtnEl.addEventListener('touchstart', onFireButtonAction, { passive: false });
    this.fireBtnEl.addEventListener('click', onFireButtonAction);

    // 屏幕触摸/点击快速开火 (避开 HUD 控制区)
    window.addEventListener('pointerdown', (e) => {
      if (!this.isGameRunning) return;
      const target = e.target as HTMLElement;
      if (
        target.closest('button') ||
        target.closest('#top-bar') ||
        target.closest('#joystick-zone') ||
        target.closest('#peek-controller') ||
        target.closest('#weapon-dock') ||
        target.closest('.modal-overlay')
      ) {
        return;
      }
      this.triggerFire();
    });

    // 游戏模式切换 (荒野狩猎 / 星际防卫 / 幽灵猎手)
    this.gameModeBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openGameHub();
    });

    // 空间位移模式切换 (摇杆推进 / WebXR 空间走动)
    this.modeSwitchBtnEl?.addEventListener('click', (e) => {
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

    // 全屏沉浸模式切换 (隐藏移动浏览器地址栏与导航条)
    const handleToggleFullscreen = (e: Event) => {
      e.stopPropagation();
      this.toggleFullscreen();
    };
    this.fullscreenBtnEl?.addEventListener('click', handleToggleFullscreen);
    this.hubFullscreenBtnEl?.addEventListener('click', handleToggleFullscreen);

    document.addEventListener('fullscreenchange', () => this.updateFullscreenUI());
    document.addEventListener('webkitfullscreenchange', () => this.updateFullscreenUI());

    // 歪头探身控制器 (Peek Buttons & Slider / 星际模式下为战术滚转侧闪)
    this.peekLeftBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.modeManager.getMode() === 'scifi') {
        this.triggerTacticalDodge(-2.2);
      } else {
        this.setPeekOffsetDirect(-1.8);
      }
    });
    this.peekCenterBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setPeekOffsetDirect(0);
    });
    this.peekRightBtnEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this.modeManager.getMode() === 'scifi') {
        this.triggerTacticalDodge(2.2);
      } else {
        this.setPeekOffsetDirect(1.8);
      }
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

  // ==========================================================================
  // 模式启动与二级大厅管理
  // ==========================================================================

  public openGameHub(): void {
    this.refreshHubHighScores();
    this.gameHubModalEl.classList.remove('hidden');
  }

  public closeGameHub(): void {
    this.gameHubModalEl.classList.add('hidden');
  }

  private setupCarouselTrack(trackId: string, dotsId: string): void {
    const track = document.getElementById(trackId);
    const dotsContainer = document.getElementById(dotsId);
    if (!track || !dotsContainer) return;

    const dots = dotsContainer.querySelectorAll('.dot');
    track.addEventListener('scroll', () => {
      const cardWidth = track.clientWidth * 0.76;
      const index = Math.min(dots.length - 1, Math.max(0, Math.round(track.scrollLeft / cardWidth)));
      dots.forEach((dot, idx) => {
        if (idx === index) dot.classList.add('active');
        else dot.classList.remove('active');
      });
    }, { passive: true });
  }

  private refreshHubHighScores(): void {
    const huntingHi = this.modeManager.getHighScore('hunting');
    const scifiHi = this.modeManager.getHighScore('scifi');
    const ghostHi = this.modeManager.getHighScore('ghost');
    const duckAHi = this.modeManager.getHighScore('duckhunt_a');
    const duckBHi = this.modeManager.getHighScore('duckhunt_b');
    const duckCHi = this.modeManager.getHighScore('duckhunt_c');
    const gunmanHi = Math.max(
      this.modeManager.getHighScore('gunman_a'),
      this.modeManager.getHighScore('gunman_b'),
      this.modeManager.getHighScore('gunman_c')
    );

    const elH = document.getElementById('hub-hi-hunting');
    if (elH) elH.textContent = huntingHi.toString();
    const elS = document.getElementById('hub-hi-scifi');
    if (elS) elS.textContent = scifiHi.toString();
    const elG = document.getElementById('hub-hi-ghost');
    if (elG) elG.textContent = ghostHi.toString();
    const elDA = document.getElementById('hub-hi-duckhunt-a');
    if (elDA) elDA.textContent = duckAHi.toString().padStart(6, '0');
    const elDB = document.getElementById('hub-hi-duckhunt-b');
    if (elDB) elDB.textContent = duckBHi.toString().padStart(6, '0');
    const elDC = document.getElementById('hub-hi-duckhunt-c');
    if (elDC) elDC.textContent = duckCHi.toString().padStart(6, '0');
    if (this.hubHiGunmanEl) {
      this.hubHiGunmanEl.textContent = gunmanHi.toString().padStart(6, '0');
    }
  }

  public launchMode(mode: GameMode): void {
    this.closeGameHub();
    this.nesGameoverModalEl.classList.add('hidden');
    this.isGameRunning = true;
    this.modeManager.setMode(mode);
    const cfg = this.modeManager.getModeConfig(mode);

    this.gameModeIconEl.textContent = cfg.icon;
    this.gameModeTextEl.textContent = cfg.shortName;

    if (cfg.isRetroLightGun) {
      // 1. 彻底清空 360 沙盒环境与生态实体
      this.environmentManager.clearEnvironment();
      this.entityManager.clearAll();
      this.cockpitManager.setVisible(false);
      this.weaponManager.setVisible(false);

      // 2. 隐藏 360 度独有 HUD 与控制部件
      this.modernStatsWrapperEl?.classList.add('hidden');
      this.modernScoreCardEl?.classList.add('hidden');
      this.modernCenterStatusEl?.classList.add('hidden');
      this.modernTargetsCardEl?.classList.add('hidden');
      this.fenceHpContainerEl?.classList.add('hidden');
      this.shieldHpContainerEl?.classList.add('hidden');
      this.generalStatusBoxEl?.classList.add('hidden');
      this.peekControllerEl.classList.add('hidden');
      this.weaponDockEl.classList.add('hidden');
      this.virtualJoystick.setVisible(false);
      this.indicatorManager.clear();
      this.crosshairEl.classList.remove('locked', 'friendly-warning', 'blocked');
      this.lockHintEl.classList.add('hidden');
      this.friendlyBadgeEl.classList.add('hidden');
      this.blockedBadgeEl.classList.add('hidden');

      if (mode.startsWith('gunman_')) {
        // 激活荒野大镖客专属模式
        document.body.classList.add('gunman-active');
        document.body.classList.remove('duckhunt-active');

        this.duckHuntEngine.clear();
        this.nesHudEl.classList.add('hidden');
        this.flyAwayBannerEl.classList.add('hidden');

        this.gunmanHudEl.classList.remove('hidden');
        this.wildGunmanEngine.start(cfg.gunmanSubmode!);
        this.showStatusNotification(`进入【${cfg.shortName}】`);
      } else {
        // 激活 FC 打鸭子模式
        document.body.classList.add('duckhunt-active');
        document.body.classList.remove('gunman-active');

        this.wildGunmanEngine.clear();
        this.gunmanHudEl.classList.add('hidden');
        this.gunmanFireBannerEl.classList.add('hidden');
        this.gunmanFoulBannerEl.classList.add('hidden');
        this.gunmanShatterOverlayEl.classList.add('hidden');

        this.nesHudEl.classList.remove('hidden');
        this.duckHuntEngine.start(cfg.duckHuntSubmode!);
        this.showStatusNotification(`进入【${cfg.shortName}】`);
      }
    } else {
      document.body.classList.remove('duckhunt-active', 'gunman-active');

      // 1. 彻底清空复古光枪舞台
      this.duckHuntEngine.clear();
      this.wildGunmanEngine.clear();
      this.nesHudEl.classList.add('hidden');
      this.flyAwayBannerEl.classList.add('hidden');
      this.gunmanHudEl.classList.add('hidden');
      this.gunmanFireBannerEl.classList.add('hidden');
      this.gunmanFoulBannerEl.classList.add('hidden');
      this.gunmanShatterOverlayEl.classList.add('hidden');

      // 2. 恢复 360 度沙盒 HUD 与控制部件
      this.modernStatsWrapperEl?.classList.remove('hidden');
      this.modernScoreCardEl?.classList.remove('hidden');
      this.modernCenterStatusEl?.classList.remove('hidden');
      this.modernTargetsCardEl?.classList.remove('hidden');
      this.peekControllerEl.classList.remove('hidden');
      this.weaponDockEl.classList.remove('hidden');
      this.virtualJoystick.setVisible(true);

      // 3. 构建 360 度对应生态
      this.applyCurrentModeContent(mode);
    }
  }

  private applyCurrentModeContent(mode: GameMode): void {
    this.entityManager.setMode(mode);
    this.fenceHealth = 100;
    this.shieldHealth = 100;
    if (this.fenceHpFillEl) {
      this.fenceHpFillEl.style.width = '100%';
      this.fenceHpFillEl.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
    }
    if (this.fenceHpTextEl) this.fenceHpTextEl.textContent = '100%';
    if (this.shieldHpFillEl) {
      this.shieldHpFillEl.style.width = '100%';
      this.shieldHpFillEl.style.background = 'linear-gradient(90deg, #00f3ff, #3b82f6)';
    }
    if (this.shieldHpTextEl) this.shieldHpTextEl.textContent = '100%';

    if (mode === 'hunting') {
      this.environmentManager.initHuntingEnvironment();
      this.entityManager.initHuntingEcosystem();
      this.cockpitManager.setVisible(false);
      this.weaponManager.setVisible(true);

      this.generalStatusBoxEl?.classList.remove('hidden');
      this.fenceHpContainerEl?.classList.add('hidden');
      this.shieldHpContainerEl?.classList.add('hidden');
      this.scifiRadarHudEl?.classList.add('hidden');
      this.incomingPlasmaWarningEl?.classList.add('hidden');

      const pTitle = document.querySelector('.peek-title');
      if (pTitle) pTitle.textContent = '◀ 闪身探头 ▶';
      this.peekLeftBtnEl.textContent = '◀ 左探';
      this.peekCenterBtnEl.textContent = '回正';
      this.peekRightBtnEl.textContent = '右探 ▶';

      this.virtualJoystick.setVisible(true);
      this.peekControllerEl.classList.remove('hidden');
    } else if (mode === 'scifi') {
      this.environmentManager.initSciFiEnvironment();
      this.entityManager.initSciFiEcosystem();
      this.cockpitManager.setVisible(true);
      this.weaponManager.setVisible(false);

      this.generalStatusBoxEl?.classList.add('hidden');
      this.fenceHpContainerEl?.classList.add('hidden');
      this.shieldHpContainerEl?.classList.remove('hidden');
      this.scifiRadarHudEl?.classList.remove('hidden');

      // 星际防卫模式将闪身控制升级为【战术滚转侧闪】
      const pTitle = document.querySelector('.peek-title');
      if (pTitle) pTitle.textContent = '◀ 战术滚转侧闪 ▶';
      this.peekLeftBtnEl.textContent = '◀ 滚转左闪';
      this.peekCenterBtnEl.textContent = '回中';
      this.peekRightBtnEl.textContent = '滚转右闪 ▶';

      this.virtualJoystick.setVisible(true);
      this.peekControllerEl.classList.remove('hidden');
    } else if (mode === 'ghost') {
      this.environmentManager.initHalloweenEnvironment();
      this.entityManager.initGhostEcosystem();
      this.cockpitManager.setVisible(false);
      this.weaponManager.setVisible(true);

      // 幽灵猎手：圆形铁围栏防守战
      this.generalStatusBoxEl?.classList.add('hidden');
      this.fenceHpContainerEl?.classList.remove('hidden');
      this.shieldHpContainerEl?.classList.add('hidden');
      this.scifiRadarHudEl?.classList.add('hidden');
      this.incomingPlasmaWarningEl?.classList.add('hidden');

      // 玩家被限制在圆形铁围栏内：不能前进，只能 360 度旋转射击
      this.virtualJoystick.setVisible(false);
      this.peekControllerEl.classList.add('hidden');
      this.playerRig.position.set(0, 0, 0);
    }
    this.updateTargetCountUI();
  }

  // ==========================================================================
  // NES 打鸭子 HUD 同步与结算回调
  // ==========================================================================

  private updateNesHUD(state: DuckHuntHUDState): void {
    // 1. R = X
    this.nesRoundValEl.textContent = state.round.toString();

    // 2. SHOT 3 颗子弹
    const bullets = this.nesShotIconsEl.querySelectorAll('.nes-bullet');
    bullets.forEach((b, idx) => {
      if (idx < state.shotsLeft) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });

    // 3. HIT 10 个格子
    this.nesHitSlotsEl.innerHTML = '';
    state.targetResults.forEach((res) => {
      const slot = document.createElement('div');
      slot.className = `nes-target-slot ${res}`;
      this.nesHitSlotsEl.appendChild(slot);
    });

    // Pass Line 刻度线位置
    this.nesPassMarkerEl.style.left = `${(state.passLine / 10) * 100}%`;

    // 4. SCORE 6 位数字
    this.nesScoreValEl.textContent = state.currentScore.toString().padStart(6, '0');

    // 5. FLY AWAY 警报横幅
    if (state.isFlyAway) {
      this.flyAwayBannerEl.classList.remove('hidden');
    } else {
      this.flyAwayBannerEl.classList.add('hidden');
    }

    // 实时更新最高分
    this.modeManager.updateHighScore(this.modeManager.getMode(), state.currentScore);
  }

  private handleDuckHuntGameOver(finalScore: number, roundReached: number): void {
    this.modeManager.updateHighScore(this.modeManager.getMode(), finalScore);
    const bestScore = this.modeManager.getHighScore(this.modeManager.getMode());

    this.nesModalTitleEl.textContent = 'GAME OVER';
    this.nesFinalScoreEl.textContent = finalScore.toString().padStart(6, '0');
    this.nesFinalRoundEl.textContent = roundReached.toString();
    this.nesFinalBestEl.textContent = bestScore.toString().padStart(6, '0');
    this.nesGameoverModalEl.classList.remove('hidden');
  }

  private handleDuckHuntRoundClear(round: number, bonus: number): void {
    this.showHitPopup(`ROUND ${round} PERFECT!! +${bonus}`, false, 'duck-perfect-popup');
  }

  // ==========================================================================
  // 荒野大镖客 (Wild Gunman) HUD 同步与结算回调
  // ==========================================================================

  private updateGunmanHUD(state: GunmanHUDState): void {
    if (this.gunmanEnemyValEl) {
      this.gunmanEnemyValEl.textContent = `${state.enemyTime.toFixed(2)}s`;
    }
    if (this.gunmanPlayerValEl) {
      this.gunmanPlayerValEl.textContent =
        state.playerTime !== null ? `${state.playerTime.toFixed(2)}s` : '--.--s';
    }

    if (this.gunmanLivesIconsEl) {
      const hats = this.gunmanLivesIconsEl.querySelectorAll('.gunman-hat-icon');
      hats.forEach((h, idx) => {
        if (idx < state.lives) {
          h.classList.remove('lost');
        } else {
          h.classList.add('lost');
        }
      });
    }

    if (this.gunmanScoreValEl) {
      this.gunmanScoreValEl.textContent = state.score.toString().padStart(6, '0');
    }

    // 状态横幅与全屏特效
    if (state.fireBanner) {
      this.gunmanFireBannerEl?.classList.remove('hidden');
    } else {
      this.gunmanFireBannerEl?.classList.add('hidden');
    }

    if (state.foulBanner) {
      this.gunmanFoulBannerEl?.classList.remove('hidden');
    } else {
      this.gunmanFoulBannerEl?.classList.add('hidden');
    }

    if (state.brokenScreen) {
      this.gunmanShatterOverlayEl?.classList.remove('hidden');
    } else {
      this.gunmanShatterOverlayEl?.classList.add('hidden');
    }

    this.modeManager.updateHighScore(this.modeManager.getMode(), state.score);
  }

  private handleGunmanGameOver(finalScore: number, roundReached: number): void {
    const mode = this.modeManager.getMode();
    this.modeManager.updateHighScore(mode, finalScore);
    const bestScore = this.modeManager.getHighScore(mode);

    this.nesModalTitleEl.textContent = 'YOU LOST!';
    this.nesFinalScoreEl.textContent = finalScore.toString().padStart(6, '0');
    this.nesFinalRoundEl.textContent = roundReached.toString();
    this.nesFinalBestEl.textContent = bestScore.toString().padStart(6, '0');
    this.nesGameoverModalEl.classList.remove('hidden');
  }

  private handleGunmanRoundClear(round: number, bonus: number): void {
    this.showHitPopup(`ROUND ${round} DRAW WINNER!! +${bonus}`, false, 'duck-perfect-popup');
  }

  // ==========================================================================
  // 开火射击逻辑
  // ==========================================================================

  private triggerFire(): void {
    if (!this.isGameRunning) {
      this.isGameRunning = true;
    }

    // 开火按钮触感后坐力动效 (每次点击必触发，杜绝点击无反应假象)
    this.fireBtnEl.classList.remove('fire-kick');
    void this.fireBtnEl.offsetWidth;
    this.fireBtnEl.classList.add('fire-kick');
    setTimeout(() => this.fireBtnEl.classList.remove('fire-kick'), 120);

    const cfg = this.modeManager.getModeConfig();
    const activeCam = this.getActiveCamera();
    activeCam.getWorldPosition(this.tempCamPos);

    if (cfg.isRetroLightGun) {
      this.raycaster.setFromCamera(this.centerNdc, activeCam);

      // 荒野大镖客专属开火判定
      if (this.modeManager.getMode().startsWith('gunman_')) {
        const res = this.wildGunmanEngine.shoot(this.raycaster);
        if (res.fired) {
          if (res.reason === 'foul') {
            this.showHitPopup('⚠️ FOUL!! 提前抢跑犯规！', true, 'blocked-hint');
          } else {
            this.crtFlashEl.classList.remove('hidden');
            setTimeout(() => this.crtFlashEl.classList.add('hidden'), 50);
            if (navigator.vibrate) navigator.vibrate(45);
          }
        }
        return;
      }

      // 打鸭子开火判定
      const res = this.duckHuntEngine.shoot(this.raycaster);

      if (res.fired) {
        // 1. 光线枪 CRT 50ms 白屏瞬间闪烁
        this.crtFlashEl.classList.remove('hidden');
        setTimeout(() => this.crtFlashEl.classList.add('hidden'), 50);

        if (navigator.vibrate) navigator.vibrate(40);
      } else {
        // 空弹或未到射击时机的明确声效与文字反馈
        this.audioManager.playDryFire();
        if (res.reason === 'no_ammo') {
          this.showHitPopup('🚫 3发子弹已用尽！', true, 'blocked-hint');
          if (navigator.vibrate) navigator.vibrate([20, 30]);
        } else if (res.reason === 'waiting') {
          this.showHitPopup('⏳ 等待目标就绪...', false, 'blocked-hint');
        }
      }
      return;
    }

    // 360 沙盒多武器射击逻辑
    if (!this.weaponManager.canFire()) {
      this.showHitPopup('⏳ 换弹/冷却中...', true, 'blocked-hint');
      return;
    }

    const currentWeapon = this.weaponManager.getCurrentConfig();

    if (currentWeapon.type === 'rifle') {
      this.audioManager.playRifleShot();
      if (navigator.vibrate) navigator.vibrate([25, 20, 35]);
    } else if (currentWeapon.type === 'shotgun') {
      this.audioManager.playShotgunShot();
      if (navigator.vibrate) navigator.vibrate([40, 30, 60]);
    } else {
      this.audioManager.playSniperShot();
      if (navigator.vibrate) navigator.vibrate([35, 25, 45]);
    }

    const pellets = currentWeapon.pellets;
    const spread = currentWeapon.spread;

    for (let p = 0; p < pellets; p++) {
      const spreadX = (Math.random() - 0.5) * spread;
      const spreadY = (Math.random() - 0.5) * spread;
      const pelletNdc = new THREE.Vector2(spreadX, spreadY);

      this.raycaster.setFromCamera(pelletNdc, activeCam);

      // 1. 检查是否射中敌机等离子子弹 (防守拦截机制)
      const projHit = this.entityManager.checkProjectileIntersection(this.raycaster);
      if (projHit.hit && projHit.point) {
        this.score += 50;
        this.scoreValEl.textContent = this.score.toString();
        this.modeManager.updateHighScore(this.modeManager.getMode(), this.score);
        this.audioManager.playTargetHit(true);
        this.showHitPopup('💥 成功拦截等离子弹！+50', false, 'hit-score');
        this.createLaserBeam(this.tempCamPos, projHit.point, 0x00f3ff);
        continue;
      }

      const obsHit = this.environmentManager.checkObstacleIntersection(this.raycaster);
      const entHit = this.entityManager.checkRayIntersection(this.raycaster);

      let endPoint: THREE.Vector3;
      let bulletBlocked = false;

      if (obsHit && !currentWeapon.penetratesCover) {
        if (!entHit) {
          bulletBlocked = true;
        } else {
          const distToEntity = this.tempCamPos.distanceTo(entHit.position);
          if (obsHit.distance < distToEntity) {
            bulletBlocked = true;
          }
        }
      }

      if (obsHit && obsHit.obstacle && currentWeapon.penetratesCover) {
        const obsRes = this.environmentManager.hitObstacle(obsHit.obstacle, currentWeapon.obstacleDamage, obsHit.point);
        if (obsRes.destroyed) {
          this.audioManager.playObstacleDestroyed(obsRes.obstacle.type);
          this.showHitPopup(`💥 穿甲贯穿！${obsRes.name}被轰碎`, false, 'blocked-hint');
        }
      }

      if (bulletBlocked && obsHit && obsHit.obstacle) {
        endPoint = obsHit.point;
        const obsRes = this.environmentManager.hitObstacle(obsHit.obstacle, currentWeapon.obstacleDamage, obsHit.point);

        if (obsRes.destroyed) {
          this.audioManager.playObstacleDestroyed(obsRes.obstacle.type);
          this.showHitPopup(`💥 ${obsRes.name}崩塌碎裂！`, false, 'blocked-hint');
        } else {
          this.audioManager.playObstacleHit();
          this.showHitPopup(`🛡️ ${obsRes.name}耐久 [${obsRes.remainingHealth}/${obsRes.obstacle.maxHealth}]`, false, 'blocked-hint');
        }
      } else if (entHit) {
        endPoint = entHit.position.clone();
        const hitRes = this.entityManager.hitEntity(entHit, currentWeapon.damage, entHit.position);

        if (hitRes.isFriendly) {
          this.score = Math.max(0, this.score + hitRes.scoreChange);
          this.scoreValEl.textContent = this.score.toString();
          this.audioManager.playFriendlyHurt();
          this.triggerFriendlyWarningFlash();
          this.showHitPopup(`${hitRes.scoreChange} 误伤${hitRes.name}！`, true, 'friendly-penalty');
        } else {
          this.score += hitRes.scoreChange;
          this.scoreValEl.textContent = this.score.toString();
          this.modeManager.updateHighScore(this.modeManager.getMode(), this.score);
          this.audioManager.playTargetHit(hitRes.killed || false);
          this.showHitPopup(`+${hitRes.scoreChange} ${hitRes.name}`, false);
        }
      } else {
        endPoint = this.tempCamPos.clone().add(this.raycaster.ray.direction.clone().multiplyScalar(22));
      }

      const beamColor = currentWeapon.type === 'sniper' ? 0x22d3ee : currentWeapon.type === 'shotgun' ? 0xf59e0b : 0x00f3ff;
      this.createLaserBeam(this.tempCamPos, endPoint, beamColor);
    }

    this.updateTargetCountUI();
  }

  // ==========================================================================
  // 辅助与回调
  // ==========================================================================

  private onWeaponSwitched(cfg: WeaponConfig): void {
    this.weaponBtnEls.forEach((btn) => {
      if (btn.dataset.weapon === cfg.type) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    this.audioManager.playWeaponSwitch();
    this.showStatusNotification(`已装备: ${cfg.name}`);

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

  private handleFenceDamaged(damage: number, attackerPos?: THREE.Vector3): void {
    if (this.modeManager.getMode() !== 'ghost' || !this.isGameRunning) return;
    this.fenceHealth = Math.max(0, this.fenceHealth - damage);
    if (this.fenceHpFillEl) {
      this.fenceHpFillEl.style.width = `${this.fenceHealth}%`;
      if (this.fenceHealth <= 30) {
        this.fenceHpFillEl.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
      } else {
        this.fenceHpFillEl.style.background = 'linear-gradient(90deg, #10b981, #06b6d4)';
      }
    }
    if (this.fenceHpTextEl) {
      this.fenceHpTextEl.textContent = `${this.fenceHealth}%`;
    }

    // 计算攻击者相对于当前相机构成的四向方位 (上=正面, 下=背后, 左=左侧, 右=右侧)
    if (attackerPos) {
      const local = attackerPos.clone().applyMatrix4(this.camera.matrixWorldInverse);
      const angle = Math.atan2(local.x, -local.z); // [-PI, PI]
      if (Math.abs(angle) < Math.PI / 4) {
        this.flashDirectionalDamage('top');
      } else if (angle >= Math.PI / 4 && angle < (3 * Math.PI) / 4) {
        this.flashDirectionalDamage('right');
      } else if (Math.abs(angle) >= (3 * Math.PI) / 4) {
        this.flashDirectionalDamage('bottom');
      } else {
        this.flashDirectionalDamage('left');
      }
    }

    this.environmentManager.flashFenceDamage();
    this.audioManager.playShipShieldHit();
    this.triggerFriendlyWarningFlash();
    this.showHitPopup(`⚠️ 铁围栏遭猛攻 -${damage}% 耐久！`, true, 'friendly-penalty');

    if (this.fenceHealth <= 0) {
      this.handleGameOver('铁围栏已彻底破损，防线失守！');
    }
  }

  /**
   * 触发幽灵猎手护栏受击边缘红光警示
   */
  private flashDirectionalDamage(dir: 'top' | 'bottom' | 'left' | 'right'): void {
    let el: HTMLElement | null = null;
    if (dir === 'top') el = this.dmgGlowTopEl;
    else if (dir === 'bottom') el = this.dmgGlowBottomEl;
    else if (dir === 'left') el = this.dmgGlowLeftEl;
    else if (dir === 'right') el = this.dmgGlowRightEl;

    if (el) {
      el.classList.remove('flash');
      void el.offsetWidth;
      el.classList.add('flash');
      setTimeout(() => el?.classList.remove('flash'), 500);
    }
  }

  /**
   * 星际战机一键战术滚转侧闪推进 (带 0.85s 无敌规避帧 + 自动回正)
   */
  private triggerTacticalDodge(val: number): void {
    this.setPeekOffsetDirect(val);
    this.entityManager.setPlayerInvulnerable(true);
    this.audioManager.playShipThrusterDodge();
    this.showHitPopup(val < 0 ? '◀ 战术左滚转闪避！(无敌)' : '战术右滚转闪避！(无敌) ▶', false, 'hit-score');

    // 0.85s 无敌帧窗口后解除
    setTimeout(() => {
      this.entityManager.setPlayerInvulnerable(false);
    }, 850);

    // 1.2s 后自动平滑回正
    setTimeout(() => {
      if (this.modeManager.getMode() === 'scifi') {
        this.setPeekOffsetDirect(0);
      }
    }, 1200);
  }

  /**
   * 网页全屏沉浸模式切换 (隐藏移动浏览器地址栏)
   */
  private toggleFullscreen(): void {
    const doc = document as any;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (!isFull) {
      const el = document.documentElement as any;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        el.webkitRequestFullscreen();
      }
    } else {
      if (doc.exitFullscreen) {
        doc.exitFullscreen().catch(() => {});
      } else if (doc.webkitExitFullscreen) {
        doc.webkitExitFullscreen();
      }
    }
  }

  private updateFullscreenUI(): void {
    const doc = document as any;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement);
    if (this.fullscreenIconEl) {
      this.fullscreenIconEl.textContent = isFull ? '🗗' : '⛶';
    }
    if (this.fullscreenTextEl) {
      this.fullscreenTextEl.textContent = isFull ? '退出' : '全屏';
    }
    if (this.hubFullscreenBtnEl) {
      this.hubFullscreenBtnEl.textContent = isFull ? '🗗 退出全屏' : '⛶ 全屏模式';
    }
  }

  /**
   * 刷新星际防卫 2D HUD 全息战术雷达与迎面等离子威胁预警
   */
  private updateSciFiTacticalRadar(
    activeCam: THREE.Camera,
    activeTargets: { position: THREE.Vector3; isDying: boolean }[],
    projectiles: { position: THREE.Vector3; velocity: THREE.Vector3; life: number }[]
  ): void {
    if (!this.scifiRadarHudEl) return;

    // 1. 战机小三角标位置随着闪避机动实时左右滑动
    if (this.radarPlayerShipEl) {
      const peek = this.environmentManager.getPeekOffset();
      const px = (peek / 2.2) * 26; // [-26px, 26px]
      this.radarPlayerShipEl.style.transform = `translate(-50%, -50%) translateX(${px.toFixed(1)}px)`;
    }

    // 2. 刷新雷达内光点 (敌机与等离子子弹)
    if (this.radarBlipsContainerEl) {
      let html = '';
      const camMatrixInv = activeCam.matrixWorldInverse;

      activeTargets.forEach((t) => {
        if (t.isDying) return;
        const local = t.position.clone().applyMatrix4(camMatrixInv);
        const rx = 43 + (local.x / 28) * 38;
        const ry = 43 + (local.z / 28) * 38;
        if (rx >= 4 && rx <= 82 && ry >= 4 && ry <= 82) {
          html += `<div class="blip-enemy" style="left:${rx.toFixed(1)}px; top:${ry.toFixed(1)}px;"></div>`;
        }
      });

      let hasIncomingThreat = false;
      const now = performance.now();

      projectiles.forEach((p, idx) => {
        const local = p.position.clone().applyMatrix4(camMatrixInv);
        const rx = 43 + (local.x / 28) * 38;
        const ry = 43 + (local.z / 28) * 38;
        if (rx >= 4 && rx <= 82 && ry >= 4 && ry <= 82) {
          html += `<div class="blip-bullet" style="left:${rx.toFixed(1)}px; top:${ry.toFixed(1)}px;"></div>`;
        }

        // 威胁判定：距离相机 < 14.0m 并且在玩家前方
        const dist = p.position.distanceTo(activeCam.position);
        if (dist < 14.0 && local.z < 0) {
          hasIncomingThreat = true;

          // 极限闪避 (Near Miss)：子弹在 0.65m ~ 1.9m 范围内擦肩飞过
          if (dist > 0.65 && dist < 1.9) {
            const projKey = `dodge_${idx}_${Math.floor(p.life * 2)}`;
            if (!this.dodgedProjectiles.has(projKey)) {
              this.dodgedProjectiles.add(projKey);
              this.score += 100;
              this.scoreValEl.textContent = this.score.toString();
              this.showHitPopup('⚡ 极限闪避! +100', false, 'hit-score');
            }
          }
        }
      });

      this.radarBlipsContainerEl.innerHTML = html;

      // 来袭警报触发
      if (hasIncomingThreat) {
        this.incomingPlasmaWarningEl?.classList.remove('hidden');
        this.scifiRadarHudEl.classList.add('alert-active');
        if (this.radarAlertTagEl) {
          this.radarAlertTagEl.textContent = 'DANGER';
          this.radarAlertTagEl.classList.add('alert');
        }
        if (now - this.lastIncomingAlarmTime > 600) {
          this.audioManager.playIncomingAlarm();
          this.lastIncomingAlarmTime = now;
        }
      } else {
        this.incomingPlasmaWarningEl?.classList.add('hidden');
        this.scifiRadarHudEl.classList.remove('alert-active');
        if (this.radarAlertTagEl) {
          this.radarAlertTagEl.textContent = 'NORMAL';
          this.radarAlertTagEl.classList.remove('alert');
        }
      }
    }
  }

  private handlePlayerHitByEnemy(): void {
    if (!this.isGameRunning) return;
    if (this.modeManager.getMode() === 'scifi') {
      this.cockpitManager.triggerShieldHit();
      this.shieldHealth = Math.max(0, this.shieldHealth - 20);
      if (this.shieldHpFillEl) {
        this.shieldHpFillEl.style.width = `${this.shieldHealth}%`;
        if (this.shieldHealth <= 30) {
          this.shieldHpFillEl.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
        } else {
          this.shieldHpFillEl.style.background = 'linear-gradient(90deg, #00f3ff, #3b82f6)';
        }
      }
      if (this.shieldHpTextEl) {
        this.shieldHpTextEl.textContent = `${this.shieldHealth}%`;
      }
      if (this.shieldHealth <= 0) {
        this.handleGameOver('战机护盾过载损毁，机体坠毁！');
        return;
      }
    }
    this.audioManager.playShipShieldHit();
    this.triggerFriendlyWarningFlash();
    this.score = Math.max(0, this.score - 150);
    this.scoreValEl.textContent = this.score.toString();
    this.showHitPopup('⚠️ 战机护盾遭受等离子轰击 -150', true, 'friendly-penalty');
  }

  private handleGameOver(reason: string): void {
    this.isGameRunning = false;
    this.audioManager.playNesGameOver();
    this.modeManager.updateHighScore(this.modeManager.getMode(), this.score);
    const bestScore = this.modeManager.getHighScore(this.modeManager.getMode());

    this.nesModalTitleEl.textContent = reason;
    this.nesFinalScoreEl.textContent = this.score.toString().padStart(6, '0');
    this.nesFinalRoundEl.textContent = '-';
    this.nesFinalBestEl.textContent = bestScore.toString().padStart(6, '0');
    this.nesGameoverModalEl.classList.remove('hidden');
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
      if (this.modePillIconEl) this.modePillIconEl.textContent = '👓';
      if (this.modePillTextEl) this.modePillTextEl.textContent = 'WebXR空间';
      this.virtualJoystick.setVisible(false);
      if (this.sensorModeEl) {
        this.sensorModeEl.textContent = '6DoF XR';
        this.sensorModeEl.style.color = '#10b981';
      }
    } else {
      if (this.modePillIconEl) this.modePillIconEl.textContent = '🕹️';
      if (this.modePillTextEl) this.modePillTextEl.textContent = '摇杆推进';
      const cfg = this.modeManager.getModeConfig();
      if (!cfg.isRetroLightGun && this.modeManager.getMode() !== 'ghost') {
        this.virtualJoystick.setVisible(true);
      } else {
        this.virtualJoystick.setVisible(false);
      }
      if (this.sensorModeEl) {
        this.sensorModeEl.textContent = '6DoF HYBRID';
        this.sensorModeEl.style.color = '#00f3ff';
      }
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

    // 授权成功后，直接打开二级游戏大厅让玩家选择玩法！
    this.openGameHub();
  }

  private handleSensorModeChange(mode: SensorMode): void {
    if (this.locomotionMode === 'webxr') return;
    if (mode === 'gyro') {
      if (this.sensorModeEl) {
        this.sensorModeEl.textContent = '6DoF HYBRID';
        this.sensorModeEl.style.color = '#00f3ff';
      }
      this.statusBadgeEl.textContent = 'AR SENSORS OK';
    } else {
      if (this.sensorModeEl) {
        this.sensorModeEl.textContent = 'TOUCH / MOUSE';
        this.sensorModeEl.style.color = '#ffaa00';
      }
      this.statusBadgeEl.textContent = 'MANUAL MODE';
    }
  }

  private triggerFriendlyWarningFlash(): void {
    this.friendlyFlashEl.classList.remove('hidden');
    setTimeout(() => {
      this.friendlyFlashEl.classList.add('hidden');
    }, 450);
  }

  private showHitPopup(text: string, isDanger: boolean = false, customClass?: string): void {
    const floatText = document.createElement('div');
    floatText.className = `hit-float-text ${customClass || ''}`;
    floatText.textContent = text;
    if (isDanger) floatText.style.color = '#ef4444';
    floatText.style.left = `${window.innerWidth / 2}px`;
    floatText.style.top = `${window.innerHeight / 2 - 40}px`;
    this.hitFeedbackContainer.appendChild(floatText);

    setTimeout(() => floatText.remove(), 850);
  }

  private createLaserBeam(start: THREE.Vector3, end: THREE.Vector3, colorHex: number = 0x00f3ff): void {
    const activeCam = this.getActiveCamera();
    const origin = start.clone().add(new THREE.Vector3(0.18, -0.16, -0.4).applyQuaternion(activeCam.quaternion));
    const dir = new THREE.Vector3().subVectors(end, origin);
    const len = dir.length();

    const geom = new THREE.CylinderGeometry(0.045, 0.045, len, 6);
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
      life: 0.22,
      maxLife: 0.22,
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

  private updateSmartReticle(): void {
    if (!this.isGameRunning) return;

    const cfg = this.modeManager.getModeConfig();
    if (cfg.isRetroLightGun) {
      const activeCam = this.getActiveCamera();
      this.raycaster.setFromCamera(this.centerNdc, activeCam);

      // 荒野大镖客目标锁定判定 (对峙拔枪变红)
      if (this.modeManager.getMode().startsWith('gunman_')) {
        const isLocked = this.wildGunmanEngine.checkTargetLock(this.raycaster);
        if (isLocked) {
          this.crosshairEl.classList.add('locked');
          this.crosshairEl.classList.remove('friendly-warning', 'blocked');
          this.lockHintEl.classList.remove('hidden');
          this.lockHintEl.textContent =
            this.wildGunmanEngine.getSubmode() === 'game_c' ? 'BANDIT LOCKED' : 'OUTLAW LOCKED';
          this.friendlyBadgeEl.classList.add('hidden');
          this.blockedBadgeEl.classList.add('hidden');
        } else {
          this.crosshairEl.classList.remove('locked', 'friendly-warning', 'blocked');
          this.lockHintEl.classList.add('hidden');
          this.friendlyBadgeEl.classList.add('hidden');
          this.blockedBadgeEl.classList.add('hidden');
        }
        return;
      }

      // 打鸭子/飞盘目标锁定判定
      const isLocked = this.duckHuntEngine.checkTargetLock(this.raycaster);

      if (isLocked) {
        this.crosshairEl.classList.add('locked');
        this.crosshairEl.classList.remove('friendly-warning', 'blocked');
        this.lockHintEl.classList.remove('hidden');
        this.lockHintEl.textContent = this.duckHuntEngine.getSubmode() === 'game_c' ? 'CLAY LOCKED' : 'DUCK LOCKED';
        this.friendlyBadgeEl.classList.add('hidden');
        this.blockedBadgeEl.classList.add('hidden');
      } else {
        this.crosshairEl.classList.remove('locked', 'friendly-warning', 'blocked');
        this.lockHintEl.classList.add('hidden');
        this.friendlyBadgeEl.classList.add('hidden');
        this.blockedBadgeEl.classList.add('hidden');
      }
      return;
    }

    const activeCam = this.getActiveCamera();
    this.raycaster.setFromCamera(this.centerNdc, activeCam);

    const obsHit = this.environmentManager.checkObstacleIntersection(this.raycaster);
    const entHit = this.entityManager.checkRayIntersection(this.raycaster);
    const weaponCfg = this.weaponManager.getCurrentConfig();

    let isCoverBlocking = false;
    if (obsHit && !weaponCfg.penetratesCover) {
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
        this.crosshairEl.classList.add('friendly-warning');
        this.crosshairEl.classList.remove('locked');
        this.friendlyBadgeEl.classList.remove('hidden');
        this.lockHintEl.classList.add('hidden');
        this.scopeTargetTextEl.textContent = 'WARNING: FRIENDLY TARGET';
      } else {
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

    this.duckHuntEngine.onResize?.();
    this.wildGunmanEngine.onResize?.();
  }

  /**
   * 游戏渲染主循环 (60FPS)
   */
  private animate(): void {
    const delta = Math.min(this.clock.getDelta(), 0.1);
    const activeCam = this.getActiveCamera();
    const cfg = this.modeManager.getModeConfig();

    // 1. 传感器姿态更新
    if (!this.webxrManager.getIsActive()) {
      this.gyroController.update(delta);
    }

    if (cfg.isRetroLightGun) {
      // 处于复古光枪模式 (打鸭子 / 荒野大镖客)
      const currentMode = this.modeManager.getMode();
      if (currentMode.startsWith('gunman_')) {
        this.wildGunmanEngine.update(delta);
      } else {
        this.duckHuntEngine.update(delta);
      }
      this.updateSmartReticle();
    } else {
      // 处于 360° AR 沙盒模式
      const rollAngle = this.gyroController.getRollAngle();
      const rollPeek = Math.max(-1.8, Math.min(1.8, (rollAngle / 25) * 1.8));
      const combinedPeek = Math.max(-2.2, Math.min(2.2, this.sliderPeekOffset + rollPeek));
      this.environmentManager.setPeekOffset(combinedPeek);
      this.environmentManager.update(delta, this.camera);
      this.peekValTextEl.textContent = `${this.environmentManager.getPeekOffset().toFixed(1)}m`;

      if (this.virtualJoystick.getIsVisible() && this.isGameRunning) {
        this.virtualJoystick.applyMovement(this.playerRig, activeCam, delta, 4.0);
      }

      this.scene.updateMatrixWorld(true);

      this.entityManager.update(delta, activeCam);
      this.weaponManager.update(delta);
      this.cockpitManager.update(delta, this.virtualJoystick.getOutputVector(), this.sliderPeekOffset);

      // 星际防卫模式刷新全息战术雷达与来袭威胁监控
      if (this.modeManager.getMode() === 'scifi') {
        const projectiles = this.entityManager.getEnemyProjectiles();
        const activeTargets = this.entityManager.getActiveTargets();
        this.cockpitManager.updateRadar(this.environmentManager.getPeekOffset(), activeTargets, projectiles, activeCam);
        this.updateSciFiTacticalRadar(activeCam, activeTargets, projectiles);
      }

      this.updateLasers(delta);
      this.updateSmartReticle();

      if (this.isGameRunning) {
        const activeTargets = this.entityManager.getActiveTargets().map((e) => ({
          id: e.id,
          isDying: e.isDying,
          currentPosition: e.position,
        }));
        this.indicatorManager.update(activeCam, activeTargets);
      }
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// 启动游戏实例
window.addEventListener('DOMContentLoaded', () => {
  new ArShooterGame();
});
