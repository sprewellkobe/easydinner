import { NextRequest, NextResponse } from 'next/server';
import { getGathering, addParticipant } from '@/lib/db';
import { generateParticipantId } from '@/lib/utils';
import { haversineDistance } from '@/lib/geo';

const MAX_JOIN_DISTANCE = 100_000; // 最大加入距离：100公里

// POST - 加入饭局
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, location } = body;

    if (!name || !location) {
      return NextResponse.json({ error: '缺少必填字段' }, { status: 400 });
    }

    // 校验名字长度：1-8字
    const trimmedName = String(name).trim();
    if (trimmedName.length < 1 || trimmedName.length > 8) {
      return NextResponse.json({ error: '名字长度需要1-8个字' }, { status: 400 });
    }

    const gathering = getGathering(id);
    if (!gathering) {
      return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
    }

    if (gathering.status === 'confirmed') {
      return NextResponse.json({ error: '饭局已确认，不能再加入' }, { status: 403 });
    }

    // 距离保护：检查参与者位置是否离饭局创建者太远（100km以内）
    if (gathering.participants.length > 0) {
      const creatorLocation = gathering.participants[0].location;
      const distance = haversineDistance(
        { lng: location.lng, lat: location.lat },
        { lng: creatorLocation.lng, lat: creatorLocation.lat }
      );

      if (distance > MAX_JOIN_DISTANCE) {
        const distKm = Math.round(distance / 1000);
        return NextResponse.json(
          { error: `你选择的位置距离饭局发起人约${distKm}公里，超出了100公里的范围，请确认位置是否正确` },
          { status: 400 }
        );
      }
    }

    const participantId = generateParticipantId();
    const updated = addParticipant(id, {
      id: participantId,
      name: trimmedName,
      location,
      joinedAt: new Date().toISOString(),
    });

    if (!updated) {
      return NextResponse.json({ error: '加入失败' }, { status: 500 });
    }

    return NextResponse.json({ gathering: updated, participantId });
  } catch {
    return NextResponse.json({ error: '加入失败' }, { status: 500 });
  }
}
