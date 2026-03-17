'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import LocationPicker from '@/components/LocationPicker';

interface Location {
  name: string;
  lng: number;
  lat: number;
}

// 餐段定义（午饭 / 晚饭 / 不限）
type MealType = 'lunch' | 'dinner' | 'anytime';

// 聚餐类型定义
type DiningType = 'light' | 'formal' | 'nightsnack' | 'any';

const DINING_OPTIONS: {
  type: DiningType;
  label: string;
  emoji: string;
  desc: string;
}[] = [
  { type: 'light',     label: '轻餐', emoji: '☕', desc: '咖啡快餐，聊事为主' },
  { type: 'formal',    label: '正餐', emoji: '🍽️', desc: '圆桌包间，正式聚餐' },
  { type: 'nightsnack', label: '夜宵', emoji: '🍢', desc: '烧烤小酒，轻松聚会' },
  { type: 'any',       label: '不限', emoji: '🎲', desc: '都行，看推荐' },
];

// 餐段 → 默认聚餐类型映射
const MEAL_DEFAULT_DINING: Record<MealType, DiningType> = {
  lunch: 'formal',      // 午饭 → 默认正餐
  dinner: 'nightsnack',  // 晚饭 → 默认夜宵
  anytime: 'light',      // 不限 → 默认轻餐
};

const MEAL_OPTIONS: {
  type: MealType;
  label: string;
  emoji: string;
  defaultHour: number;
  defaultMinute: number;
}[] = [
  { type: 'lunch',   label: '午饭', emoji: '☀️', defaultHour: 12, defaultMinute: 0 },
  { type: 'dinner',  label: '晚饭', emoji: '🌅', defaultHour: 18, defaultMinute: 0 },
  { type: 'anytime', label: '不限', emoji: '🕐', defaultHour: 12, defaultMinute: 0 },
];

