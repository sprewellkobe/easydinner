'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'next/navigation';
import dynamic from 'next/dynamic';
import LocationPicker from '@/components/LocationPicker';
import { formatDistance } from '@/lib/geo';

const RestaurantMap = dynamic(() => import('@/components/RestaurantMap'), { ssr: false });

interface Location {
  name: string;
  lng: number;
  lat: number;
}

interface Participant {
  id: string;
  name: string;
  location: Location;
  joinedAt: string;
}

interface ParticipantDistance {
  participantId: string;
  participantName: string;
  distance: number;
}

interface Transportation {
  subway?: {
    station: string;
    line: string;
    distance: number;
  };
  taxi?: {
    estimatedCost: number;
    estimatedTime: number;
  };
  bus?: {
    routes: number;
    nearestStop: string;
    distance: number;
  };
}

interface RestaurantDetail {
  name: string;
  address: string;
  tel: string;
  rating: number;
  cost: number;
  openTime: string;
  photos: string[];
  tags: string[];
  tips: string[];
}

interface Restaurant {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
  category: string;
  rating?: number;
  avgDistance?: number;
  distanceToParticipants?: ParticipantDistance[];
  transportation?: Transportation;
}

interface Gathering {
  id: string;
  title: string;
  creatorId: string;
  creatorName: string;
  date: string;
  time: string;
  meal?: string;
  diningType?: 'light' | 'formal' | 'nightsnack' | 'any';
  participants: Participant[];
  recommendedRestaurants: Restaurant[];
  confirmedRestaurant: Restaurant | null;
  status: 'open' | 'confirmed';
  votes?: Record<string, string[]>; // 餐厅ID → 投票者participantID[]
}

const DINING_TYPE_LABELS: Record<string, { emoji: string; label: string }> = {
  light: { emoji: '☕', label: '轻餐' },
  formal: { emoji: '🍽️', label: '正餐' },
  nightsnack: { emoji: '🍢', label: '夜宵' },
  any: { emoji: '🎲', label: '不限' },
};

