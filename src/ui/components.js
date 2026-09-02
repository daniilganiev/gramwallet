import { el } from "./dom.js";
import { haptic, openLink } from "../telegram.js";

let toastTimer = null;

export function toast(message, { error = false, ms = 3200 } = {}) {
  document.querySelector(".toast")?.remove();
  clearTimeout(toastTimer);

  const node = el(`div.toast${error ? ".toast--error" : ""}`, { text: message });
  document.body.append(node);
  haptic(error ? "error" : "light");

  toastTimer = setTimeout(() => {
    node.style.opacity = "0";
    node.style.transition = "opacity .2s";
    setTimeout(() => node.remove(), 220);
  }, ms);
}

/** Нижняя шторка. Резолвится в true, если нажали подтверждение. */
export function sheet({ title, body, confirmText = "Продолжить", danger = false, cancelText = "Отмена" }) {
  return new Promise((resolve) => {
    const close = (result) => {
      overlay.remove();
      resolve(result);
    };

    const overlay = el("div.modal", { onclick: (e) => e.target === overlay && close(false) }, [
      el("div.modal__sheet", {}, [
        title && el("h2", { text: title }),
        typeof body === "string" ? el("p", { text: body }) : body,
        el("div.screen__actions", {}, [
          el(`button.btn.${danger ? "btn--danger" : "btn--primary"}`, {
            type: "button",
            text: confirmText,
            onclick: () => close(true),
          }),
          cancelText && el("button.btn.btn--link", { type: "button", text: cancelText, onclick: () => close(false) }),
        ]),
      ]),
    ]);

    document.body.append(overlay);
  });
}

/**
 * Выполняет асинхронное действие с блокировкой кнопки и спиннером.
 * Ошибки показываем текстом — человек должен понимать, что произошло.
 */
