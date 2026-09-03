import "./ui/fonts.css";
import "./ui/styles.css";

import { el, clear } from "./ui/dom.js";
import { toast } from "./ui/components.js";
import { haptic, initTelegram, setBackButton } from "./telegram.js";
import { hasWallet, isCryptoAvailable } from "./crypto/vault.js";

import { introScreen, safetyScreen, splashScreen, welcomeScreen } from "./ui/screens/onboarding.js";
import { createScreen, pinScreen, verifyScreen } from "./ui/screens/create.js";
import { forgeScreen } from "./ui/screens/forge.js";
import { importScreen } from "./ui/screens/import.js";
import { lockScreen } from "./ui/screens/lock.js";
import { homeScreen } from "./ui/screens/home.js";
import { historyScreen } from "./ui/screens/history.js";
import { sendScreen } from "./ui/screens/send.js";
import { batchScreen } from "./ui/screens/batch.js";
import { rotateScreen } from "./ui/screens/rotate.js";
import { settingsScreen } from "./ui/screens/settings.js";

const SCREENS = {
  intro: introScreen,
  safety: safetyScreen,
  welcome: welcomeScreen,
  forge: forgeScreen,
  create: createScreen,
  verify: verifyScreen,
  pin: pinScreen,
  import: importScreen,
  lock: lockScreen,
  home: homeScreen,
  history: historyScreen,
  send: sendScreen,
  batch: batchScreen,
  rotate: rotateScreen,
  settings: settingsScreen,
};

/** Куда ведёт системная кнопка «назад». Пусто — кнопки нет. */
const BACK = {
  safety: "intro",
  create: "welcome",
  verify: "create",
  import: "welcome",
  send: "home",
  batch: "send",
  settings: "home",
  history: "home",
  rotate: "settings",
};

const ctx = {
  network: "mainnet",
  /** Расшифрованная фраза и адрес — только в памяти, пока приложение открыто. */
  session: null,
  /** Черновик при создании или импорте, до установки PIN. */
  draft: null,
  /** Экземпляр кошелька после разблокировки. */
  wallet: null,
  /** Предмет, выбранный нажатием на кошельке: экран отправки заберёт его. */
  sendAsset: null,
  go,
};

const root = document.getElementById("app");
let detachBack = () => {};

function go(name) {
  const screen = SCREENS[name];
  if (!screen) throw new Error(`Неизвестный экран: ${name}`);

  detachBack();
  clear(root);

  // Если экран упадёт при сборке, корень останется пустым, и человек
  // увидит чёрное поле без единой подсказки. Показываем ошибку и выход.
  try {
    root.append(screen(ctx));
  } catch (e) {
    root.append(
      el("div.screen", {}, [
        el("div.screen__spacer"),
        el("h1", { text: "Что-то сломалось" }),
        el("div.note.note--danger", { text: String(e?.message ?? e) }),
        el("div.screen__spacer"),
        el("div.screen__actions", {}, [
          el("button.btn.btn--primary", {
            type: "button",
            text: "На главный",
            onclick: () => go(hasWallet() ? "lock" : "intro"),
          }),
        ]),
      ]),
    );
    throw e;
  }

  const back = BACK[name];
  detachBack = back ? setBackButton(() => go(back)) : setBackButton(null);
  root.scrollTop = 0;
}

function mountBackground() {
  document.body.prepend(
    el("div.bg", {}, [
      el("div.bg__waves", {}, [el("div.bg__wave.bg__wave--1"), el("div.bg__wave.bg__wave--2"), el("div.bg__wave.bg__wave--3")]),
      el("div.bg__prism"),
      el("div.bg__noise"),
    ]),
  );
}

/**
 * В Telegram webview консоли нет, и упавший промис выглядит как «ничего
 * не произошло». Показываем текст ошибки на экране — иначе диагностировать
 * можно только гаданием.
 */
/**
 * Отклик на касание для всех кнопок разом: запоминаем точку нажатия,
 * чтобы свет расходился именно из-под пальца, и снимаем состояние,
 * когда палец отпущен или уведён с кнопки.
 */
function pressFeedback() {
  const release = () => {
    for (const n of document.querySelectorAll(".btn--pressed")) n.classList.remove("btn--pressed");
  };

  document.addEventListener(
    "pointerdown",
    (e) => {
      const btn = e.target?.closest?.(".btn");
      if (!btn || btn.disabled) return;
      const r = btn.getBoundingClientRect();
      btn.style.setProperty("--rx", `${((e.clientX - r.left) / r.width) * 100}%`);
      btn.style.setProperty("--ry", `${((e.clientY - r.top) / r.height) * 100}%`);
      btn.classList.add("btn--pressed");
      haptic("light");
    },
    { passive: true },
  );

  for (const ev of ["pointerup", "pointercancel"]) {
    document.addEventListener(ev, release, { passive: true });
  }
}

