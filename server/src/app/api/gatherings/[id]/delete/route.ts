import { NextRequest, NextResponse } from 'next/server';
import { deleteGathering } from '@/lib/db';

// POST - 删除饭局（仅创建人可操作）
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { creatorId } = await request.json();

    if (!creatorId) {
      return NextResponse.json({ error: '缺少 creatorId' }, { status: 400 });
    }

    const success = deleteGathering(id, creatorId);
    if (!success) {
      return NextResponse.json({ error: '删除失败，仅创建人可删除' }, { status: 403 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: '删除失败' }, { status: 500 });
  }
}