export async function runAction(button, fn, { loadingText } = {}) {
  const original = button.textContent;
  button.disabled = true;
  button.replaceChildren(el("span.spinner"), loadingText ? el("span", { text: loadingText }) : "");

  try {
    return await fn();
  } catch (e) {
    toast(e?.message ?? "Что-то пошло не так", { error: true });
    return undefined;
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

/**
 * Камень — тот же, что на иконке бота: гранёный кристалл, из которого
 * бьют лучи с радужной дисперсией.
 *
 * Рисуем SVG, а не div с border-radius — иначе до применения стилей
 * успевает мелькнуть квадрат. Лучи лежат под камнем и смешиваются
 * в режиме screen, поэтому светятся, а не закрашивают фон.
 */
export function diamond(size = 108) {
  // Огранка: корона сверху, пояс по центру, павильон сходится в кулету.
  // Грани разной плотности — контраст между ними и читается как камень.
  const facets = [
    { d: "M35,24 L50,24 L52,44 L30,44 Z", tone: "table" },
    { d: "M50,24 L65,24 L70,44 L52,44 Z", tone: "bright" },
    { d: "M35,24 L30,44 L8,44 Z", tone: "mid" },
    { d: "M65,24 L92,44 L70,44 Z", tone: "dark" },
    { d: "M30,44 L52,44 L50,93 Z", tone: "bright" },
    { d: "M52,44 L70,44 L50,93 Z", tone: "table" },
    { d: "M8,44 L30,44 L50,93 Z", tone: "deep" },
    { d: "M70,44 L92,44 L50,93 Z", tone: "mid" },
  ];

  // Преломление: пара граней ловит цвет, как настоящее стекло.
  const prisms = [
    { d: "M30,44 L52,44 L50,93 Z", fill: "url(#gIris1)" },
    { d: "M70,44 L92,44 L50,93 Z", fill: "url(#gIris2)" },
    { d: "M35,24 L50,24 L52,44 L30,44 Z", fill: "url(#gIris3)" },
  ];

  // Длина у осей разная: горизонталь бьёт дальше всех, диагонали короче —
  // так пучок читается как вспышка на грани, а не как ровное колесо.
  const rays = [
    { a: 0, len: 178 },
    { a: 180, len: 178 },
    { a: 90, len: 128 },
    { a: 270, len: 128 },
    { a: 45, len: 96 },
    { a: 135, len: 96 },
    { a: 225, len: 96 },
    { a: 315, len: 96 },
    { a: 22, len: 66 },
    { a: 158, len: 66 },
    { a: 202, len: 66 },
    { a: 338, len: 66 },
  ]
    .map(
      ({ a, len }, i) =>
        `<path class="gem__ray" style="--i:${i}" d="M50,49.1 L${50 + len},50 L50,50.9 Z" transform="rotate(${a} 50 50)"/>`,
    )
    .join("");

  const wrap = el("div.gem", { style: `width:${size}px;height:${size}px` });
  wrap.innerHTML = `
    <svg viewBox="-10 -6 120 112" aria-hidden="true">
      <defs>
        <linearGradient id="gTable" x1="0" y1="0" x2="0.5" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="1"/>
          <stop offset="58%" stop-color="#d8e6f8" stop-opacity=".72"/>
          <stop offset="100%" stop-color="#93a9c6" stop-opacity=".5"/>
        </linearGradient>
        <linearGradient id="gBright" x1="0.2" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".95"/>
          <stop offset="45%" stop-color="#c3d8ef" stop-opacity=".6"/>
          <stop offset="100%" stop-color="#51617a" stop-opacity=".45"/>
        </linearGradient>
        <linearGradient id="gMid" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#e3edf9" stop-opacity=".62"/>
          <stop offset="100%" stop-color="#2b3446" stop-opacity=".55"/>
        </linearGradient>
        <linearGradient id="gDeep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#7d8ea9" stop-opacity=".42"/>
          <stop offset="100%" stop-color="#0d1119" stop-opacity=".72"/>
        </linearGradient>

        <!-- Дисперсия: цвет живёт внутри камня, а не по его кромке. -->
        <linearGradient id="gIris1" x1="0" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#7ad2ff" stop-opacity=".5"/>
          <stop offset="42%" stop-color="#b98cff" stop-opacity=".3"/>
          <stop offset="78%" stop-color="#ff9ec8" stop-opacity=".16"/>
          <stop offset="100%" stop-color="#ffd9a0" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gIris2" x1="1" y1="0" x2="0.2" y2="1">
          <stop offset="0%" stop-color="#ff9ecd" stop-opacity=".42"/>
          <stop offset="45%" stop-color="#7fe6c8" stop-opacity=".26"/>
          <stop offset="100%" stop-color="#7ad2ff" stop-opacity="0"/>
        </linearGradient>
        <linearGradient id="gIris3" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#ffdf9a" stop-opacity=".34"/>
          <stop offset="60%" stop-color="#9ad4ff" stop-opacity=".2"/>
          <stop offset="100%" stop-color="#c8a6ff" stop-opacity="0"/>
        </linearGradient>

        <!-- Луч: белое ядро, к концам расходится в спектр и тает. -->
        <linearGradient id="gRay" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#ffffff" stop-opacity=".9"/>
          <stop offset="9%" stop-color="#eaf5ff" stop-opacity=".45"/>
          <stop offset="24%" stop-color="#b9d4ff" stop-opacity=".2"/>
          <stop offset="46%" stop-color="#ffc7e6" stop-opacity=".1"/>
          <stop offset="70%" stop-color="#ffe9b8" stop-opacity=".04"/>
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
        </linearGradient>

        <filter id="gGlow" x="-70%" y="-70%" width="240%" height="240%">
          <feGaussianBlur stdDeviation="3.4" result="b"/>
          <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <filter id="gRayBlur" x="-60%" y="-300%" width="220%" height="700%">
          <feGaussianBlur stdDeviation="0.9"/>
        </filter>
      </defs>

      <g class="gem__rays" filter="url(#gRayBlur)">${rays}</g>

      <g filter="url(#gGlow)">
        ${facets.map((f, i) => `<path class="gem__facet gem__facet--${f.tone}" style="--i:${i}" d="${f.d}"/>`).join("")}
        ${prisms.map((p, i) => `<path class="gem__prism" style="--i:${i}" d="${p.d}" fill="${p.fill}"/>`).join("")}
      </g>

      <!-- Рёбра: выжженные светом линии огранки. -->
      <g class="gem__edges">
        <path d="M35,24 L65,24 L92,44 L50,93 L8,44 Z"/>
        <path d="M8,44 L92,44"/>
        <path d="M35,24 L30,44 M65,24 L70,44 M50,24 L52,44 M30,44 L50,93 M70,44 L50,93 M52,44 L50,93"/>
      </g>
    </svg>
  `;
  return wrap;
}

export const primaryButton = (text, onclick) =>
  el("button.btn.btn--primary", { type: "button", text, onclick });

export const glassButton = (text, onclick) =>
  el("button.btn.btn--glass", { type: "button", text, onclick });

export const linkButton = (text, onclick) =>
  el("button.btn.btn--link", { type: "button", text, onclick });

/** Ссылка внутри текста: клик уводим через Telegram, иначе webview её съест. */
export const link = (text, href) =>
  el("a.link", {
    href,
    text,
    target: "_blank",
    rel: "noopener noreferrer",
    onclick: (e) => {
      e.preventDefault();
      openLink(href);
    },
  });

/** Сколько символов в PIN. Одно место на всё приложение. */
export const PIN_LENGTH = 6;

/**
 * Поле PIN.
 *
 * Штатный type="password" рисует кружки, и заменить их символ нечем: браузер
 * не отдаёт эту маску ни CSS, ни атрибутом. Поэтому поле обычное текстовое,
 * а маскируем сами — показываем звёздочки, а набранное держим в замыкании.
 * Побочно это даже честнее: настоящий PIN не лежит в разметке ни секунды.
 *
 * Свойство value переопределено, поэтому снаружи поле ведёт себя как обычный
 * input: читаем pin.value, чистим pin.value = "".
 */
export function pinInput() {
  const input = el("input.input.input--pin", {
    type: "text",
    inputmode: "text",
    autocapitalize: "none",
    autocomplete: "off",
    spellcheck: false,
    maxlength: PIN_LENGTH,
    placeholder: "*".repeat(PIN_LENGTH),
  });

  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  let real = "";
  const draw = () => native.set.call(input, "*".repeat(real.length));

  input.addEventListener("input", () => {
    const shown = native.get.call(input);
    const caret = input.selectionStart ?? shown.length;

    // Всё, что не звёздочка, набрано только что: маска состоит из них одних.
    const typed = shown.replace(/[*]/g, "");
    const at = caret - typed.length;
    const removed = real.length - (shown.length - typed.length);

    real = (real.slice(0, at) + typed + real.slice(at + removed)).slice(0, PIN_LENGTH);
    draw();
    const pos = Math.min(caret, real.length);
    input.setSelectionRange(pos, pos);
  });

  Object.defineProperty(input, "value", {
    get: () => real,
    set: (v) => {
      real = String(v ?? "").slice(0, PIN_LENGTH);
      draw();
      input.dispatchEvent(new Event("pin-change"));
    },
  });

  return input;
}

/**
 * Терминал для операций, которые идут долго и должны быть видимы.
 *
 * Тот же вид, что на экране создания: человек не гадает, «висит или
 * работает», а читает, что именно сейчас делает устройство.
 */
export function terminal({ name = "node · javascript", meta = "", compact = false } = {}) {
  const body = el("div.term__body");
  const caret = el("span.term__caret");
  body.append(caret);

  const node = el(`div.term${compact ? ".term--compact" : ""}`, {}, [
    el("div.term__bar", {}, [
      el("span.term__dot"),
      el("span.term__dot"),
      el("span.term__dot"),
      el("span.term__name", { text: name }),
      el("span.term__meta", { text: meta }),
    ]),
    body,
  ]);

  const write = (text, kind = "out") => {
    const row = el(`div.term__row.term__row--${kind}`);
    row.textContent = text;
    body.insertBefore(row, caret);
    body.scrollTop = body.scrollHeight;
    return row;
  };

  return { node, write, done: () => caret.remove() };
}

/** Круглая кнопка-иконка: копирование адреса и подобное. */
export const iconButton = (label, title, onclick) =>
  el("button.btn-icon", { type: "button", title, "aria-label": title, text: label, onclick });

/**
 * Поле PIN вместе с подписью и счётчиком набранного.
 *
 * Шесть точек под полем показывают, сколько символов уже введено и сколько
 * осталось: звёздочки в поле идут вплотную, и на глаз их не сосчитать.
 */
export function pinField(labelText = "PIN") {
  const input = pinInput();
  const dots = el(
    "div.pin-dots",
    {},
    Array.from({ length: PIN_LENGTH }, () => el("span.pin-dot")),
  );

  const paint = () => {
    const n = input.value.length;
    [...dots.children].forEach((dot, i) => dot.classList.toggle("pin-dot--on", i < n));
  };

  input.addEventListener("input", paint);
  input.addEventListener("pin-change", paint);
  paint();

  const field = el("label.field.field--pin", {}, [
    el("span.field__label", { text: labelText }),
    el("div.pin-row", {}, [input, dots]),
  ]);

  return { field, input };
}
