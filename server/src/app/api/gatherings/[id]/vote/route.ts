import { NextRequest, NextResponse } from 'next/server';
import { getGathering, voteRestaurant } from '@/lib/db';

// POST - 投票/取消投票
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { restaurantId, participantId } = body;

    console.log(`[vote] POST /vote gatheringId=${id} restaurantId=${restaurantId} participantId=${participantId}`);

    if (!restaurantId || !participantId) {
      console.log(`[vote] 400: 缺少参数 restaurantId=${restaurantId} participantId=${participantId}`);
      return NextResponse.json(
        { error: '缺少 restaurantId 或 participantId' },
        { status: 400 }
      );
    }

    const gathering = getGathering(id);
    if (!gathering) {
      console.log(`[vote] 404: 饭局 ${id} 不存在`);
      return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
    }

    if (gathering.status === 'confirmed') {
      console.log(`[vote] 400: 饭局 ${id} 已确认`);
      return NextResponse.json({ error: '饭局已确认，无法投票' }, { status: 400 });
    }

    // 确认餐厅在推荐列表中
    const validIds = (gathering.recommendedRestaurants || []).map(r => r.id);
    const isValidRestaurant = validIds.includes(restaurantId);
    if (!isValidRestaurant) {
      console.log(`[vote] 400: 餐厅 ${restaurantId} 不在推荐列表中。当前列表: [${validIds.join(', ')}]`);
      return NextResponse.json({ error: '餐厅不在推荐列表中，请刷新页面重试' }, { status: 400 });
    }

    const result = voteRestaurant(id, restaurantId, participantId);
    if (!result) {
      const participantIds = gathering.participants.map(p => p.id);
      console.log(`[vote] 400: 投票失败 participantId=${participantId} 不在参与者列表 [${participantIds.join(', ')}]`);
      return NextResponse.json({ error: '投票失败，请确认你是干饭人之一' }, { status: 400 });
    }

    // 投票数超限
    if (result.error) {
      console.log(`[vote] 400: ${result.error}`);
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    console.log(`[vote] 成功: voted=${result.voted}`);
    return NextResponse.json({
      voted: result.voted,
      votes: result.gathering.votes || {},
    });
  } catch (err) {
    console.error(`[vote] 500: 投票异常`, err);
    return NextResponse.json({ error: '投票失败' }, { status: 500 });
  }
}

// GET - 获取投票数据
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const gathering = getGathering(id);

    if (!gathering) {
      return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
    }

    return NextResponse.json({
      votes: gathering.votes || {},
    });
  } catch {
    return NextResponse.json({ error: '获取投票失败' }, { status: 500 });
  }
}
