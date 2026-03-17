import { NextRequest, NextResponse } from 'next/server';
import { createGathering, getAllGatherings, cleanupExpiredGatherings } from '@/lib/db';
import { generateId, generateParticipantId } from '@/lib/utils';

// POST - 创建饭局
export async function POST(request: NextRequest) {
  try {
    // 每次创建时顺带清理过期饭局
    cleanupExpiredGatherings();

    const body = await request.json();
    const { title, creatorName, date, time, meal, diningType, location } = body;

    if (!title || !creatorName || !location) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 校验名字长度：1-8字
    const trimmedName = String(creatorName).trim();
    if (trimmedName.length < 1 || trimmedName.length > 8) {
      return NextResponse.json({ error: '名字长度需要1-8个字' }, { status: 400 });
    }

    // 校验饭局时间不能早于当前时间
    if (date && time) {
      const gatheringTime = new Date(`${date}T${time}:00`);
      if (!isNaN(gatheringTime.getTime()) && gatheringTime.getTime() <= Date.now()) {
        return NextResponse.json({ error: '饭局时间不能早于当前时间' }, { status: 400 });
      }
    }

    const gatheringId = generateId();
    const creatorId = generateParticipantId();

    const gathering = createGathering({
      id: gatheringId,
      title,
      creatorId,
      creatorName: trimmedName,
      date: date || '',
      time: time || '',
      meal: meal || '',
      diningType: diningType || undefined,
      participants: [
        {
          id: creatorId,
          name: trimmedName,
          location,
          joinedAt: new Date().toISOString(),
        },
      ],
      recommendedRestaurants: [],
      confirmedRestaurant: null,
      status: 'open',
      createdAt: new Date().toISOString(),
    });

    return NextResponse.json({ gathering, creatorId }, { status: 201 });
  } catch {
    return NextResponse.json({ error: '创建失败' }, { status: 500 });
  }
}

// GET - 获取所有饭局
export async function GET() {
  const gatherings = getAllGatherings();
  return NextResponse.json({ gatherings });
}
