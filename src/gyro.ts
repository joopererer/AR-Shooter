/**
 * AR-Shooter 陀螺仪传感器控制器 (gyro.ts)
 * 采用四元数 (Quaternion) 与欧拉角 (Euler) 矩阵融合计算，防万向节死锁。
 * 内置 Slerp 球面线性插值低通滤波器消除传感器高频硬件噪声；
 * 内置单一数据源锁定机制，彻底防止 Android / 小米设备双事件交替导致的画面抽搐跳动。
 */

import * as THREE from 'three';

export type SensorMode = 'gyro' | 'mouse';

export interface GyroControllerOptions {
  onModeChange?: (mode: SensorMode) => void;
}

export class GyroController {
  private camera: THREE.Camera;
  private isEnabled: boolean = false;
  private mode: SensorMode = 'mouse';
  private onModeChange?: (mode: SensorMode) => void;

  // 陀螺仪原始数据
  private deviceOrientation: DeviceOrientationEvent | null = null;
  private screenOrientation: number = 0;
  private hasReceivedGyroData: boolean = false;
  private checkGyroTimer: number | null = null;

  // 避免 Android Chrome / MIUI 上 deviceorientation 与 deviceorientationabsolute 同时触发冲突
  private activeEventType: 'standard' | 'absolute' | null = null;

  // 临时数学对象（避免每帧 GC 压力）
  private readonly zee = new THREE.Vector3(0, 0, 1);
  private readonly euler = new THREE.Euler();
  private readonly q0 = new THREE.Quaternion();
  // 修正四元数：将朝向设备屏幕顶部旋转至背部摄像头正前方 (-Z)
  private readonly q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  private readonly currentRawQuat = new THREE.Quaternion();

  // 校准与目标四元数
  private calibrationQuat = new THREE.Quaternion();
  private targetQuat = new THREE.Quaternion();
  private isInitializedQuat: boolean = false;

  // 桌面端鼠标/触控 Fallback 调试模式变量
  private isPointerDown: boolean = false;
  private previousPointerPos = { x: 0, y: 0 };
  private mousePitch: number = 0; // 俯仰角 (X轴)
  private mouseYaw: number = 0;   // 偏航角 (Y轴)
  private readonly mouseQuat = new THREE.Quaternion();

  constructor(camera: THREE.Camera, options?: GyroControllerOptions) {
    this.camera = camera;
    this.onModeChange = options?.onModeChange;

    this.onStandardOrientation = this.onStandardOrientation.bind(this);
    this.onAbsoluteOrientation = this.onAbsoluteOrientation.bind(this);
    this.onScreenOrientationChange = this.onScreenOrientationChange.bind(this);
    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);

