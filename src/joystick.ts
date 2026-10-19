/**
 * AR-Shooter 虚拟移动摇杆 (joystick.ts)
 * 采用原生 Touch / Pointer 事件与双轴阻尼滤波，
 * 支持移动端左手拇指触控前后左右平移走动，
 * 并支持桌面端 WASD 键盘按键同步控制，完全跨平台。
 */

import * as THREE from 'three';

export interface JoystickVector {
  x: number; // [-1, 1], 向右为正
  y: number; // [-1, 1], 向前为正 (向上推)
}

export class VirtualJoystick {
  private container: HTMLElement;
  private baseEl: HTMLElement;
  private stickEl: HTMLElement;

  private isPointerDown: boolean = false;
  private activeTouchId: number | null = null;
  private baseCenter = { x: 0, y: 0 };
  private maxRadius: number = 48; // 最大拖动半径 (px)

  // 当前输出向量 [-1, 1]
  private outputVector: JoystickVector = { x: 0, y: 0 };
  private isVisible: boolean = false;

  // 键盘 WASD 控制支持 (PC端方便调试走位)
  private keyboardState = {
    forward: false,
    backward: false,
    left: false,
    right: false,
  };

  constructor(containerId: string = 'joystick-zone') {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`找不到摇杆挂载容器: #${containerId}`);
    }
    this.container = el;
    this.baseEl = el.querySelector('.joystick-base') as HTMLElement;
    this.stickEl = el.querySelector('.joystick-stick') as HTMLElement;

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onKeyDown = this.onKeyDown.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);

    this.bindEvents();
  }

  private bindEvents(): void {
    // 监听左半屏区域触摸
    this.container.addEventListener('pointerdown', this.onPointerDown, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove, { passive: false });
    window.addEventListener('pointerup', this.onPointerUp, { passive: false });
    window.addEventListener('pointercancel', this.onPointerUp, { passive: false });

    // 键盘辅助
    window.addEventListener('keydown', this.onKeyDown, false);
    window.addEventListener('keyup', this.onKeyUp, false);
  }

  private onPointerDown(e: PointerEvent): void {
    // 限制仅在当前处于未激活且在左侧区域时触发
    if (this.isPointerDown) return;
    this.isPointerDown = true;
    this.activeTouchId = e.pointerId;

    const rect = this.baseEl.getBoundingClientRect();
    this.baseCenter = {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
    };

    this.updateStickPosition(e.clientX, e.clientY);
    this.stickEl.classList.add('active');
  }

  private onPointerMove(e: PointerEvent): void {
    if (!this.isPointerDown || e.pointerId !== this.activeTouchId) return;
    e.preventDefault();
    this.updateStickPosition(e.clientX, e.clientY);
  }

  private onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== this.activeTouchId && this.activeTouchId !== null) return;
    this.isPointerDown = false;
    this.activeTouchId = null;

    // 回中复位
    this.stickEl.style.transform = `translate(0px, 0px)`;
    this.stickEl.classList.remove('active');
    this.outputVector.x = 0;
    this.outputVector.y = 0;
  }

  private updateStickPosition(clientX: number, clientY: number): void {
    const deltaX = clientX - this.baseCenter.x;
    const deltaY = clientY - this.baseCenter.y;
    const distance = Math.hypot(deltaX, deltaY);

    let stickX = deltaX;
    let stickY = deltaY;

    if (distance > this.maxRadius) {
      const angle = Math.atan2(deltaY, deltaX);
      stickX = Math.cos(angle) * this.maxRadius;
      stickY = Math.sin(angle) * this.maxRadius;
    }

    this.stickEl.style.transform = `translate(${stickX}px, ${stickY}px)`;

    // 归一化输出：X 向右为正，Y 向上推为正
    this.outputVector.x = stickX / this.maxRadius;
    this.outputVector.y = -stickY / this.maxRadius;
  }

  private onKeyDown(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keyboardState.forward = true;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keyboardState.backward = true;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keyboardState.left = true;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keyboardState.right = true;
        break;
    }
  }

  private onKeyUp(e: KeyboardEvent): void {
    switch (e.code) {
      case 'KeyW':
      case 'ArrowUp':
        this.keyboardState.forward = false;
        break;
      case 'KeyS':
      case 'ArrowDown':
        this.keyboardState.backward = false;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        this.keyboardState.left = false;
        break;
      case 'KeyD':
      case 'ArrowRight':
        this.keyboardState.right = false;
        break;
    }
  }

  /**
   * 每一帧读取当前的移动向量并平移相机
   * moveSpeed: 移动速度 (m/s)
   */
  public applyMovement(camera: THREE.Camera, delta: number, moveSpeed: number = 3.6): void {
    // 融合触控摇杆与键盘输入
    let moveX = this.outputVector.x;
    let moveY = this.outputVector.y;

    if (this.keyboardState.forward) moveY += 1.0;
    if (this.keyboardState.backward) moveY -= 1.0;
    if (this.keyboardState.left) moveX -= 1.0;
    if (this.keyboardState.right) moveX += 1.0;

    // 限制向量长度最大为 1
    const len = Math.hypot(moveX, moveY);
    if (len > 1.0) {
      moveX /= len;
      moveY /= len;
    }

    if (Math.abs(moveX) < 1e-4 && Math.abs(moveY) < 1e-4) return;

    // 提取相机当前的水平朝向前方向量 (在 XZ 平面)
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0; // 锁定在水平面上走动，不往天上看时冲天飞起
    forward.normalize();

    // 计算右方向量
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    right.y = 0;
    right.normalize();

    // 叠加位移: forward * moveY + right * moveX
    const displacement = new THREE.Vector3()
      .addScaledVector(forward, moveY * moveSpeed * delta)
      .addScaledVector(right, moveX * moveSpeed * delta);

    camera.position.add(displacement);
  }

  public setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.container.style.display = visible ? 'flex' : 'none';
  }

  public getIsVisible(): boolean {
    return this.isVisible;
  }

  public dispose(): void {
    this.container.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
  }
}
