/**
 * Обёртка над Telegram.WebApp.
 *
 * Приложение обязано работать и в обычном браузере — тогда все вызовы
 * превращаются в пустышки, а разработка идёт без Telegram.
 *
 * ВАЖНО: CloudStorage здесь намеренно не используется. Это серверы Telegram,
 * и сид-фразе там не место — иначе обещание «ключ только на твоём устройстве»
 * перестаёт быть правдой.
 */

const tg = typeof window !== "undefined" ? window.Telegram?.WebApp : undefined;

export const isTelegram = Boolean(tg?.initData !== undefined && tg?.platform !== "unknown");

/**
 * Высота, от которой считается вёрстка.
 *
 * Telegram отдаёт две: текущую и последнюю устойчивую. Клавиатура меняет
 * первую и не трогает вторую, поэтому геометрию считаем от устойчивой —
 * иначе распорки на экранах сжимаются и вся композиция подскакивает.
 *
 * Клиент обещает ставить переменную сам, но не всякая версия это делает,
 * поэтому пишем её и отсюда: лишняя запись того же значения ничего не стоит.
 */
function trackViewport() {
  let current = 0;

  const apply = () => {
    const h = tg?.viewportStableHeight;
    if (!h) return;

    /*
     * Уменьшение под клавиатурой не принимаем.
     *
     * «Устойчивой» высота считается по последнему установившемуся состоянию,
     * и часть клиентов, когда клавиатура доехала, объявляет устойчивым уже
     * уменьшенный экран. Стоит это принять — body сожмётся, обе распорки
     * flex: 1 схлопнутся, и содержимое дёрнется прямо под пальцем. Никакой
     * подъём такого не лечит: раскладка меняется под ним.
     *
     * Признак открытой клавиатуры — поле в фокусе. Как только фокус уйдёт,
     * следующее же событие вернёт настоящую высоту.
     */
    const typing = document.activeElement?.matches?.("input, textarea");
    if (typing && current && h < current) return;

    current = h;
    document.documentElement.style.setProperty("--tg-viewport-stable-height", `${h}px`);
  };

  apply();
  try {
    tg?.onEvent?.("viewportChanged", apply);
  } catch {
    // Старый клиент не знает события — останемся на высоте родителя.
  }
}

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    trackViewport();
    tg.setHeaderColor?.("#0E1013");
    tg.setBackgroundColor?.("#0E1013");
    tg.disableVerticalSwipes?.();
  } catch {
    // старые версии клиента могут не знать часть методов — это не повод падать
  }
}

/** Тактильный отклик: заметно оживляет интерфейс, стоит ноль. */
export function haptic(type = "light") {
  try {
    const h = tg?.HapticFeedback;
    if (!h) return;
    if (type === "success" || type === "error" || type === "warning") h.notificationOccurred(type);
    else h.impactOccurred(type);
  } catch {
    /* не критично */
  }
}

/** Системная кнопка «назад» в шапке Telegram. */
export function setBackButton(handler) {
  const b = tg?.BackButton;
  if (!b) return () => {};
  try {
    b.offClick?.();
    if (handler) {
      b.onClick(handler);
      b.show();
    } else {
      b.hide();
    }
  } catch {
    /* не критично */
  }
  return () => {
    try {
      b.offClick?.();
      b.hide();
    } catch {
      /* не критично */
    }
  };
}

/**
 * Внешняя ссылка. В webview Telegram обычный target=_blank часто молча
 * не срабатывает, поэтому сначала пробуем родной openLink.
 */
export function openLink(url) {
  try {
    // Ссылке на t.me место внутри Telegram, а не в браузере: openLink
    // открыл бы профиль веб-версией поверх приложения.
    if (/^https:\/\/t\.me\//.test(url) && tg?.openTelegramLink) {
      tg.openTelegramLink(url);
      return;
    }
    if (tg?.openLink) tg.openLink(url, { try_instant_view: false });
    else window.open(url, "_blank", "noopener");
  } catch {
    window.open(url, "_blank", "noopener");
  }
}

export function closeApp() {
  try {
    tg?.close();
  } catch {
    /* не критично */
  }
}
