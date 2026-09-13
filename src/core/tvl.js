/**
 * TVL сети TON.
 *
 * Цифру берём у DefiLlama — открытого агрегатора, по которому эту величину
 * и принято сверять. Запрос не несёт ни адреса кошелька, ни чего-либо о его
 * владельце: наружу уходит только сам факт обращения с IP устройства.
 *
 * Ответ держим в localStorage несколько часов. TVL пересчитывается раз в сутки,
 * и дёргать чужой сервер на каждое открытие кошелька незачем — ни ему, ни нам.
 */

const API = "https://api.llama.fi/v2/historicalChainTvl/TON";

const KEY = "gram-wallet:tvl:v1";

/** Сколько считаем цифру свежей. Значение меняется раз в сутки. */
const FRESH_MS = 3 * 60 * 60 * 1000;

/** За какой срок показываем изменение. */
const DAYS = 30;

function remembered() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw);
    return Date.now() - (saved?.at ?? 0) < FRESH_MS ? saved : null;
  } catch {
    return null;
  }
}

function remember(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // Приватное окно или переполненное хранилище — не повод падать.
  }
}

/**
 * Возвращает { tvl, change } — доллары и изменение за 30 дней в процентах.
 *
 * История приходит одним массивом дневных точек, поэтому обоих значений
 * хватает одного запроса: последняя точка и точка месяцем раньше.
 */
export async function fetchChainTvl() {
  const saved = remembered();
  if (saved) return saved;

  const res = await fetch(API, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`DefiLlama ответил ${res.status}`);

  const points = await res.json();
  if (!Array.isArray(points) || !points.length) throw new Error("Пустой ответ DefiLlama");

  const last = points[points.length - 1];
  // У молодой сети истории может не хватить на месяц — берём самую раннюю.
  const past = points[points.length - 1 - DAYS] ?? points[0];

  const data = {
    tvl: Number(last.tvl) || 0,
    change: past.tvl > 0 ? ((last.tvl - past.tvl) / past.tvl) * 100 : 0,
    at: Date.now(),
  };

  remember(data);
  return data;
}

/** Доллары коротко: $55.8M, $1.24B. Длинные числа в плашку не помещаются. */
export function fmtUsd(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${Math.round(n / 1e3)}K`;
  return `$${Math.round(n)}`;
}