// 生成某个餐段的所有可选时间点（默认时间前后各 2 小时，15 分钟粒度）
function generateTimeSlots(mealType: MealType): string[] {
  if (mealType === 'anytime') {
    // 不限：全天 10:00 ~ 23:00
    const slots: string[] = [];
    for (let h = 10; h <= 23; h++) {
      for (let m = 0; m < 60; m += 15) {
        if (h === 23 && m > 0) break;
        slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
      }
    }
    return slots;
  }
  const opt = MEAL_OPTIONS.find(m => m.type === mealType)!;
  const minHour = Math.max(0, opt.defaultHour - 2);
  const maxHour = Math.min(23, opt.defaultHour + 2);
  const slots: string[] = [];
  for (let h = minHour; h <= maxHour; h++) {
    for (let m = 0; m < 60; m += 15) {
      if (h === maxHour && m > 0) break;
      slots.push(`${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  return slots;
}

// 获取餐段默认时间字符串
function getMealDefaultTime(mealType: MealType): string {
  const opt = MEAL_OPTIONS.find(m => m.type === mealType)!;
  return `${String(opt.defaultHour).padStart(2, '0')}:${String(opt.defaultMinute).padStart(2, '0')}`;
}

// 获取默认日期（今天）
function getDefaultDate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 生成默认饭局名称
function getDefaultTitle(): string {
  const weekDays = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const day = weekDays[new Date().getDay()];
  return `${day}聚餐`;
}

// 判断选中日期是否是今天
function isToday(dateStr: string): boolean {
  return dateStr === getDefaultDate();
}

// 获取当前可选的餐段（如果是今天，过滤掉已过时的）
function getAvailableMeals(dateStr: string): MealType[] {
  if (!isToday(dateStr)) {
    // 未来日期：全部可选
    return MEAL_OPTIONS.map(m => m.type);
  }
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  // 只保留微调范围（默认+2h）还没完全过去的餐段，「不限」始终可选
  return MEAL_OPTIONS.filter(m => {
    if (m.type === 'anytime') return true;
    const maxHour = Math.min(23, m.defaultHour + 2);
    if (maxHour > currentHour) return true;
    if (maxHour === currentHour && currentMinute === 0) return true;
    return false;
  }).map(m => m.type);
}

// 获取今天某个餐段下可选的时间段（过滤掉已过去的时间点）
function getAvailableTimeSlots(dateStr: string, mealType: MealType): string[] {
  const allSlots = generateTimeSlots(mealType);
  if (!isToday(dateStr)) return allSlots;
  const now = new Date();
  const currentTotal = now.getHours() * 60 + now.getMinutes();
  return allSlots.filter(slot => {
    const [h, m] = slot.split(':').map(Number);
    return h * 60 + m > currentTotal;
  });
}

// 获取某餐段下的有效默认时间（如果默认已过期，取第一个可用的）
function getValidDefaultTime(dateStr: string, mealType: MealType): string {
  const defaultTime = getMealDefaultTime(mealType);
  const available = getAvailableTimeSlots(dateStr, mealType);
  if (available.includes(defaultTime)) return defaultTime;
  return available[0] || defaultTime;
}

// 获取默认餐段
function getDefaultMeal(dateStr: string): MealType {
  const available = getAvailableMeals(dateStr);
  // 优先选晚饭，否则选第一个可选的
  if (available.includes('dinner')) return 'dinner';
  return available[0] || 'anytime';
}

export default function Home() {
  const router = useRouter();
  const [step, setStep] = useState<'home' | 'create'>('home');
  const [title, setTitle] = useState(getDefaultTitle());
  const [creatorName, setCreatorName] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('yuefan_username') || '';
    }
    return '';
  });
  const [date, setDate] = useState(getDefaultDate());
  const [meal, setMeal] = useState<MealType>(getDefaultMeal(getDefaultDate()));
  const [timeStr, setTimeStr] = useState(getMealDefaultTime(getDefaultMeal(getDefaultDate())));
  const [diningType, setDiningType] = useState<DiningType>(MEAL_DEFAULT_DINING[getDefaultMeal(getDefaultDate())]);
  const [location, setLocation] = useState<Location | null>(() => {
    if (typeof window !== 'undefined') {
      const cached = localStorage.getItem('yuefan_location');
      if (cached) {
        try { return JSON.parse(cached); } catch { /* ignore */ }
      }
    }
    return null;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 当前日期下可选的餐段
  const availableMeals = useMemo(() => getAvailableMeals(date), [date]);

  // 当前餐段+日期下可选的时间点
  const availableTimeSlots = useMemo(() => getAvailableTimeSlots(date, meal), [date, meal]);

  // 提交用的时间
  const time = timeStr;

  const handleCreate = async () => {
    if (!title.trim() || !creatorName.trim() || !location || availableMeals.length === 0) return;

    setIsSubmitting(true);
    try {
      const mealOption = MEAL_OPTIONS.find(m => m.type === meal);
      const res = await fetch('/api/gatherings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          creatorName,
          date,
          time,
          meal: mealOption?.label || '晚饭',
          diningType,
          location,
        }),
      });

      const data = await res.json();
      if (data.gathering) {
        // 缓存用户名和地点
        localStorage.setItem('yuefan_username', creatorName.trim());
        if (location) {
          localStorage.setItem('yuefan_location', JSON.stringify(location));
        }
        // 保存创建者 ID 到 localStorage
        localStorage.setItem(`creator_${data.gathering.id}`, data.creatorId);
        localStorage.setItem(`participant_${data.gathering.id}`, data.creatorId);
        router.push(`/gathering/${data.gathering.id}`);
      }
    } catch (err) {
      console.error('创建失败:', err);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === 'home') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-4">
        {/* Hero Section */}
        <div className="text-center mb-12 animate-fade-in-up">
          <div className="text-7xl mb-6 animate-float">🍜</div>
          <h1 className="text-4xl font-bold text-gray-800 mb-3">
            让约饭更简单
          </h1>
          <p className="text-lg text-gray-500 max-w-md mx-auto">
            一键觅得折中地，方寸图开会有期
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-3 gap-4 mb-10 max-w-lg w-full animate-fade-in-up-delay-1">
          <div className="bg-white/70 backdrop-blur rounded-2xl p-4 text-center shadow-sm">
            <div className="text-2xl mb-2">📍</div>
            <div className="text-xs text-gray-600">各自选位置</div>
          </div>
          <div className="bg-white/70 backdrop-blur rounded-2xl p-4 text-center shadow-sm">
            <div className="text-2xl mb-2">🧠</div>
            <div className="text-xs text-gray-600">智能推荐</div>
          </div>
          <div className="bg-white/70 backdrop-blur rounded-2xl p-4 text-center shadow-sm">
            <div className="text-2xl mb-2">✅</div>
            <div className="text-xs text-gray-600">一键确认</div>
          </div>
        </div>

        {/* CTA */}
        <button
          onClick={() => setStep('create')}
          className="animate-fade-in-up-delay-2 bg-gradient-to-r from-orange-500 to-red-500 text-white px-10 py-4 rounded-2xl text-lg font-semibold shadow-lg shadow-orange-500/30 hover:shadow-xl hover:shadow-orange-500/40 transition-all hover:scale-105 active:scale-95"
        >
          🎉 发起饭局
        </button>

        <p className="mt-6 text-sm text-gray-400 animate-fade-in-up-delay-3">
          创建后分享链接给朋友即可
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-8">
      {/* 顶部返回 */}
      <div className="w-full max-w-lg mb-6">
        <button
          onClick={() => setStep('home')}
          className="flex items-center text-gray-500 hover:text-gray-700 transition-colors"
        >
          <svg className="w-5 h-5 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          返回
        </button>
      </div>

      <div className="w-full max-w-lg">
        <div className="text-center mb-8 animate-fade-in-up">
          <div className="text-5xl mb-3">🎊</div>
          <h2 className="text-2xl font-bold text-gray-800">发起饭局</h2>
          <p className="text-gray-500 mt-1">填写信息，开启一场美食之旅</p>
        </div>

        <div className="bg-white rounded-3xl shadow-sm p-6 space-y-5 animate-fade-in-up-delay-1">
          {/* 饭局名称 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              饭局名称 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="例：周五庆功宴"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-gray-50"
            />
          </div>

          {/* 你的名字 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              你的名字 <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={creatorName}
              onChange={(e) => setCreatorName(e.target.value)}
              placeholder="输入你的名字"
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-gray-50"
            />
          </div>

          {/* 日期 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">日期</label>
            <input
              type="date"
              value={date}
              min={getDefaultDate()}
              onChange={(e) => {
                const newDate = e.target.value;
                setDate(newDate);
                // 切换日期后，如果当前选中的餐段不可选了，自动切到第一个可选的
                const newAvailable = getAvailableMeals(newDate);
                if (!newAvailable.includes(meal)) {
                  const newMeal = getDefaultMeal(newDate);
                  setMeal(newMeal);
                  setTimeStr(getValidDefaultTime(newDate, newMeal));
                  setDiningType(MEAL_DEFAULT_DINING[newMeal]);
                } else {
                  // 餐段可选，但时间点可能需要校正
                  setTimeStr(getValidDefaultTime(newDate, meal));
                }
              }}
              className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-gray-50"
            />
          </div>

          {/* 餐段选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">时间</label>
            <div className="grid grid-cols-3 gap-3">
              {MEAL_OPTIONS.map((opt) => {
                const isAvailable = availableMeals.includes(opt.type);
                const isSelected = meal === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    disabled={!isAvailable}
                    onClick={() => {
                      setMeal(opt.type);
                      setTimeStr(getValidDefaultTime(date, opt.type));
                      setDiningType(MEAL_DEFAULT_DINING[opt.type]);
                    }}
                    className={`relative flex flex-col items-center py-3 px-2 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 shadow-sm'
                        : isAvailable
                          ? 'border-gray-200 bg-gray-50 hover:border-orange-300 hover:bg-orange-50/50'
                          : 'border-gray-100 bg-gray-100 opacity-40 cursor-not-allowed'
                    }`}
                  >
                    <span className="text-2xl mb-1">{opt.emoji}</span>
                    <span className={`text-sm font-medium ${isSelected ? 'text-orange-600' : 'text-gray-700'}`}>
                      {opt.label}
                    </span>
                    <span className={`text-xs mt-0.5 ${isSelected ? 'text-orange-400' : 'text-gray-400'}`}>
                      {opt.type === 'anytime' ? '随时' : (isSelected ? timeStr : getMealDefaultTime(opt.type))}
                    </span>
                    {isSelected && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            {/* 时间微调下拉框 */}
            {availableMeals.includes(meal) && availableTimeSlots.length > 0 && (
              <div className="mt-3">
                <label className="text-xs text-gray-400 mb-1 block">具体时间</label>
                <select
                  value={timeStr}
                  onChange={(e) => setTimeStr(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none text-gray-700 bg-gray-50 text-sm appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
                >
                  {availableTimeSlots.map((slot) => (
                    <option key={slot} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {availableMeals.length === 0 && (
              <p className="text-xs text-red-400 mt-2">今天的餐段都已过时，请选择明天或之后的日期</p>
            )}
          </div>

          {/* 你希望的地点 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              聚餐类型
            </label>
            <div className="grid grid-cols-4 gap-2">
              {DINING_OPTIONS.map((opt) => {
                const isSelected = diningType === opt.type;
                return (
                  <button
                    key={opt.type}
                    type="button"
                    onClick={() => setDiningType(opt.type)}
                    className={`relative flex flex-col items-center py-3 px-1 rounded-xl border-2 transition-all ${
                      isSelected
                        ? 'border-orange-500 bg-orange-50 shadow-sm'
                        : 'border-gray-200 bg-gray-50 hover:border-orange-300 hover:bg-orange-50/50'
                    }`}
                  >
                    <span className="text-xl mb-0.5">{opt.emoji}</span>
                    <span className={`text-sm font-medium ${isSelected ? 'text-orange-600' : 'text-gray-700'}`}>
                      {opt.label}
                    </span>
                    <span className={`text-[10px] mt-0.5 leading-tight text-center ${isSelected ? 'text-orange-400' : 'text-gray-400'}`}>
                      {opt.desc}
                    </span>
                    {isSelected && (
                      <div className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-orange-500 rounded-full flex items-center justify-center">
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 你希望在什么地点附近 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              你希望在什么地点附近 <span className="text-red-400">*</span>
            </label>
            <LocationPicker
              value={location}
              onChange={setLocation}
              placeholder="搜索你方便的地点（如公司、家附近）"
            />
          </div>

          {/* 提交按钮 */}
          <button
            onClick={handleCreate}
            disabled={!title.trim() || !creatorName.trim() || !location || isSubmitting || availableMeals.length === 0}
            className="w-full bg-gradient-to-r from-orange-500 to-red-500 text-white py-4 rounded-xl font-semibold text-lg shadow-lg shadow-orange-500/25 hover:shadow-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-lg"
          >
            {isSubmitting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                创建中...
              </div>
            ) : (
              '创建饭局 🎉'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
