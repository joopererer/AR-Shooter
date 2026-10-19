/**
 * AR-Shooter 真实生灵皮毛与自然生态程序化超清纹理系统 (textureGenerator.ts)
 * 采用 HTML5 Canvas 动态合成真实动物毛发、梅花斑点、奶牛有机斑块、树皮裂纹与河流波光贴图，
 * 彻底告别生硬粗糙方块，达到主机级自然生动质感！
 */

import * as THREE from 'three';

export class TextureGenerator {
  private static deerTexture?: THREE.CanvasTexture;
  private static cowTexture?: THREE.CanvasTexture;
  private static boarTexture?: THREE.CanvasTexture;
  private static bearTexture?: THREE.CanvasTexture;
  private static sheepTexture?: THREE.CanvasTexture;
  private static dogTexture?: THREE.CanvasTexture;
  private static barkTexture?: THREE.CanvasTexture;
  private static waterTexture?: THREE.CanvasTexture;

  /**
   * 1. 真实梅花鹿/驯鹿皮毛贴图 (暖栗棕色渐变底色 + 浑然天成的雪白梅花点斑 + 腹部乳白软毛)
   */
  public static getDeerTexture(): THREE.CanvasTexture {
    if (this.deerTexture) return this.deerTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 背脊到腹侧平滑渐变 (深栗棕 -> 暖驼色 -> 腹侧淡白)
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0.0, '#4a1e05'); // 脊背深棕
    grad.addColorStop(0.2, '#854d0e'); // 上背暖栗
    grad.addColorStop(0.55, '#b45309'); // 侧腹金驼
    grad.addColorStop(0.85, '#d97706'); // 下侧浅棕
    grad.addColorStop(1.0, '#fef3c7'); // 腹底奶白
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 细密顺滑兽毛纹理噪波
    ctx.fillStyle = 'rgba(69, 26, 3, 0.08)';
    for (let i = 0; i < 4000; i++) {
      const rx = Math.random() * 512;
      const ry = Math.random() * 512;
      ctx.fillRect(rx, ry, Math.random() * 4 + 1, 1);
    }
    ctx.fillStyle = 'rgba(254, 243, 199, 0.12)';
    for (let i = 0; i < 2500; i++) {
      const rx = Math.random() * 512;
      const ry = Math.random() * 512;
      ctx.fillRect(rx, ry, Math.random() * 3 + 1, 1);
    }

    // 标志性自然梅花鹿雪白点斑 (Dapples / White Spots)
    ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
    for (let row = 0; row < 5; row++) {
      const yBase = 120 + row * 45;
      const spotCount = 10 + (row % 2) * 2;
      for (let s = 0; s < spotCount; s++) {
        const sx = (s / spotCount) * 480 + (Math.random() - 0.5) * 16 + 16;
        const sy = yBase + (Math.random() - 0.5) * 14;
        const radius = Math.random() * 4.5 + 3.5;

        ctx.beginPath();
        ctx.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx.fill();

        // 柔和羽化光晕边缘
        ctx.fillStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.beginPath();
        ctx.arc(sx, sy, radius + 2.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.88)';
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.deerTexture = tex;
    return tex;
  }

  /**
   * 2. 真实荷斯坦黑白花奶牛皮毛贴图 (柔润乳白底毛 + 浑然天成的有机黑斑块 + 细腻微毛感)
   */
  public static getCowTexture(): THREE.CanvasTexture {
    if (this.cowTexture) return this.cowTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 底色：温润天然生牛乳白
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 512, 512);

    // 微妙皮毛光影底色
    const bgGrad = ctx.createLinearGradient(0, 0, 512, 512);
    bgGrad.addColorStop(0, 'rgba(241, 245, 249, 0.4)');
    bgGrad.addColorStop(1, 'rgba(226, 232, 240, 0.6)');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 512, 512);

    // 真实奶牛有机天然黑色斑块 (Organic Splotches，绝非死板方块)
    ctx.fillStyle = '#0f172a';
    const splotches = [
      { x: 120, y: 140, r: 85 },
      { x: 160, y: 190, r: 60 },
      { x: 95, y: 220, r: 50 },
      { x: 380, y: 120, r: 90 },
      { x: 420, y: 180, r: 65 },
      { x: 340, y: 210, r: 55 },
      { x: 260, y: 360, r: 100 },
      { x: 200, y: 390, r: 70 },
      { x: 330, y: 400, r: 65 },
      { x: 460, y: 380, r: 50 },
      { x: 70, y: 410, r: 45 },
    ];

