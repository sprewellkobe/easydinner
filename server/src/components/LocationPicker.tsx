'use client';

import { useState, useCallback, useRef, useEffect } from 'react';

interface Location {
  name: string;
  lng: number;
  lat: number;
}

interface LocationPickerProps {
  value?: Location | null;
  onChange: (location: Location) => void;
  placeholder?: string;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

let leafletLoaded = false;
let leafletLoadPromise: Promise<void> | null = null;

function loadLeaflet(): Promise<void> {
  if (leafletLoaded && (window as any).L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;

  leafletLoadPromise = new Promise((resolve, reject) => {
    // 加载 CSS
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);

    // 加载 JS
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

// POI 搜索 - 走后端 API（不依赖第三方 Key）
// lat/lng: 可选，传入当前地图中心坐标，优先返回附近结果
async function searchPOI(query: string, lat?: number, lng?: number): Promise<{ name: string; address: string; lng: number; lat: number }[]> {
  try {
    let url = `/api/search-poi?keyword=${encodeURIComponent(query)}`;
    if (lat !== undefined && lng !== undefined) {
      url += `&lat=${lat}&lng=${lng}`;
    }
    const res = await fetch(url);
    const data = await res.json();
    return data.results || [];
  } catch {}
  return [];
}

// 逆地理编码 - 走后端 API（不依赖第三方 Key）
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
    const data = await res.json();
    return data.address || `${lng.toFixed(4)}, ${lat.toFixed(4)}`;
  } catch {}
  return `${lng.toFixed(4)}, ${lat.toFixed(4)}`;
}

export default function LocationPicker({ value, onChange, placeholder = '搜索地点...' }: LocationPickerProps) {
  const [query, setQuery] = useState(value?.name || '');
  const [searchResults, setSearchResults] = useState<{ name: string; address: string; lng: number; lat: number }[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [noResults, setNoResults] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [mapReady, setMapReady] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const initDoneRef = useRef(false);

  // 点击外部关闭搜索结果
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // 地图初始化 — 组件挂载后自动执行
  const initMap = useCallback(async () => {
    if (initDoneRef.current) return;
    try {
      await loadLeaflet();
      const L = (window as any).L;
      if (!mapContainerRef.current || !L) return;

      // 防止重复初始化
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }

      const center: [number, number] = value ? [value.lat, value.lng] : [39.9042, 116.4074];
      const map = L.map(mapContainerRef.current, {
        center,
        zoom: 14,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // 高德矢量瓦片（中文标注）
      L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
        subdomains: '1234',
        maxZoom: 18,
        attribution: '&copy; 高德地图',
      }).addTo(map);

      mapRef.current = map;
      initDoneRef.current = true;

      // 如果有初始值，放置标记
      if (value) {
        const marker = L.marker([value.lat, value.lng]).addTo(map);
        markerRef.current = marker;
      }

      // 点击地图放置标记
      let clickId = 0;
      map.on('click', (e: any) => {
        const { lat, lng } = e.latlng;

        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
        } else {
          markerRef.current = L.marker([lat, lng]).addTo(map);
        }

        // 立即设置坐标名称
        const tempName = `${lng.toFixed(4)}, ${lat.toFixed(4)}`;
        setQuery(tempName);
        onChange({ name: tempName, lng, lat });
        setIsLocating(true);
        setShowResults(false);

        // 异步获取详细地址
        const currentClickId = ++clickId;
        reverseGeocode(lat, lng).then((name) => {
          if (currentClickId === clickId) {
            const shortName = name.split(',')[0] || name;
            setQuery(shortName);
            onChange({ name: shortName, lng, lat });
            setIsLocating(false);
          }
        });
      });

      setTimeout(() => {
        map.invalidateSize();
        setMapReady(true);
      }, 200);
    } catch (err) {
      console.error('地图初始化失败:', err);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 组件挂载后自动初始化地图
  useEffect(() => {
    const timer = setTimeout(initMap, 100);
    return () => {
      clearTimeout(timer);
      // 组件卸载时清理地图
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        initDoneRef.current = false;
      }
    };
  }, [initMap]);

  // 搜索逻辑
  const doSearch = useCallback(async (keyword: string) => {
    if (!keyword.trim()) {
      setSearchResults([]);
      setShowResults(false);
      setNoResults(false);
      setIsSearching(false);
      return;
    }
    setIsSearching(true);
    setNoResults(false);
    setShowResults(true); // 立即显示下拉区域（展示 loading）
    try {
      // 使用地图中心或已选位置的坐标
      const center = mapRef.current?.getCenter();
      const centerLat = center?.lat || value?.lat || 39.9042;
      const centerLng = center?.lng || value?.lng || 116.4074;
      const results = await searchPOI(keyword, centerLat, centerLng);
      setSearchResults(results);
      if (results.length === 0) {
        setNoResults(true);
      }
      setShowResults(true); // 确保结果显示
    } catch {
      setSearchResults([]);
      setNoResults(true);
      setShowResults(true);
    } finally {
      setIsSearching(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => doSearch(val), 500);
  };

  // 回车键立即搜索
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (timerRef.current) clearTimeout(timerRef.current);
      doSearch(query);
    }
  };

  // 点击搜索图标立即搜索
  const handleSearchClick = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    doSearch(query);
  };

  // 选择搜索结果 → 地图也同步移动
  const handleSelectResult = (r: { name: string; address: string; lng: number; lat: number }) => {
    setQuery(r.name);
    setShowResults(false);
    onChange({ name: r.name, lng: r.lng, lat: r.lat });

    // 地图跳转到选择的位置
    const L = (window as any).L;
    if (mapRef.current) {
      mapRef.current.setView([r.lat, r.lng], 16);
      if (markerRef.current) {
        markerRef.current.setLatLng([r.lat, r.lng]);
      } else if (L) {
        markerRef.current = L.marker([r.lat, r.lng]).addTo(mapRef.current);
      }
    }
  };

  return (
    <div ref={wrapperRef} className="relative">
      {/* 搜索框 */}
      <div className="relative z-[9999]">
        <button
          type="button"
          onClick={handleSearchClick}
          className="absolute left-3 top-1/2 -translate-y-1/2 z-10 p-0.5 rounded-md hover:bg-gray-200 transition-colors cursor-pointer"
          aria-label="搜索"
        >
          <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </button>
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          onFocus={() => searchResults.length > 0 && setShowResults(true)}
          placeholder={placeholder}
          className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-gray-50 transition-all"
        />
        {(isLocating || isSearching) && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2">
            <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {/* 搜索结果下拉 */}
      {showResults && (
        <div className="absolute z-[9999] w-full mt-1 bg-white rounded-xl shadow-lg border border-gray-100 max-h-52 overflow-y-auto">
          {isSearching && (
            <div className="flex items-center justify-center gap-2 py-4 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
              搜索中...
            </div>
          )}
          {!isSearching && noResults && searchResults.length === 0 && (
            <div className="px-4 py-4 text-center text-sm text-gray-400">
              未找到相关地点，试试其他关键词
            </div>
          )}
          {!isSearching && searchResults.map((r, idx) => (
            <button
              key={idx}
              onClick={() => handleSelectResult(r)}
              className="w-full px-4 py-2.5 text-left hover:bg-orange-50 transition-colors flex items-start gap-3 border-b border-gray-50 last:border-b-0"
            >
              <svg className="w-4 h-4 text-orange-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-800">{r.name}</div>
                {r.address && <div className="text-xs text-gray-400 truncate">{r.address}</div>}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* 内嵌地图 */}
      <div className="mt-3 rounded-2xl overflow-hidden border border-gray-200 relative z-0" style={{ height: '240px' }}>
        <div ref={mapContainerRef} style={{ width: '100%', height: '100%' }} />
        {/* 地图提示浮层 */}
        {!value && mapReady && (
          <div className="absolute top-2.5 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-3 py-1.5 rounded-full z-[1000] pointer-events-none">
            点击地图或搜索选择位置
          </div>
        )}
        {/* 地图加载中 */}
        {!mapReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
            <div className="flex items-center gap-2 text-gray-400 text-sm">
              <div className="w-4 h-4 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
              地图加载中...
            </div>
          </div>
        )}
      </div>

      {/* 已选择提示 */}
      {value && (
        <div className="mt-2 flex items-center gap-2 text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="truncate">已选择: {value.name}</span>
        </div>
      )}
    </div>
  );
}