export default function GatheringPage() {
  const params = useParams();
  const gatheringId = params.id as string;

  const [gathering, setGathering] = useState<Gathering | null>(null);
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // 加入饭局的表单
  const [showJoinForm, setShowJoinForm] = useState(false);
  const [joinName, setJoinName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('yuefan_username') || '';
    }
    return '';
  });
  const [joinLocation, setJoinLocation] = useState<Location | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('yuefan_location');
      if (cached) {
        try { return JSON.parse(cached); } catch { /* ignore */ }
      }
    }
    return null;
  });
  const [isJoining, setIsJoining] = useState(false);

  // 选中的餐厅（默认第一个）
  const [selectedRestaurantId, setSelectedRestaurantId] = useState<string | null>(null);

  // 展开地图的餐厅
  const [expandedMapId, setExpandedMapId] = useState<string | null>(null);

  // 已确认餐厅的详情
  const [restaurantDetail, setRestaurantDetail] = useState<RestaurantDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // 确认饭局
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmingRestaurantId, setConfirmingRestaurantId] = useState<string | null>(null);

  // 分享
  const [copied, setCopied] = useState(false);

  // 投票
  const [votes, setVotes] = useState<Record<string, string[]>>({});
  const [votingId, setVotingId] = useState<string | null>(null); // 正在投票中的餐厅ID

  // 当前用户的 participantId
  const currentParticipantId = typeof window !== 'undefined'
    ? localStorage.getItem(`participant_${gatheringId}`) || ''
    : '';

  // 当前用户是否是创建者
  const isCreator = typeof window !== 'undefined'
    ? localStorage.getItem(`creator_${gatheringId}`) !== null
    : false;

  // 当前用户是否已参加
  const hasJoined = typeof window !== 'undefined'
    ? localStorage.getItem(`participant_${gatheringId}`) !== null
    : false;

  // 获取饭局详情
  const fetchGathering = useCallback(async () => {
    try {
      const res = await fetch(`/api/gatherings/${gatheringId}`);
      if (!res.ok) throw new Error('饭局不存在');
      const data = await res.json();
      setGathering(data.gathering);
      if (data.gathering.votes) {
        setVotes(data.gathering.votes);
      }
    } catch {
      setError('饭局不存在或已过期');
    } finally {
      setLoading(false);
    }
  }, [gatheringId]);

  // 获取餐厅推荐
  const fetchRecommendations = useCallback(async () => {
    try {
      const res = await fetch(`/api/gatherings/${gatheringId}/recommend`);
      const data = await res.json();
      if (data.restaurants) {
        setRestaurants(data.restaurants);
      }
    } catch (err) {
      console.error('获取推荐失败:', err);
    }
  }, [gatheringId]);

  useEffect(() => {
    fetchGathering();
  }, [fetchGathering]);

  // 饭局加载完成后获取推荐
  useEffect(() => {
    if (gathering && gathering.participants.length > 0) {
      fetchRecommendations();
    }
  }, [gathering?.participants.length, fetchRecommendations, gathering]);

  // 自动轮询：未确认状态下每 5 秒刷新数据，检测新参与者加入
  const participantCountRef = useRef(0);
  const gatheringStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (gathering) {
      participantCountRef.current = gathering.participants.length;
      gatheringStatusRef.current = gathering.status;
    }
  }, [gathering]);

  useEffect(() => {
    // 已确认则不轮询
    if (gatheringStatusRef.current === 'confirmed') return;

    const interval = setInterval(async () => {
      // 已确认时停止
      if (gatheringStatusRef.current === 'confirmed') {
        clearInterval(interval);
        return;
      }

      try {
        const res = await fetch(`/api/gatherings/${gatheringId}`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.gathering) {
          const newStatus = data.gathering.status;
          const newCount = data.gathering.participants.length;

          // 状态变为已确认，更新并停止轮询
          if (newStatus === 'confirmed') {
            setGathering(data.gathering);
            if (data.gathering.votes) setVotes(data.gathering.votes);
            gatheringStatusRef.current = 'confirmed';
            clearInterval(interval);
            return;
          }

          // 同步投票数据（每次都更新）
          if (data.gathering.votes) {
            setVotes(data.gathering.votes);
          }

          // 参与者数量变化：更新数据并刷新推荐
          if (newCount !== participantCountRef.current) {
            setGathering(data.gathering);
            participantCountRef.current = newCount;
            if (newCount > 0) {
              fetchRecommendations();
            }
          }
        }
      } catch {
        // 静默处理错误
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [gatheringId, fetchRecommendations]);

  // 已确认饭局 - 获取餐厅详情
  useEffect(() => {
    if (gathering?.status === 'confirmed' && gathering.confirmedRestaurant && !restaurantDetail) {
      const r = gathering.confirmedRestaurant;
      setLoadingDetail(true);
      fetch(`/api/restaurant-detail?name=${encodeURIComponent(r.name)}&lng=${r.lng}&lat=${r.lat}`)
        .then(res => res.json())
        .then(data => {
          if (data.detail) setRestaurantDetail(data.detail);
        })
        .catch(() => {})
        .finally(() => setLoadingDetail(false));
    }
  }, [gathering?.status, gathering?.confirmedRestaurant, restaurantDetail]);

  // 加入饭局
  const handleJoin = async () => {
    if (!joinName.trim() || !joinLocation) return;

    setIsJoining(true);
    try {
      const res = await fetch(`/api/gatherings/${gatheringId}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: joinName,
          location: joinLocation,
        }),
      });

      const data = await res.json();
      if (data.gathering) {
        localStorage.setItem('yuefan_username', joinName.trim());
        if (joinLocation) {
          localStorage.setItem('yuefan_location', JSON.stringify(joinLocation));
        }
        localStorage.setItem(`participant_${gatheringId}`, data.participantId);
        setGathering(data.gathering);
        setShowJoinForm(false);
        setJoinLocation(null);
        // 重新获取推荐
        setTimeout(fetchRecommendations, 300);
      } else {
        alert(data.error || '加入失败');
      }
    } catch {
      alert('加入失败，请重试');
    } finally {
      setIsJoining(false);
    }
  };

  // 投票
  const handleVote = async (restaurantId: string) => {
    if (!currentParticipantId || votingId) return;
    setVotingId(restaurantId);
    try {
      const res = await fetch(`/api/gatherings/${gatheringId}/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurantId, participantId: currentParticipantId }),
      });
      const data = await res.json();
      if (data.votes) {
        setVotes(data.votes);
      }
    } catch (err) {
      console.error('投票失败:', err);
    } finally {
      setVotingId(null);
    }
  };

  // 确认饭局
  const handleConfirm = async (restaurant: Restaurant) => {
    if (!isCreator) return;

    // 两段式确认：第一次点击进入确认状态，第二次点击才提交
    if (confirmingRestaurantId !== restaurant.id) {
      setConfirmingRestaurantId(restaurant.id);
      // 5秒后自动取消确认状态
      setTimeout(() => setConfirmingRestaurantId(prev => prev === restaurant.id ? null : prev), 5000);
      return;
    }

    setIsConfirming(true);
    setConfirmingRestaurantId(null);
    try {
      const creatorId = localStorage.getItem(`creator_${gatheringId}`);
      const res = await fetch(`/api/gatherings/${gatheringId}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId,
          restaurant,
        }),
      });

      const data = await res.json();
      if (data.gathering) {
        setGathering(data.gathering);
      } else {
        alert(data.error || '确认失败');
      }
    } catch {
      alert('确认失败，请重试');
    } finally {
      setIsConfirming(false);
    }
  };

  // 复制分享链接
  const handleShare = async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const input = document.createElement('input');
      input.value = url;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">加载中...</p>
        </div>
      </div>
    );
  }

  if (error || !gathering) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4">
        <div className="text-center">
          <div className="text-6xl mb-4">😅</div>
          <h2 className="text-xl font-bold text-gray-700 mb-2">找不到这个饭局</h2>
          <p className="text-gray-500 mb-6">{error || '饭局可能已过期或链接有误'}</p>
          <a href="/" className="text-orange-500 font-medium hover:underline">
            回到首页 →
          </a>
        </div>
      </div>
    );
  }

  const isConfirmed = gathering.status === 'confirmed';

  return (
    <div className="min-h-screen px-4 py-6 max-w-lg mx-auto">
      {/* 返回按钮 */}
      <a
        href="/"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-orange-500 mb-3 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        返回首页
      </a>

      {/* 头部信息 */}
      <div className="bg-white rounded-3xl shadow-sm p-6 mb-4 animate-fade-in-up">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-2xl">🍽️</span>
              <h1 className="text-xl font-bold text-gray-800">{gathering.title}</h1>
            </div>
            <p className="text-sm text-gray-500">
              {gathering.creatorName} 发起
              {gathering.date && ` · ${gathering.date}`}
              {gathering.meal ? ` ${gathering.meal === '午饭' ? '☀️' : gathering.meal === '晚饭' ? '🌅' : '🕐'} ${gathering.meal} ${gathering.time || ''}` : gathering.time && ` ${gathering.time}`}
              {gathering.diningType && gathering.diningType !== 'any' && ` · ${DINING_TYPE_LABELS[gathering.diningType]?.emoji || ''} ${DINING_TYPE_LABELS[gathering.diningType]?.label || ''}`}
            </p>
          </div>
          <div className={`px-3 py-1 rounded-full text-xs font-medium ${
            isConfirmed
              ? 'bg-green-100 text-green-700'
              : 'bg-orange-100 text-orange-700'
          }`}>
            {isConfirmed ? '✅ 已确认' : '🔥 进行中'}
          </div>
        </div>

        {/* 分享按钮 */}
        {!isConfirmed && (
          <button
            onClick={handleShare}
            className="mt-4 w-full flex items-center justify-center gap-2 py-2.5 bg-gray-50 hover:bg-gray-100 rounded-xl text-gray-600 text-sm font-medium transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                链接已复制！
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z" />
                </svg>
                分享给朋友
              </>
            )}
          </button>
        )}
      </div>

      {/* 已确认的地点 */}
      {isConfirmed && gathering.confirmedRestaurant && (
        <div className="bg-white rounded-3xl shadow-sm mb-4 overflow-hidden animate-fade-in-up">
          {/* 顶部绿色横幅 */}
          <div className="bg-gradient-to-br from-green-500 to-emerald-600 p-5 text-white">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-2xl">🎉</span>
              <h2 className="text-lg font-bold">聚餐地点已确认！</h2>
            </div>
            <h3 className="text-2xl font-bold">{gathering.confirmedRestaurant.name}</h3>
            <div className="flex items-center gap-1.5 mt-1 text-white/80 text-sm">
              <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span>{gathering.confirmedRestaurant.address}</span>
            </div>
          </div>

          {/* 地图 */}
          <div className="px-4 pt-4">
            <RestaurantMap
              restaurant={{
                name: gathering.confirmedRestaurant.name,
                lng: gathering.confirmedRestaurant.lng,
                lat: gathering.confirmedRestaurant.lat,
              }}
              participants={gathering.participants.map(p => ({
                id: p.id,
                name: p.name,
                lng: p.location.lng,
                lat: p.location.lat,
              }))}
              distanceToParticipants={gathering.confirmedRestaurant.distanceToParticipants}
            />
          </div>

          {/* 基础信息标签栏 */}
          <div className="px-5 pt-4 pb-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-full font-medium">
                {gathering.confirmedRestaurant.category}
              </span>
              {(restaurantDetail?.rating || gathering.confirmedRestaurant.rating) ? (
                <span className="text-xs bg-yellow-100 text-yellow-700 px-2.5 py-1 rounded-full font-medium flex items-center gap-0.5">
                  ⭐ {((restaurantDetail?.rating || gathering.confirmedRestaurant.rating) ?? 0).toFixed(1)}
                </span>
              ) : null}
              {restaurantDetail?.cost ? (
                <span className="text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-full font-medium">
                  💰 人均 ¥{restaurantDetail.cost.toFixed(0)}
                </span>
              ) : null}
              {gathering.confirmedRestaurant.avgDistance && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-full font-medium">
                  📍 平均 {formatDistance(gathering.confirmedRestaurant.avgDistance)}
                </span>
              )}
            </div>

            {/* 风味标签 */}
            {restaurantDetail?.tags && restaurantDetail.tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {restaurantDetail.tags.map((tag, i) => (
                  <span key={i} className="text-xs bg-purple-50 text-purple-600 px-2 py-0.5 rounded-full">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* 交通信息 */}
          {gathering.confirmedRestaurant.transportation && (
            <div className="px-5 pb-2">
              <div className="flex flex-wrap items-center gap-2 mt-1">
                {gathering.confirmedRestaurant.transportation.subway ? (
                  <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                    🚇 {gathering.confirmedRestaurant.transportation.subway.station}
                    <span className="text-blue-400">{formatDistance(gathering.confirmedRestaurant.transportation.subway.distance)}</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-lg">
                    🚇 无地铁
                  </span>
                )}
                {gathering.confirmedRestaurant.transportation.taxi && (
                  <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${
                    gathering.confirmedRestaurant.transportation.taxi.estimatedCost <= 15
                      ? 'bg-green-50 text-green-700'
                      : gathering.confirmedRestaurant.transportation.taxi.estimatedCost <= 20
                        ? 'bg-yellow-50 text-yellow-700'
                        : 'bg-red-50 text-red-600'
                  }`}>
                    🚕 {gathering.confirmedRestaurant.transportation.taxi.estimatedCost <= 15 ? '好打车' : gathering.confirmedRestaurant.transportation.taxi.estimatedCost <= 20 ? '较好打车' : '不好打车'}
                  </span>
                )}
                {gathering.confirmedRestaurant.transportation.bus && gathering.confirmedRestaurant.transportation.bus.routes > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-lg">
                    🚌 {gathering.confirmedRestaurant.transportation.bus.routes}条公交
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 联系电话 */}
          {restaurantDetail?.tel && (
            <div className="px-5 pb-2">
              <a
                href={`tel:${restaurantDetail.tel.split(';')[0]}`}
                className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {restaurantDetail.tel}
              </a>
            </div>
          )}

          {/* 营业时间 */}
          {restaurantDetail?.openTime && (
            <div className="px-5 pb-2">
              <span className="text-xs text-gray-500 flex items-center gap-1">
                🕐 {restaurantDetail.openTime}
              </span>
            </div>
          )}

          {/* 每个参与者的距离 */}
          {gathering.confirmedRestaurant.distanceToParticipants && gathering.confirmedRestaurant.distanceToParticipants.length > 0 && (
            <div className="px-5 pb-3">
              <div className="mt-2 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-2">📏 各参与者距离</p>
                <div className="space-y-1.5">
                  {gathering.confirmedRestaurant.distanceToParticipants.map((pd, pIdx) => {
                    const maxDist = Math.max(...(gathering.confirmedRestaurant?.distanceToParticipants?.map(d => d.distance) || [1]));
                    const pct = maxDist > 0 ? Math.max(8, (pd.distance / maxDist) * 100) : 50;
                    const distKm = pd.distance / 1000;
                    const barColor = distKm < 2 ? 'bg-green-400' : distKm < 5 ? 'bg-yellow-400' : 'bg-red-400';
                    const textColor = distKm < 2 ? 'text-green-600' : distKm < 5 ? 'text-yellow-600' : 'text-red-500';

                    return (
                      <div key={pd.participantId} className="flex items-center gap-2">
                        <span className={`text-xs font-medium shrink-0 w-12 truncate ${
                          pIdx === 0 ? 'text-orange-600' : 'text-blue-600'
                        }`}>
                          {pd.participantName}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${barColor} transition-all`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <span className={`text-xs font-medium shrink-0 w-12 text-right ${textColor}`}>
                          {formatDistance(pd.distance)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 温馨提示 */}
          {restaurantDetail?.tips && restaurantDetail.tips.length > 0 && (
            <div className="px-5 pb-5">
              <div className="bg-amber-50 rounded-xl p-3.5">
                <p className="text-xs font-medium text-amber-700 mb-1.5">📋 温馨提示</p>
                <div className="space-y-1">
                  {restaurantDetail.tips.map((tip, i) => (
                    <p key={i} className="text-xs text-amber-600">{tip}</p>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* 加载中 */}
          {loadingDetail && (
            <div className="px-5 pb-4 flex items-center justify-center gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
              加载餐厅详情...
            </div>
          )}
        </div>
      )}

      {/* 参与人列表 */}
      <div className="bg-white rounded-3xl shadow-sm p-6 mb-4 animate-fade-in-up-delay-1">
        <h2 className="text-lg font-bold text-gray-800 mb-4 flex items-center gap-2">
          <span>👥</span>
          参与人 ({gathering.participants.length})
        </h2>
        <div className="space-y-3">
          {gathering.participants.map((p, idx) => (
            <div
              key={p.id}
              className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl"
            >
              <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${
                idx === 0 ? 'bg-gradient-to-br from-orange-500 to-red-500' : 'bg-gradient-to-br from-blue-500 to-purple-500'
              }`}>
                {p.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-gray-800">{p.name}</span>
                  {idx === 0 && (
                    <span className="text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">发起人</span>
                  )}
                </div>
                <div className="text-sm text-gray-500 flex items-center gap-1 truncate">
                  <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  {p.location.name}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 加入按钮 */}
        {!isConfirmed && !hasJoined && !showJoinForm && (
          <button
            onClick={() => setShowJoinForm(true)}
            className="mt-4 w-full py-3 border-2 border-dashed border-orange-300 text-orange-500 rounded-xl font-medium hover:bg-orange-50 transition-colors"
          >
            + 我也要参加
          </button>
        )}

        {/* 加入表单 */}
        {!isConfirmed && showJoinForm && (
          <div className="mt-4 p-4 bg-orange-50 rounded-xl space-y-3 overflow-visible">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">你的名字</label>
              <input
                type="text"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
                placeholder="输入你的名字"
                className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">你希望在什么地点附近</label>
              <LocationPicker
                value={joinLocation}
                onChange={setJoinLocation}
                placeholder="搜索你方便的地点"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setShowJoinForm(false);
                  setJoinLocation(null);
                }}
                className="flex-1 py-2.5 bg-white border border-gray-200 text-gray-600 rounded-xl font-medium hover:bg-gray-50 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleJoin}
                disabled={!joinName.trim() || !joinLocation || isJoining}
                className="flex-1 py-2.5 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-xl font-medium shadow-lg shadow-orange-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isJoining ? '加入中...' : '确认加入'}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 餐厅推荐 */}
      {!isConfirmed && restaurants.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm p-6 mb-4 animate-fade-in-up-delay-2">
          <h2 className="text-lg font-bold text-gray-800 mb-1 flex items-center gap-2">
            <span>🏆</span>
            推荐餐厅
          </h2>
          <p className="text-sm text-gray-500 mb-4">
            {hasJoined ? '👆 点击投票选出你中意的餐厅，票数最多排最前' : '根据所有人位置智能推荐，距离大家都最近'}
          </p>

          <div className="space-y-4">
            {[...restaurants]
              .sort((a, b) => {
                const votesA = (votes[a.id] || []).length;
                const votesB = (votes[b.id] || []).length;
                return votesB - votesA; // 票多的排前面
              })
              .map((r, idx) => {
              // 投票相关
              const restaurantVotes = votes[r.id] || [];
              const voteCount = restaurantVotes.length;
              const hasVoted = currentParticipantId ? restaurantVotes.includes(currentParticipantId) : false;

              // 找出最远和最近参与者的距离（用于进度条百分比）
              const maxParticipantDist = r.distanceToParticipants
                ? Math.max(...r.distanceToParticipants.map(d => d.distance))
                : 0;

              const isSelected = selectedRestaurantId ? selectedRestaurantId === r.id : idx === 0;

              return (
                <div
                  key={r.id}
                  onClick={() => setSelectedRestaurantId(r.id)}
                  className={`relative p-4 rounded-2xl border-2 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-orange-300 bg-orange-50'
                      : 'border-gray-100 bg-gray-50 hover:border-gray-200'
                  }`}
                >
                  {/* 排名标记 */}
                  <div className={`absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
                    isSelected
                      ? 'bg-gradient-to-br from-orange-500 to-red-500 text-white'
                      : 'bg-gray-200 text-gray-600'
                  }`}>
                    {idx + 1}
                  </div>

                  {/* 顶部：名称行 + 投票按钮 */}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-gray-800 flex items-center gap-1.5 min-w-0">
                      <a
                        href={`https://uri.amap.com/search?keyword=${encodeURIComponent(r.name)}&center=${r.lng},${r.lat}&radius=1000&src=yuefan`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="hover:text-orange-500 transition-colors underline decoration-gray-300 underline-offset-2 hover:decoration-orange-400 truncate"
                      >
                        {r.name}
                      </a>
                      <svg className="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                      </svg>
                    </h3>

                    {/* 投票按钮 - 固定在右上角 */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {hasJoined && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleVote(r.id);
                          }}
                          disabled={!!votingId}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-sm font-medium transition-all ${
                            hasVoted
                              ? 'bg-orange-100 text-orange-600 border-2 border-orange-300 shadow-sm'
                              : 'bg-gray-100 text-gray-500 border-2 border-transparent hover:bg-gray-200'
                          } ${votingId === r.id ? 'opacity-50' : ''}`}
                        >
                          <span>{hasVoted ? '👍' : '👆'}</span>
                          <span>{voteCount > 0 ? voteCount : ''}</span>
                          <span className="text-xs">{hasVoted ? '已投' : '投票'}</span>
                        </button>
                      )}
                      {!hasJoined && voteCount > 0 && (
                        <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                          👍 {voteCount}票
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 地址 */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedMapId(expandedMapId === r.id ? null : r.id);
                    }}
                    className="text-sm text-gray-500 mt-1 flex items-center gap-1 hover:text-orange-500 transition-colors max-w-full"
                  >
                    <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span className="truncate">{r.address}</span>
                    <svg className={`w-3 h-3 shrink-0 transition-transform ${expandedMapId === r.id ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* 标签行 + 确认按钮 */}
                  <div className="flex items-center justify-between mt-2 gap-2">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                        {r.category}
                      </span>
                      {r.rating && r.rating > 0 && (
                        <span className="text-xs text-yellow-600 flex items-center gap-0.5">
                          ⭐ {r.rating.toFixed(1)}
                        </span>
                      )}
                      {r.avgDistance && (
                        <span className="text-xs text-gray-500">
                          平均 {formatDistance(r.avgDistance)}
                        </span>
                      )}
                    </div>

                    {/* 确认按钮 - 只有创建者可见 */}
                    {isCreator && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleConfirm(r);
                        }}
                        disabled={isConfirming}
                        className={`shrink-0 px-4 py-2 text-white text-sm rounded-xl font-medium shadow-md hover:shadow-lg transition-all disabled:opacity-50 ${
                          confirmingRestaurantId === r.id
                            ? 'bg-gradient-to-r from-green-500 to-emerald-600 animate-pulse'
                            : 'bg-gradient-to-r from-orange-500 to-red-500'
                        }`}
                      >
                        {isConfirming ? '确认中...' : confirmingRestaurantId === r.id ? '确认？' : '就这了'}
                      </button>
                    )}
                  </div>

                  {/* 交通便利度标签 */}
                  {r.transportation && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {r.transportation.subway ? (
                        <span className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-1 rounded-lg">
                          🚇 {r.transportation.subway.station}
                          <span className="text-blue-400">{formatDistance(r.transportation.subway.distance)}</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-500 px-2 py-1 rounded-lg">
                          🚇 无地铁
                        </span>
                      )}
                      {r.transportation.taxi && (
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${
                          r.transportation.taxi.estimatedCost <= 15
                            ? 'bg-green-50 text-green-700'
                            : r.transportation.taxi.estimatedCost <= 20
                              ? 'bg-yellow-50 text-yellow-700'
                              : 'bg-red-50 text-red-600'
                        }`}>
                          🚕 {r.transportation.taxi.estimatedCost <= 15 ? '好打车' : r.transportation.taxi.estimatedCost <= 20 ? '较好打车' : '不好打车'}
                        </span>
                      )}
                      {r.transportation.bus && r.transportation.bus.routes > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs bg-purple-50 text-purple-700 px-2 py-1 rounded-lg">
                          🚌 {r.transportation.bus.routes}条公交
                        </span>
                      )}
                    </div>
                  )}

                  {/* 展开的地图 */}
                  {expandedMapId === r.id && gathering && (
                    <RestaurantMap
                      restaurant={{ name: r.name, lng: r.lng, lat: r.lat }}
                      participants={gathering.participants.map(p => ({
                        id: p.id,
                        name: p.name,
                        lng: p.location.lng,
                        lat: p.location.lat,
                      }))}
                      distanceToParticipants={r.distanceToParticipants}
                    />
                  )}

                  {/* 每个参与者的距离 */}
                  {r.distanceToParticipants && r.distanceToParticipants.length > 1 && (
                    <div className="mt-3 pt-3 border-t border-gray-200/60">
                      <p className="text-xs text-gray-400 mb-2">各参与者距离</p>
                      <div className="space-y-1.5">
                        {r.distanceToParticipants.map((pd, pIdx) => {
                          const pct = maxParticipantDist > 0
                            ? Math.max(8, (pd.distance / maxParticipantDist) * 100)
                            : 50;
                          const distKm = pd.distance / 1000;
                          // 距离颜色：<2km 绿色, 2-5km 黄色, >5km 红色
                          const barColor = distKm < 2
                            ? 'bg-green-400'
                            : distKm < 5
                              ? 'bg-yellow-400'
                              : 'bg-red-400';
                          const textColor = distKm < 2
                            ? 'text-green-600'
                            : distKm < 5
                              ? 'text-yellow-600'
                              : 'text-red-500';

                          return (
                            <div key={pd.participantId} className="flex items-center gap-2">
                              <span className={`text-xs font-medium shrink-0 w-12 truncate ${
                                pIdx === 0 ? 'text-orange-600' : 'text-blue-600'
                              }`}>
                                {pd.participantName}
                              </span>
                              <div className="flex-1 min-w-0">
                                <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${barColor} transition-all`}
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                              <span className={`text-xs font-medium shrink-0 w-12 text-right ${textColor}`}>
                                {formatDistance(pd.distance)}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {!isCreator && hasJoined && (
            <p className="mt-4 text-center text-sm text-gray-400">
              投票选出你喜欢的，等待 {gathering.creatorName} 确认最终地点
            </p>
          )}
          {!isCreator && !hasJoined && (
            <p className="mt-4 text-center text-sm text-gray-400">
              加入饭局后可以投票，等待 {gathering.creatorName} 确认最终地点
            </p>
          )}
        </div>
      )}

      {/* 等待更多人加入提示 */}
      {!isConfirmed && restaurants.length === 0 && gathering.participants.length >= 1 && (
        <div className="bg-white rounded-3xl shadow-sm p-6 mb-4 text-center animate-fade-in-up-delay-2">
          <div className="text-4xl mb-3">🤔</div>
          <h3 className="font-bold text-gray-700 mb-1">正在计算推荐餐厅...</h3>
          <p className="text-sm text-gray-500">分享链接邀请更多朋友加入，推荐会更精准</p>
        </div>
      )}

      {/* 底部信息 */}
      <div className="text-center py-4">
        <a href="/" className="text-sm text-gray-400 hover:text-orange-500 transition-colors">
          约饭 - 让聚餐不再纠结
        </a>
      </div>
    </div>
  );
}
