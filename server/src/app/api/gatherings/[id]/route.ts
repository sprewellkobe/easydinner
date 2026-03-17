import { NextRequest, NextResponse } from 'next/server';
import { getGathering } from '@/lib/db';

// GET - 获取单个饭局
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const gathering = getGathering(id);

  if (!gathering) {
    return NextResponse.json({ error: '饭局不存在' }, { status: 404 });
  }

  return NextResponse.json({ gathering });
}