/**
 * Касание мимо поля убирает клавиатуру.
 *
 * Экранная клавиатура занимает половину экрана и в Telegram сама не
 * закрывается: поле остаётся в фокусе, пока человек не нажмёт «Готово».
 * Снимаем фокус при касании по любому месту, кроме самого поля и кнопок —
 * кнопке фокус нужен, иначе нажатие потеряется вместе с клавиатурой.
 */
function dismissKeyboard() {
  document.addEventListener(
    "pointerdown",
    (e) => {
      const active = document.activeElement;
      if (!active || !active.matches?.("input, textarea")) return;
      if (e.target?.closest?.("input, textarea, .btn, button, label")) return;
      active.blur();
    },
    { passive: true },
  );
}

function catchErrors() {
  const show = (what) => {
    toast(String(what?.message ?? what ?? "неизвестная ошибка"), { error: true, ms: 12000 });
  };
  window.addEventListener("error", (e) => show(e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => show(e.reason));
}

async function boot() {
  catchErrors();
  pressFeedback();
  dismissKeyboard();
  mountBackground();
  initTelegram();

  root.append(splashScreen());

  if (!isCryptoAvailable()) {
    clear(root);
    root.append(
      el("div.screen", {}, [
        el("div.screen__spacer"),
        el("div.note.note--danger", {
          text: "Браузер не даёт доступ к шифрованию или хранилищу. Откройте приложение в обычном режиме, без приватного окна.",
        }),
        el("div.screen__spacer"),
      ]),
    );
    return;
  }

  /*
   * Splash не только для красоты: за это время подгружаются крипто-чанки
   * и, главное, шрифты. Если уйти со splash раньше, первый экран сначала
   * нарисуется системным шрифтом и переверстается на глазах.
   *
   * Ждём оба события, но не дольше 2.5 с: на медленной сети лучше
   * показать интерфейс системным шрифтом, чем держать заставку.
   */
  const settled = Promise.all([
    document.fonts?.ready ?? Promise.resolve(),
    document.fonts?.load?.("900 30px \"Unbounded Variable\"") ?? Promise.resolve(),
    document.fonts?.load?.("400 15px \"Inter Variable\"") ?? Promise.resolve(),
    // Второй аргумент важен: по нему браузер поймёт, что нужна кириллица,
    // и подтянет именно её подмножество, а не только латиницу.
    document.fonts?.load?.("900 26px \"Unbounded Variable\"", "Окшел") ?? Promise.resolve(),
    document.fonts?.load?.("650 16px \"Manrope Variable\"", "Ротация") ?? Promise.resolve(),
    new Promise((r) => setTimeout(r, 1100)),
  ]);
  await Promise.race([settled, new Promise((r) => setTimeout(r, 2500))]);

  // Позицию камня запоминаем ДО того, как заставка исчезнет: по ней
  // посчитаем, откуда он летит на своё место на первом экране.
  const from = root.querySelector(".splash .gem")?.getBoundingClientRect();

  const next = hasWallet() ? "lock" : "intro";
  go(next);
  if (next === "intro") handoffGem(from);
}

/**
 * Бесшовная передача камня с заставки на первый экран.
 *
 * Экраны — разные узлы, общего элемента между ними нет. Поэтому меряем,
 * где камень стоял, где он оказался, и проигрываем разницу: он въезжает
 * из старой точки в новую, а не появляется вместе со всем остальным.
 * Остальной экран в это время придерживаем, иначе перелёт теряется
 * в общем проявлении.
 */
function handoffGem(from) {
  const to = root.querySelector(".intro__gem .hero");
  const gem = root.querySelector(".intro__gem .gem");
  if (!from || !to || !gem || !to.animate) return;

  // Меряем по самому камню: обёртка на заставке сжата по содержимому,
  // а на первом экране растянута во всю ширину — по ней масштаб вышел бы
  // втрое меньше настоящего. Двигаем при этом обёртку: свечение должно
  // ехать вместе с камнем.
  const r = gem.getBoundingClientRect();
  if (!r.width) return;

  const dx = from.left + from.width / 2 - (r.left + r.width / 2);
  const dy = from.top + from.height / 2 - (r.top + r.height / 2);
  const scale = from.width / r.width;

  const screen = to.closest(".screen");
  screen?.classList.add("handoff");

  const anim = to.animate(
    [
      { transform: `translate3d(${dx}px, ${dy}px, 0) scale(${scale})` },
      { transform: "translate3d(0, 0, 0) scale(1)" },
    ],
    { duration: 860, easing: "cubic-bezier(0.22, 0.9, 0.24, 1)" },
  );

  /*
   * Класс не снимаем. Пока он висит, у экрана отключено собственное
   * появление; стоило его убрать — и screen-in запускалась заново, уже
   * после перелёта: экран гаснул и проявлялся второй раз. Анимации внутри
   * объявлены с both, поэтому конечное состояние держится само.
   */
  void anim;
}

boot();
