/**
 * AR-Shooter WebXR 6DoF 空间追踪管理器 (webxr.ts)
 * 封装 W3C WebXR Device API 的 immersive-ar 会话控制、
 * 硬件 SLAM / ARCore 支持度探测、DOM Overlay 穿透绑定与退出生命周期管理。
 */

import * as THREE from 'three';

export interface WebXRManagerCallbacks {
  onSessionStarted?: (session: XRSession) => void;
  onSessionEnded?: () => void;
  onError?: (err: Error) => void;
}

export class WebXRManager {
  private renderer: THREE.WebGLRenderer;
  private currentSession: XRSession | null = null;
  private isSupported: boolean = false;
  private callbacks: WebXRManagerCallbacks;

  constructor(renderer: THREE.WebGLRenderer, callbacks?: WebXRManagerCallbacks) {
    this.renderer = renderer;
    this.callbacks = callbacks || {};
    this.checkSupport();
  }

  /**
   * 检测当前设备与浏览器是否原生支持 WebXR immersive-ar 空间感知
   */
  public async checkSupport(): Promise<boolean> {
    if ('xr' in navigator && navigator.xr) {
      try {
        const supported = await navigator.xr.isSessionSupported('immersive-ar');
        this.isSupported = supported;
        return supported;
      } catch (e) {
        console.warn('[WebXRManager] 检测 WebXR 支持异常:', e);
        this.isSupported = false;
        return false;
      }
    }
    this.isSupported = false;
    return false;
  }

  public getIsSupported(): boolean {
    return this.isSupported;
  }

  public getIsActive(): boolean {
    return this.currentSession !== null;
  }

  /**
   * 启动工业级 6DoF WebXR AR 实景会话 (调用 ARCore / SLAM 特征追踪)
   */
  public async startSession(overlayRoot?: HTMLElement): Promise<boolean> {
    if (!('xr' in navigator) || !navigator.xr) {
      throw new Error('当前浏览器不支持 WebXR Device API');
    }

    try {
      const sessionInit: XRSessionInit = {
        requiredFeatures: ['local'],
        optionalFeatures: ['dom-overlay', 'hit-test', 'light-estimation'],
      };

      // 允许将 HUD 挂载到 WebXR 穿透上层
      if (overlayRoot && typeof XRSystem !== 'undefined') {
        (sessionInit as unknown as { domOverlay: { root: HTMLElement } }).domOverlay = {
          root: overlayRoot,
        };
      }

      const session = await navigator.xr.requestSession('immersive-ar', sessionInit);
      this.currentSession = session;

      // 开启 Three.js WebXR 渲染管线对接
      this.renderer.xr.enabled = true;
      await this.renderer.xr.setSession(session);

      session.addEventListener('end', () => {
        this.handleSessionEnded();
      });

      if (this.callbacks.onSessionStarted) {
        this.callbacks.onSessionStarted(session);
      }

      return true;
    } catch (err: unknown) {
      const errorObj = err instanceof Error ? err : new Error(String(err));
      console.error('[WebXRManager] 启动 WebXR 会话失败:', errorObj);
      if (this.callbacks.onError) {
        this.callbacks.onError(errorObj);
      }
      return false;
    }
  }

  /**
   * 退出 WebXR 会话，无缝降级回常规 WebRTC + 陀螺仪模式
   */
  public async endSession(): Promise<void> {
    if (this.currentSession) {
      try {
        await this.currentSession.end();
      } catch (e) {
        console.warn('[WebXRManager] 结束 WebXR 会话异常:', e);
      }
      this.handleSessionEnded();
    }
  }

  private handleSessionEnded(): void {
    this.currentSession = null;
    this.renderer.xr.enabled = false;
    if (this.callbacks.onSessionEnded) {
      this.callbacks.onSessionEnded();
    }
  }
}
