import { NextRequest, NextResponse } from 'next/server';
import { getGathering, confirmGathering } from '@/lib/db';

// POST - 确认饭局地点
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { creatorId, restaurant, restaurantId } = body;

    if (!creatorId || (!restaurant && !restaurantId)) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    const gathering = getGathering(id);
    if (!gathering) {
      return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
    }

    if (gathering.creatorId !== creatorId) {
      return NextResponse.json({ error: '只有发起人可以确认饭局' }, { status: 403 });
    }

    if (gathering.status === 'confirmed') {
      return NextResponse.json({ error: '饭局已确认' }, { status: 400 });
    }

    // 支持通过 restaurantId 从推荐列表中查找
    const finalRestaurant = restaurant || gathering.recommendedRestaurants.find(r => r.id === restaurantId);
    if (!finalRestaurant) {
      return NextResponse.json({ error: '找不到该餐厅' }, { status: 404 });
    }

    const updated = confirmGathering(id, finalRestaurant);
    if (!updated) {
      return NextResponse.json({ error: '确认失败' }, { status: 500 });
    }

    return NextResponse.json({ gathering: updated });
  } catch {
    return NextResponse.json({ error: '确认失败' }, { status: 500 });
  }
}
