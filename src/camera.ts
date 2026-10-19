/**
 * AR-Shooter 相机模块 (camera.ts)
 * 负责调用 WebRTC 获取后置摄像头视频流，
 * 严格处理移动端安全上下文 (HTTPS) 限制、阶梯式降级 (环境摄像头/通用视频流) 及各厂商内核播放属性。
 */

export interface CameraInitResult {
  success: boolean;
  stream?: MediaStream;
  error?: string;
  isVirtualFallback?: boolean;
}

export class CameraManager {
  private videoElement: HTMLVideoElement;
  private currentStream: MediaStream | null = null;
  private virtualGridElement: HTMLElement | null = null;

  constructor(videoElementId: string = 'camera-bg') {
    const el = document.getElementById(videoElementId);
    if (!el || !(el instanceof HTMLVideoElement)) {
      throw new Error(`找不到视频背景元素: #${videoElementId}`);
    }
    this.videoElement = el;
    this.virtualGridElement = document.getElementById('virtual-grid-bg');

    // 移动端（iOS Safari、Android Chrome、各厂商浏览器内核）内联全屏播放属性
    this.videoElement.setAttribute('autoplay', 'true');
    this.videoElement.setAttribute('playsinline', 'true');
    this.videoElement.setAttribute('webkit-playsinline', 'true');
    this.videoElement.setAttribute('x5-video-player-type', 'h5-page');
    this.videoElement.setAttribute('x5-playsinline', 'true');
    this.videoElement.muted = true;
  }

  /**
   * 启动摄像头流
   * 必须在用户点击事件的上下文同步执行链中调用
   */
  public async initCamera(): Promise<CameraInitResult> {
    // 1. 安全上下文检查 (最常见问题：HTTP 局域网被移动端浏览器直接屏蔽)
    if (window.isSecureContext === false) {
      const err = '当前处于 HTTP 不安全环境，移动浏览器强制禁止使用摄像头和陀螺仪！请通过 HTTPS 或 localhost 访问。';
      console.error('[CameraManager]', err);
      this.enableVirtualFallback(err);
      return {
        success: false,
        error: err,
        isVirtualFallback: true,
      };
    }

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = '浏览器未暴露 mediaDevices.getUserMedia 接口，可能是浏览器权限未开启或系统版本受限。';
      console.warn('[CameraManager]', err);
      this.enableVirtualFallback(err);
      return {
        success: false,
        error: err,
        isVirtualFallback: true,
      };
    }

    // 2. 阶梯式约束尝试策略（防止某些 Android 厂商对高级约束报错 OverconstrainedError）
    const constraintTiers: MediaStreamConstraints[] = [
      // 第一优先级：后置摄像头 + 理想高清分辨率
      {
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 640 },
          height: { ideal: 1080, min: 480 },
        },
      },
      // 第二优先级：纯后置摄像头宽松模式
      {
        audio: false,
        video: { facingMode: 'environment' },
      },
      // 第三优先级：任意可用摄像头基础流
      {
        audio: false,
        video: true,
      },
    ];

    let lastError: Error | null = null;
    let stream: MediaStream | null = null;

    for (const constraints of constraintTiers) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.warn('[CameraManager] 约束尝试失败，尝试下一级降级:', constraints, lastError.message);
      }
    }

    if (!stream) {
      const errorMsg = lastError ? `${lastError.name}: ${lastError.message}` : '无法获取摄像头数据流';
      console.warn('[CameraManager] 所有摄像头约束均获取失败，已转入虚拟网格:', errorMsg);
      this.enableVirtualFallback(errorMsg);
      return {
        success: false,
        error: errorMsg,
        isVirtualFallback: true,
      };
    }

    try {
      this.currentStream = stream;
      this.videoElement.srcObject = stream;

      // 等待元数据加载并调用 play
      await new Promise<void>((resolve, reject) => {
        const onLoaded = async () => {
          try {
            await this.videoElement.play();
            resolve();
          } catch (playErr) {
            reject(playErr);
          }
        };

        if (this.videoElement.readyState >= 2) {
          onLoaded();
        } else {
          this.videoElement.onloadedmetadata = onLoaded;
        }

        this.videoElement.onerror = () => {
          reject(new Error('视频元素播放出错'));
        };

        // 3秒保护超时
        setTimeout(() => resolve(), 3000);
      });

      // 隐藏虚拟网格背景，使摄像头画面显露
      if (this.virtualGridElement) {
        this.virtualGridElement.style.opacity = '0';
      }
      this.videoElement.style.display = 'block';

      return {
        success: true,
        stream,
        isVirtualFallback: false,
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.enableVirtualFallback(errorMsg);
      return {
        success: false,
        error: errorMsg,
        isVirtualFallback: true,
      };
    }
  }

  /**
   * 激活虚拟空间网格背景降级方案
   */
  private enableVirtualFallback(reason: string) {
    console.info(`[CameraManager] 激活虚拟网格: ${reason}`);
    if (this.virtualGridElement) {
      this.virtualGridElement.style.opacity = '0.9';
    }
    this.videoElement.style.display = 'none';
  }

  /**
   * 停止当前流
   */
  public stopCamera(): void {
    if (this.currentStream) {
      this.currentStream.getTracks().forEach((track) => track.stop());
      this.currentStream = null;
    }
    this.videoElement.srcObject = null;
  }
}
