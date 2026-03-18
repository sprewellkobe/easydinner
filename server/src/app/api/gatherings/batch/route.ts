import { NextRequest, NextResponse } from 'next/server';
import { getGatheringsByIds } from '@/lib/db';

// POST /api/gatherings/batch - 批量获取饭局详情
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { ids } = body;

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: '缺少 ids 参数' }, { status: 400 });
    }

    // 验证所有 id 都是字符串
    if (!ids.every((id: unknown) => typeof id === 'string')) {
      return NextResponse.json({ error: 'ids 必须是字符串数组' }, { status: 400 });
    }

    const gatherings = getGatheringsByIds(ids);

    return NextResponse.json({ gatherings });
  } catch {
    return NextResponse.json({ error: '查询失败' }, { status: 500 });
  }
}
