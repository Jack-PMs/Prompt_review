import { requireAdmin } from '@/server/auth';
import { failure, json, readJson } from '@/server/http';
import {
  getTencentCiConfig,
  getTencentCiHost,
  isTencentCiConfigured,
  reviewImagesWithTencentCi,
  reviewTextWithTencentCi,
  TencentReviewError,
} from '@/server/tencent/client';
import { AppError } from '@/server/validation';

export const runtime = 'nodejs';

/**
 * GET /api/review/tencent
 * 查询腾讯云数据万象 CI 内容审核配置状态（仅管理员可访问）。
 */
export async function GET(request: Request) {
  try {
    requireAdmin(request);
    const cfg = getTencentCiConfig();
    const host = getTencentCiHost(cfg);
    return json({
      provider: 'tencent-ci',
      configured: isTencentCiConfigured(),
      bucket: cfg.bucket || null,
      prefix: cfg.prefix || null,
      region: cfg.region || null,
      endpoint: host ? `https://${host}` : null,
      text_biz_type: cfg.textBizType || null,
      image_biz_type: cfg.imageBizType || null,
    });
  } catch (error) {
    return failure(error);
  }
}

/**
 * POST /api/review/tencent
 * 直接调用腾讯云数据万象 CI 同步审核（支持纯文本 / 单图或多图 / 图文并行审核）。
 * 请求体：{ text?: "待审核文本", image?: "data:image/...;base64,...", images?: ["..."], text_biz_type?: "", image_biz_type?: "" }
 */
export async function POST(request: Request) {
  try {
    requireAdmin(request);
    const body = await readJson(request, 12 * 1024 * 1024) as {
      text?: unknown;
      image?: unknown;
      images?: unknown;
      text_biz_type?: unknown;
      image_biz_type?: unknown;
    };
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const imageList: string[] = [];
    if (typeof body?.image === 'string' && body.image.trim()) imageList.push(body.image.trim());
    if (Array.isArray(body?.images)) {
      for (const item of body.images) {
        if (typeof item === 'string' && item.trim()) imageList.push(item.trim());
      }
    }
    if (!text && !imageList.length) {
      throw new AppError('INVALID_INPUT', 400, '请至少提供 text 或 image / images 参数');
    }

    const textBizType = typeof body?.text_biz_type === 'string' ? body.text_biz_type.trim() : undefined;
    const imageBizType = typeof body?.image_biz_type === 'string' ? body.image_biz_type.trim() : undefined;

    const [textResult, imageResults] = await Promise.all([
      text ? reviewTextWithTencentCi(text, { bizType: textBizType }) : Promise.resolve(null),
      imageList.length ? reviewImagesWithTencentCi(imageList, { bizType: imageBizType }) : Promise.resolve([]),
    ]);

    const suggestions = [
      ...(textResult ? [textResult.suggestion] : []),
      ...imageResults.map(r => r.suggestion),
    ];
    const action = suggestions.includes('block') ? 'BLOCK' : suggestions.includes('review') ? 'REVIEW' : 'ALLOW';

    return json({
      provider: 'tencent-ci',
      action,
      text_review: textResult,
      image_reviews: imageResults,
    });
  } catch (error) {
    if (error instanceof TencentReviewError) {
      const httpStatus = error.code === 'TENCENT_CI_UNAUTHORIZED' ? 403 : 502;
      return failure(new AppError(error.code, httpStatus, error.message));
    }
    return failure(error);
  }
}
