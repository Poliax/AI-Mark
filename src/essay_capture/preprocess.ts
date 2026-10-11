import sharp from 'sharp';
import type { AppConfig } from '../config/schema.js';

/**
 * 作文图像预处理（§5）—— 只把作文区域发给视觉模型，绝不发整页。
 * 增强：灰度 → 对比度线性拉伸 → 锐化 → 限制最长边。
 */
export async function preprocessImage(buffer: Buffer, cfg: AppConfig['capture']): Promise<Buffer> {
  let img = sharp(buffer).rotate(); // 自动纠正 EXIF 方向
  const meta = await img.metadata();
  const longest = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (longest > cfg.maxDimension) {
    img = img.resize({
      width: cfg.maxDimension,
      height: cfg.maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  if (cfg.grayscale) {
    img = img.grayscale();
  }
  // 线性对比度拉伸: out = in * boost + 128*(1-boost)
  img = img.linear(cfg.contrastBoost, 128 * (1 - cfg.contrastBoost));
  if (cfg.sharpen) {
    img = img.sharpen({ sigma: 1 });
  }
  return img.png().toBuffer();
}