    splotches.forEach((sp) => {
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, sp.r, 0, Math.PI * 2);
      ctx.fill();

      // 在斑块边缘添加不规则有机卫星碎斑
      for (let k = 0; k < 6; k++) {
        const ang = Math.random() * Math.PI * 2;
        const dist = sp.r * (0.8 + Math.random() * 0.45);
        const subR = Math.random() * 22 + 8;
        ctx.beginPath();
        ctx.arc(sp.x + Math.cos(ang) * dist, sp.y + Math.sin(ang) * dist, subR, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // 细致毛绒颗粒感
    ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
    for (let i = 0; i < 3000; i++) {
      ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 1);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.cowTexture = tex;
    return tex;
  }

  /**
   * 3. 欧亚野猪硬质鬃毛贴图 (深褐黑粗犷刚毛 + 脊背硬棱反光)
   */
  public static getBoarTexture(): THREE.CanvasTexture {
    if (this.boarTexture) return this.boarTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 深泥褐与岩灰渐变
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1c1917');
    grad.addColorStop(0.3, '#292524');
    grad.addColorStop(0.7, '#44403c');
    grad.addColorStop(1, '#1c1917');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 粗硬鬃毛条纹 (Bristles)
    ctx.fillStyle = 'rgba(120, 113, 108, 0.25)';
    for (let i = 0; i < 2200; i++) {
      const bx = Math.random() * 512;
      const by = Math.random() * 512;
      ctx.fillRect(bx, by, Math.random() * 12 + 4, 1.5);
    }
    ctx.fillStyle = 'rgba(12, 10, 9, 0.45)';
    for (let i = 0; i < 2000; i++) {
      const bx = Math.random() * 512;
      const by = Math.random() * 512;
      ctx.fillRect(bx, by, Math.random() * 8 + 3, 1.5);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.boarTexture = tex;
    return tex;
  }

  /**
   * 4. 灰熊/大棕熊浓密毛皮贴图 (多层次丰满深棕粗绒毛)
   */
  public static getBearTexture(): THREE.CanvasTexture {
    if (this.bearTexture) return this.bearTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#2e190d');
    grad.addColorStop(0.4, '#45220f');
    grad.addColorStop(0.8, '#5c3317');
    grad.addColorStop(1, '#241208');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 多重粗毛交织噪波
    for (let i = 0; i < 3500; i++) {
      ctx.fillStyle = i % 2 === 0 ? 'rgba(146, 64, 14, 0.16)' : 'rgba(23, 11, 5, 0.35)';
      ctx.fillRect(Math.random() * 512, Math.random() * 512, Math.random() * 6 + 2, 2);
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.bearTexture = tex;
    return tex;
  }

  /**
   * 5. 美利奴绵羊卷曲羊毛贴图 (柔和蓬松卷曲绒朵光影)
   */
  public static getSheepTexture(): THREE.CanvasTexture {
    if (this.sheepTexture) return this.sheepTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    ctx.fillStyle = '#f1f5f9';
    ctx.fillRect(0, 0, 512, 512);

    // 细致卷毛漩涡微阴影
    ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
    for (let y = 16; y < 512; y += 32) {
      for (let x = 16; x < 512; x += 32) {
        const ox = x + (Math.random() - 0.5) * 12;
        const oy = y + (Math.random() - 0.5) * 12;
        ctx.beginPath();
        ctx.arc(ox, oy, 14, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ox - 3, oy - 3, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(203, 213, 225, 0.45)';
      }
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.sheepTexture = tex;
    return tex;
  }

  /**
   * 6. 猎犬经典三色毛皮贴图 (暖橙棕鞍斑 + 纯白领口与鼻梁)
   */
  public static getDogTexture(): THREE.CanvasTexture {
    if (this.dogTexture) return this.dogTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 暖橙棕主毛
    ctx.fillStyle = '#d97706';
    ctx.fillRect(0, 0, 512, 512);

    // 纯白领胸毛块
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 320, 512, 192);

    // 经典黑色鞍背斑
    ctx.fillStyle = '#1c1917';
    ctx.beginPath();
    ctx.ellipse(256, 160, 180, 110, 0, 0, Math.PI * 2);
    ctx.fill();

    const tex = new THREE.CanvasTexture(canvas);
    this.dogTexture = tex;
    return tex;
  }

  /**
   * 7. 真实林木纵向裂纹树皮贴图 (纵向深槽木纹与粗糙节瘤)
   */
  public static getTreeBarkTexture(): THREE.CanvasTexture {
    if (this.barkTexture) return this.barkTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 树皮深灰褐基底
    ctx.fillStyle = '#3e2723';
    ctx.fillRect(0, 0, 256, 512);

    // 纵向粗糙木纹裂槽
    for (let i = 0; i < 70; i++) {
      const lx = Math.random() * 256;
      const lw = Math.random() * 4 + 1.5;
      ctx.fillStyle = i % 2 === 0 ? '#1b120c' : '#5d4037';
      ctx.fillRect(lx, 0, lw, 512);
    }

    // 树皮横向鳞片微断裂
    ctx.fillStyle = 'rgba(27, 18, 12, 0.4)';
    for (let i = 0; i < 300; i++) {
      ctx.fillRect(Math.random() * 256, Math.random() * 512, Math.random() * 18 + 4, 3);
    }

    // 微量苔藓青绿点缀
    ctx.fillStyle = 'rgba(46, 125, 50, 0.22)';
    for (let i = 0; i < 30; i++) {
      ctx.beginPath();
      ctx.arc(Math.random() * 256, Math.random() * 512, Math.random() * 12 + 4, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 4);
    this.barkTexture = tex;
    return tex;
  }

  /**
   * 8. 真实灵动清澈河流波光贴图 (水波法线与日光焦散碎波)
   */
  public static getWaterTexture(): THREE.CanvasTexture {
    if (this.waterTexture) return this.waterTexture;

    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext('2d')!;

    // 清澈山涧溪流渐变 (岸边碧蓝 -> 中央深邃蔚蓝)
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0, '#0284c7');
    grad.addColorStop(0.5, '#0369a1');
    grad.addColorStop(1, '#0284c7');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 流水波纹焦散高光弧线 (Caustics)
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.35)';
    ctx.lineWidth = 2.5;
    for (let i = 0; i < 90; i++) {
      const sx = Math.random() * 512;
      const sy = Math.random() * 512;
      const len = Math.random() * 45 + 20;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx + len * 0.3, sy + 6, sx + len * 0.7, sy - 6, sx + len, sy);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(4, 4);
    this.waterTexture = tex;
    return tex;
  }
}