    this.updateScreenOrientation();
    this.initPointerControls();
  }

  /**
   * 更新屏幕旋转方向 (兼容 window.orientation 与 screen.orientation)
   */
  private updateScreenOrientation(): void {
    if (typeof window.orientation === 'number') {
      this.screenOrientation = window.orientation;
    } else if (window.screen && window.screen.orientation && typeof window.screen.orientation.angle === 'number') {
      this.screenOrientation = window.screen.orientation.angle;
    } else {
      this.screenOrientation = 0;
    }
  }

  private onScreenOrientationChange(): void {
    this.updateScreenOrientation();
  }

  /**
   * 请求 iOS 与 Android 设备传感器权限
   */
  public async requestPermission(): Promise<boolean> {
    if (window.isSecureContext === false) {
      console.warn('[GyroController] 当前处于非安全上下文 (HTTP)，Android/iOS 均会阻断传感器事件！');
    }

    const DeviceOrientation = window.DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>;
    };

    // 1. iOS 13+ 显式权限触发 (同时请求 Orientation 与 Motion 权限以支持甩动切枪)
    if (typeof DeviceOrientation !== 'undefined' && typeof DeviceOrientation.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientation.requestPermission();
        const DeviceMotion = window.DeviceMotionEvent as unknown as {
          requestPermission?: () => Promise<'granted' | 'denied'>;
        };
        if (typeof DeviceMotion !== 'undefined' && typeof DeviceMotion.requestPermission === 'function') {
          try {
            await DeviceMotion.requestPermission();
          } catch {
            // 静默处理
          }
        }

        if (permissionState === 'granted') {
          this.startListening();
          return true;
        } else {
          console.warn('陀螺仪权限被拒绝，启用触控模式');
          this.setMode('mouse');
          return false;
        }
      } catch (err) {
        console.warn('请求陀螺仪权限发生异常:', err);
        this.setMode('mouse');
        return false;
      }
    } else {
      // 2. Android Chrome / WebView / 其它环境探测
      if (navigator.permissions && navigator.permissions.query) {
        try {
          await (navigator.permissions.query as (desc: object) => Promise<PermissionStatus>)({ name: 'accelerometer' });
          await (navigator.permissions.query as (desc: object) => Promise<PermissionStatus>)({ name: 'gyroscope' });
        } catch {
          // 静默忽略
        }
      }

      this.startListening();
      return true;
    }
  }

  /**
   * 开启传感器事件监听 (带有智能单源锁定机制，杜绝双事件冲突)
   */
  public startListening(): void {
    if (this.isEnabled) return;
    this.isEnabled = true;

    window.addEventListener('deviceorientation', this.onStandardOrientation, false);
    window.addEventListener('deviceorientationabsolute', this.onAbsoluteOrientation as EventListener, false);
    window.addEventListener('orientationchange', this.onScreenOrientationChange, false);

    // 1.5 秒检测期：若未收到有效陀螺仪数据则降级为触控模式
    if (this.checkGyroTimer) window.clearTimeout(this.checkGyroTimer);
    this.checkGyroTimer = window.setTimeout(() => {
      if (!this.hasReceivedGyroData) {
        console.info('[GyroController] 未检测到陀螺仪硬件数据流，激活触控/鼠标拖动模式');
        this.setMode('mouse');
      }
    }, 1500);
  }

  /**
   * 标准 deviceorientation 事件处理
   */
  private onStandardOrientation(event: DeviceOrientationEvent): void {
    // 若当前未锁定，或者已经锁定到 standard，则处理
    if (this.activeEventType === 'absolute') return;

    if (this.isValidOrientationEvent(event)) {
      if (!this.activeEventType) {
        this.activeEventType = 'standard';
        // 注销 absolute 监听，彻底避免 Android 上的双重交替覆盖！
        window.removeEventListener('deviceorientationabsolute', this.onAbsoluteOrientation as EventListener, false);
      }
      this.deviceOrientation = event;
      if (!this.hasReceivedGyroData) {
        this.hasReceivedGyroData = true;
        this.setMode('gyro');
      }
    }
  }

  /**
   * Android 专用 deviceorientationabsolute 事件处理
   */
  private onAbsoluteOrientation(event: DeviceOrientationEvent): void {
    if (this.activeEventType === 'standard') return;

    if (this.isValidOrientationEvent(event)) {
      if (!this.activeEventType) {
        this.activeEventType = 'absolute';
        window.removeEventListener('deviceorientation', this.onStandardOrientation, false);
      }
      this.deviceOrientation = event;
      if (!this.hasReceivedGyroData) {
        this.hasReceivedGyroData = true;
        this.setMode('gyro');
      }
    }
  }

  private isValidOrientationEvent(event: DeviceOrientationEvent): boolean {
    return (
      event.alpha !== null &&
      event.beta !== null &&
      event.gamma !== null &&
      !isNaN(event.alpha) &&
      !isNaN(event.beta) &&
      !isNaN(event.gamma)
    );
  }

  private setMode(newMode: SensorMode): void {
    if (this.mode !== newMode) {
      this.mode = newMode;
      if (this.onModeChange) {
        this.onModeChange(newMode);
      }
    }
  }

  public getMode(): SensorMode {
    return this.mode;
  }

  public hasGyroHardware(): boolean {
    return this.hasReceivedGyroData;
  }

  /**
   * 触控/鼠标拖动控制初始化
   */
  private initPointerControls(): void {
    window.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false });
  }

  private onPointerDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('#start-modal')) {
      return;
    }
    this.isPointerDown = true;
    this.previousPointerPos = { x: e.clientX, y: e.clientY };
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isPointerDown) return;

    const deltaX = e.clientX - this.previousPointerPos.x;
    const deltaY = e.clientY - this.previousPointerPos.y;

    this.previousPointerPos = { x: e.clientX, y: e.clientY };

    const sensitivity = 0.0035;
    this.mouseYaw -= deltaX * sensitivity;
    this.mousePitch -= deltaY * sensitivity;

    const maxPitch = THREE.MathUtils.degToRad(85);
    this.mousePitch = Math.max(-maxPitch, Math.min(maxPitch, this.mousePitch));
  }

  private onPointerUp(): void {
    this.isPointerDown = false;
  }

  /**
   * 场景定格校准 (Calibration)
   */
  public recalibrate(): void {
    if (this.mode === 'gyro' && this.deviceOrientation) {
      const rawQuat = this.calculateRawQuat(this.deviceOrientation, this.screenOrientation);
      const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(rawQuat);
      const currentYaw = Math.atan2(forward.x, -forward.z);

      // 将当前手机物理朝向旋转校准为虚拟空间的正前方 (Z = -1, Yaw = 0)
      this.calibrationQuat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), currentYaw);
      this.targetQuat.copy(this.calibrationQuat).multiply(rawQuat);
      this.camera.quaternion.copy(this.targetQuat);
    } else {
      this.mouseYaw = 0;
      this.mousePitch = 0;
      this.calibrationQuat.identity();
      this.mouseQuat.identity();
      this.targetQuat.identity();
      this.camera.quaternion.identity();
    }

    // 重置平滑目标使得校准瞬间生效
    this.isInitializedQuat = true;
  }

  /**
   * 将设备传感器欧拉角融合转换为原始四元数
   */
  private calculateRawQuat(event: DeviceOrientationEvent, orientDegree: number): THREE.Quaternion {
    const alpha = event.alpha ? THREE.MathUtils.degToRad(event.alpha) : 0; // Z
    const beta = event.beta ? THREE.MathUtils.degToRad(event.beta) : 0;   // X'
    const gamma = event.gamma ? THREE.MathUtils.degToRad(event.gamma) : 0; // Y''
    const orient = orientDegree ? THREE.MathUtils.degToRad(orientDegree) : 0;

    // 1. 设置 'YXZ' 顺序的欧拉角 (beta, alpha, -gamma)
    this.euler.set(beta, alpha, -gamma, 'YXZ');

    // 2. 将欧拉角应用到四元数
    const quat = this.currentRawQuat;
    quat.setFromEuler(this.euler);

    // 3. 乘以修正四元数 q1 (使相机朝向手机背部正前方而非顶部)
    quat.multiply(this.q1);

    // 4. 乘以屏幕旋转四元数 q0
    this.q0.setFromAxisAngle(this.zee, -orient);
    quat.multiply(this.q0);

    return quat;
  }

  /**
   * 主循环更新函数：在每一帧调用，集成 Slerp 阻尼低通滤波，消除传感器抖动
   */
  public update(delta: number = 0.016): void {
    if (!this.isEnabled) return;

    if (this.mode === 'gyro' && this.deviceOrientation) {
      // 陀螺仪模式
      const rawQuat = this.calculateRawQuat(this.deviceOrientation, this.screenOrientation);

      // 计算本帧的目标四元数: Q_target = Q_calib * Q_raw
      this.targetQuat.copy(this.calibrationQuat).multiply(rawQuat);

      // Slerp 球面线性插值低通滤波：
      // factor 设置为 1.0 - exp(-decay * delta) 使得在不同帧率下平滑度完全一致
      // decay = 25 左右响应极其灵敏且完全过滤高频毛刺抖动
      if (!this.isInitializedQuat) {
        this.camera.quaternion.copy(this.targetQuat);
        this.isInitializedQuat = true;
      } else {
        const smoothAlpha = Math.min(1.0, 1.0 - Math.exp(-24 * delta));
        this.camera.quaternion.slerp(this.targetQuat, smoothAlpha);
      }
    } else {
      // 触控/鼠标拖拽模式
      this.mouseQuat.setFromEuler(new THREE.Euler(this.mousePitch, this.mouseYaw, 0, 'YXZ'));
      this.targetQuat.copy(this.calibrationQuat).multiply(this.mouseQuat);

      if (!this.isInitializedQuat) {
        this.camera.quaternion.copy(this.targetQuat);
        this.isInitializedQuat = true;
      } else {
        const smoothAlpha = Math.min(1.0, 1.0 - Math.exp(-28 * delta));
        this.camera.quaternion.slerp(this.targetQuat, smoothAlpha);
      }
    }
  }

  /**
   * 获取设备横滚倾斜角 (用于体感歪头探身 Roll-to-Peek)
   */
  public getRollAngle(): number {
    if (this.deviceOrientation && typeof this.deviceOrientation.gamma === 'number') {
      return this.deviceOrientation.gamma;
    }
    return 0;
  }

  /**
   * 销毁并解绑所有事件监听
   */
  public dispose(): void {
    this.isEnabled = false;
    if (this.checkGyroTimer) window.clearTimeout(this.checkGyroTimer);

    window.removeEventListener('deviceorientation', this.onStandardOrientation, false);
    window.removeEventListener('deviceorientationabsolute', this.onAbsoluteOrientation as EventListener, false);
    window.removeEventListener('orientationchange', this.onScreenOrientationChange, false);
    window.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
  }
}
