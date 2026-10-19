/**
 * AR-Shooter 屏外怪物屏幕边缘指示箭头算法 (indicator.ts)
 * 采用 THREE.Frustum 快速剔除屏幕内实体；
 * 采用相机局部坐标 (localPos.x, localPos.y) 计算方位角，彻底杜绝正后方 project 导致的坐标反转 Bug；
 * 配合矩形边界相交算法将指示箭头平滑吸附在屏幕内边距边缘。
 */

import * as THREE from 'three';

export interface IndicatorTarget {
  id: string;
  isDying: boolean;
  currentPosition: THREE.Vector3;
}

export class IndicatorManager {
  private container: HTMLElement;
  private frustum = new THREE.Frustum();
  private projScreenMatrix = new THREE.Matrix4();
  private localPos = new THREE.Vector3();
  private camWorldPos = new THREE.Vector3();

  // 箭头 DOM 元素缓存池: monsterId -> HTMLDivElement
  private indicatorElements = new Map<string, HTMLElement>();

  constructor(containerId: string = 'indicator-container') {
    const el = document.getElementById(containerId);
    if (!el) {
      throw new Error(`找不到指示器挂载容器: #${containerId}`);
    }
    this.container = el;
  }

  /**
   * 每一帧更新所有屏外怪物的边缘指示箭头
   */
  public update(camera: THREE.Camera, monsters: IndicatorTarget[]): void {
    // 1. 更新相机视锥 Frustum
    this.projScreenMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projScreenMatrix);

    const screenWidth = window.innerWidth;
    const screenHeight = window.innerHeight;
    const centerX = screenWidth / 2;
    const centerY = screenHeight / 2;

    // 屏幕内边距 (距视口边缘 32px)
    const padding = 34;
    const rx = Math.max(10, centerX - padding);
    const ry = Math.max(10, centerY - padding);

    // 记录本帧活跃的屏外怪物 ID
    const activeOffscreenIds = new Set<string>();

    for (let i = 0; i < monsters.length; i++) {
      const monster = monsters[i];
      if (monster.isDying) continue;

      // 判断怪物是否在视锥体视野内
      const isInFrustum = this.frustum.containsPoint(monster.currentPosition);

      if (isInFrustum) {
        // 在屏幕内，隐藏指示箭头
        this.hideIndicator(monster.id);
        continue;
      }

      // 不在视野内：计算屏外指示箭头
      activeOffscreenIds.add(monster.id);

      // 将怪物世界坐标转换到相机局部坐标系
      // 相机局部空间中：-Z 为正前方，+X 为右侧，+Y 为上方
      this.localPos.copy(monster.currentPosition).applyMatrix4(camera.matrixWorldInverse);

      // 计算屏幕平面上的投影方向
      // 屏幕像素系中：向右为 +X，向下为 +Y
      let dirX = this.localPos.x;
      let dirY = -this.localPos.y; // 翻转 Y 轴以匹配屏幕向下增长的像素坐标

      // 如果怪物在玩家正正后方，给一个微小向下偏移提示掉头
      if (Math.abs(dirX) < 1e-4 && Math.abs(dirY) < 1e-4) {
        dirY = 1.0;
      }

      // 计算方位角 theta: [-PI, +PI]
      const theta = Math.atan2(dirY, dirX);

      // 矩形视口相交求交点，将指示器紧贴屏幕四周边缘
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);

      let t = Infinity;
      if (Math.abs(cosT) > 1e-5) {
        const tx = rx / Math.abs(cosT);
        t = Math.min(t, tx);
      }
      if (Math.abs(sinT) > 1e-5) {
        const ty = ry / Math.abs(sinT);
        t = Math.min(t, ty);
      }

      const screenX = centerX + t * cosT;
      const screenY = centerY + t * sinT;

      // 箭头自身旋转角度 (SVG 默认向右指向 0 度，故直接旋转 theta)
      const rotDeg = theta * (180 / Math.PI);

      // 关键修复：计算怪物与相机的真实世界欧氏距离
      camera.getWorldPosition(this.camWorldPos);
      const distance = this.camWorldPos.distanceTo(monster.currentPosition);

      // 获取或创建 DOM 元素并更新位置
      const el = this.getOrCreateIndicator(monster.id);
      el.style.display = 'flex';
      el.style.left = `${screenX}px`;
      el.style.top = `${screenY}px`;

      const arrowIcon = el.querySelector('.indicator-arrow-svg') as SVGElement | null;
      if (arrowIcon) {
        arrowIcon.style.transform = `rotate(${rotDeg}deg)`;
      }

      const distLabel = el.querySelector('.indicator-distance') as HTMLElement | null;
      if (distLabel) {
        distLabel.textContent = `${distance.toFixed(1)}m`;
      }
    }

    // 清理已死亡或不需要显示的怪物指示器 DOM
    this.indicatorElements.forEach((el, id) => {
      if (!activeOffscreenIds.has(id)) {
        el.style.display = 'none';
      }
    });
  }

  /**
   * 获取或动态创建指示器 DOM 节点
   */
  private getOrCreateIndicator(monsterId: string): HTMLElement {
    let el = this.indicatorElements.get(monsterId);
    if (!el) {
      el = document.createElement('div');
      el.className = 'edge-indicator';
      el.innerHTML = `
        <svg class="indicator-arrow-svg" viewBox="0 0 24 24">
          <!-- 默认向右指向的战术尖角箭头 -->
          <polygon points="4,4 20,12 4,20 8,12" />
        </svg>
        <span class="indicator-distance">8.0m</span>
      `;
      this.container.appendChild(el);
      this.indicatorElements.set(monsterId, el);
    }
    return el;
  }

  /**
   * 隐藏指定指示器
   */
  private hideIndicator(monsterId: string): void {
    const el = this.indicatorElements.get(monsterId);
    if (el) {
      el.style.display = 'none';
    }
  }

  public clear(): void {
    this.dispose();
  }

  /**
   * 清除并释放所有指示器
   */
  public dispose(): void {
    this.indicatorElements.forEach((el) => {
      el.remove();
    });
    this.indicatorElements.clear();
  }
}
