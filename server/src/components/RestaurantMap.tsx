'use client';

import { useEffect, useRef, useCallback } from 'react';
import { formatDistance } from '@/lib/geo';

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ParticipantLocation {
  id: string;
  name: string;
  lng: number;
  lat: number;
}

interface RestaurantMapProps {
  restaurant: {
    name: string;
    lng: number;
    lat: number;
  };
  participants: ParticipantLocation[];
  distanceToParticipants?: {
    participantId: string;
    participantName: string;
    distance: number;
  }[];
}

let leafletLoaded = false;
let leafletLoadPromise: Promise<void> | null = null;

function loadLeaflet(): Promise<void> {
  if (leafletLoaded && (window as any).L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => {
      leafletLoaded = true;
      resolve();
    };
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });

  return leafletLoadPromise;
}

// 参与者颜色列表（冷色调为主，避免与地图道路黄色冲突）
const PARTICIPANT_COLORS = [
  '#3B82F6', // blue-500
  '#8B5CF6', // purple-500
  '#10B981', // emerald-500
  '#EC4899', // pink-500
  '#6366F1', // indigo-500
  '#14B8A6', // teal-500
  '#06B6D4', // cyan-500
  '#D946EF', // fuchsia-500
];

export default function RestaurantMap({ restaurant, participants, distanceToParticipants }: RestaurantMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const initDoneRef = useRef(false);

  const initMap = useCallback(async () => {
    if (initDoneRef.current) return;
    try {
      await loadLeaflet();
      const L = (window as any).L;
      if (!mapContainerRef.current || !L) return;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      // 计算所有点的范围，自动调整视图
      const allPoints: [number, number][] = [
        [restaurant.lat, restaurant.lng],
        ...participants.map(p => [p.lat, p.lng] as [number, number]),
      ];

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // 高德矢量瓦片
      L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: '1234',
        maxZoom: 18,
      }).addTo(map);

      mapRef.current = map;
      initDoneRef.current = true;

      // 自适应视图范围
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });

      // --- 餐厅标记 ---
      const restaurantIcon = L.divIcon({
        className: 'custom-marker',
        html: `<div style="
          width: 38px; height: 38px;
          background: linear-gradient(135deg, #DC2626, #B91C1C);
          border-radius: 50%;
          border: 3px solid white;
          box-shadow: 0 2px 10px rgba(220,38,38,0.4);
          display: flex; align-items: center; justify-content: center;
          font-size: 18px;
        ">🍽️</div>`,
        iconSize: [38, 38],
        iconAnchor: [19, 19],
      });

      L.marker([restaurant.lat, restaurant.lng], { icon: restaurantIcon })
        .addTo(map)
        .bindTooltip(restaurant.name, {
          permanent: true,
          direction: 'top',
          offset: [0, -22],
          className: 'restaurant-tooltip',
        });

      // --- 参与者标记 + 虚线 ---
      participants.forEach((p, idx) => {
        const color = PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length];

        // 查找该参与者到餐厅的距离
        const distInfo = distanceToParticipants?.find(
          d => d.participantId === p.id || d.participantName === p.name
        );
        const distLabel = distInfo ? formatDistance(distInfo.distance) : '';

        // 参与者图标：小圆点 + 全名标签
        const nameLength = p.name.length;
        const labelWidth = Math.max(40, nameLength * 14 + 16);
        const participantIcon = L.divIcon({
          className: 'custom-marker',
          html: `<div style="
            display: flex; align-items: center; gap: 0;
            pointer-events: auto;
          ">
            <div style="
              width: 14px; height: 14px;
              background: ${color};
              border-radius: 50%;
              border: 2.5px solid white;
              box-shadow: 0 1px 4px rgba(0,0,0,0.25);
              flex-shrink: 0;
            "></div>
            <div style="
              background: ${color};
              color: white;
              font-size: 11px;
              font-weight: 600;
              padding: 2px 8px;
              border-radius: 10px;
              white-space: nowrap;
              margin-left: -3px;
              box-shadow: 0 1px 4px rgba(0,0,0,0.15);
              line-height: 1.3;
            ">${p.name}</div>
          </div>`,
          iconSize: [labelWidth, 20],
          iconAnchor: [7, 10],
        });

        L.marker([p.lat, p.lng], { icon: participantIcon }).addTo(map);

        // 虚线连接参与者到餐厅
        const polyline = L.polyline(
          [[p.lat, p.lng], [restaurant.lat, restaurant.lng]],
          {
            color: color,
            weight: 2,
            opacity: 0.5,
            dashArray: '6, 8',
          }
        ).addTo(map);

        // 在虚线中点显示距离标签（白底+彩色文字，更清晰）
        if (distLabel) {
          const midLat = (p.lat + restaurant.lat) / 2;
          const midLng = (p.lng + restaurant.lng) / 2;

          const distMarker = L.divIcon({
            className: 'dist-label',
            html: `<div style="
              background: white;
              color: ${color};
              font-size: 10px;
              font-weight: 700;
              padding: 1px 6px;
              border-radius: 8px;
              white-space: nowrap;
              border: 1.5px solid ${color};
              box-shadow: 0 1px 3px rgba(0,0,0,0.1);
              line-height: 1.4;
            ">${distLabel}</div>`,
            iconSize: [0, 0],
            iconAnchor: [0, 0],
          });

          L.marker([midLat, midLng], { icon: distMarker, interactive: false }).addTo(map);
        }

        // 鼠标悬停高亮虚线
        polyline.on('mouseover', () => {
          polyline.setStyle({ weight: 4, opacity: 1 });
        });
        polyline.on('mouseout', () => {
          polyline.setStyle({ weight: 2, opacity: 0.5 });
        });
      });

      setTimeout(() => map.invalidateSize(), 200);
    } catch (err) {
      console.error('地图初始化失败:', err);
    }
  }, [restaurant, participants, distanceToParticipants]);

  useEffect(() => {
    const timer = setTimeout(initMap, 100);
    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        initDoneRef.current = false;
      }
    };
  }, [initMap]);

  return (
    <div className="mt-3 rounded-xl overflow-hidden border border-gray-200 relative" style={{ height: '220px' }}>
      <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
      {/* 图例 */}
      <div className="absolute bottom-2 left-2 z-[1000] bg-white/90 backdrop-blur rounded-lg px-2.5 py-1.5 text-[10px] flex flex-col gap-0.5 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span>🍽️</span>
          <span className="text-gray-600 font-medium">餐厅</span>
        </div>
        {participants.map((p, idx) => (
          <div key={p.id} className="flex items-center gap-1.5">
            <div style={{
              width: 10, height: 10,
              borderRadius: '50%',
              background: PARTICIPANT_COLORS[idx % PARTICIPANT_COLORS.length],
            }} />
            <span className="text-gray-600">{p.name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
