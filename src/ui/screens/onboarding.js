import { el } from "../dom.js";
import { diamond, link, linkButton, primaryButton } from "../components.js";
import { COIN, REPO_URL } from "../../core/constants.js";

/**
 * В окне Telegram на компьютере высоты заметно меньше, чем на телефоне,
 * и камень в прежнем размере съедает весь экран. Считаем один раз при
 * сборке экрана — окно мини-приложения по ходу дела не меняется.
 */
const fit = (px) => Math.round(px * (window.innerHeight < 850 ? 0.74 : 1));

/** Камень со свечением вокруг: он и есть главный герой экрана. */
const hero = (size) =>
  el("div.hero", {}, [
    el("div.gem__halo"),
    diamond(size),
  ]);

export function splashScreen() {
  return el("div.splash", {}, [
    hero(fit(112)),
    el("div.splash__title", {}, [el("div", { text: "Gram" }), el("div", { text: "Wallet" })]),
  ]);
}

export function introScreen(ctx) {
  const feature = (title, text, soon = false) =>
    el("div.feature", {}, [
      el("div.feature__title", {}, [title, soon && el("span.badge", { text: "SOON" })]),
      el("p.feature__text", { text }),
    ]);

  return el("div.screen.screen--center.screen--fit.intro", {}, [
    el("div.intro__gem", {}, [hero(fit(78))]),

    // Заголовок сам меняется: сначала обещание, потом ощущение.
    el("h1.swap", {}, [
      // data-t дублирует надпись для размытой ауры позади букв.
      el("span.swap__i", { style: "--n:0", "data-t": "New wallet", text: "New wallet" }),
      el("span.swap__i", { style: "--n:1", "data-t": "New experience", text: "New experience" }),
      el("span.swap__i", { style: "--n:2", "data-t": "Gram Wallet", text: "Gram Wallet" }),
    ]),

    el("p.lead", {
      text: `Кошелёк работает на WalletTg — новом контракте для ${COIN} в сети TON (ещё в разработке).`,
    }),

    el("div.section", {}, [
      feature("Ротация ключа", "Меняй seed-фразу сколько угодно раз — адрес, история и баланс сохраняются."),
      feature("До 255 переводов за одну транзакцию", "Зачем — не знаем. Но можно."),
      feature(
        "Обновления без переезда",
        "Логика живёт в сети. Менять кошелёк, как было с v3 и v4, больше не придётся.",
      ),
      feature("2FA-подтверждения и платные подписки", "Будет удобно оплачивать Telegram Premium?", true),
    ]),

    el("div.screen__spacer"),

    el("div.screen__actions", {}, [primaryButton("Далее", () => ctx.go("safety"))]),
  ]);
}

export function safetyScreen(ctx) {
  const point = (...parts) => el("div.feature", {}, [el("p.feature__text", {}, parts)]);
  /** Смысловой акцент: то, ради чего пункт вообще написан. */
  const mark = (text) => el("span.mark", { text });

  return el("div.screen.screen--center.screen--fit.screen--wide.about", {}, [
    el("h1.glow", { "data-t": "О кошельке", text: "О кошельке" }),

    el("p.lead", {}, [
      "Это неофициальный клиент к публичному контракту ",
      link("WalletTg", REPO_URL),
      " с открытым исходным кодом, он позволяет уже сейчас создать и использовать новый кошелёк.",
    ]),

    el("div.section", {}, [
      point(
        "Создание кошелька происходит ",
        mark("прямо на вашем устройстве"),
        ", клиент не видит seed-фразы, ключ шифруется PIN-кодом и хранится только ",
        mark("в локальном хранилище"),
        ".",
      ),
      point(
        "Очистка кеша Telegram удаляет все данные, но вы сможете заново подключить кошелёк по seed-фразе.",
      ),
      point(
        "Кошелёк работает ",
        mark("в основной сети"),
        ", а не тестовой, доступны базовые функции: деплой, получение / отправка токенов и NFT, ротация seed-фразы.",
      ),
      point(
        "Другие кошельки контракт WalletTg пока ",
        mark("не поддерживают"),
        " — в Tonkeeper или MTW он не откроется.",
      ),
    ]),

    el("div.screen__spacer"),

    el("div.sticker", {}, [
      el("div.sticker__glow"),
      el("img.sticker__img", { src: "/utya.gif", alt: "", loading: "eager", decoding: "async" }),
      scribble(),
    ]),

    el("div.screen__spacer"),

    el("div.screen__actions", {}, [
      primaryButton("Понятно", () => ctx.go("welcome")),
      linkButton("Назад", () => ctx.go("intro")),
    ]),
  ]);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Рукописное «You're early» рядом с уткой.
 *
 * Буквы нарисованы одной линией каждая — так их можно «написать»:
 * штрих выкладывается через stroke-dashoffset, буква за буквой.
 * Шрифтом так не сделать: у глифа есть только контур, и обводка
 * обвела бы букву по краю, а не провела бы её пером.
 */
const STROKES = [
  // You're
  "M18 22 C24 42, 32 58, 42 70 C47 76, 51 78, 54 76 C60 72, 66 52, 72 24",
  "M54 76 C51 92, 46 104, 36 108 C29 111, 24 107, 26 102",
  "M92 52 C84 52, 79 60, 80 68 C81 76, 90 80, 96 74 C102 68, 102 56, 96 52 C93 50, 91 51, 90 53",
  "M112 52 C109 63, 109 72, 115 75 C121 78, 126 68, 127 52 C127 65, 127 74, 132 77",
  "M144 30 C146 37, 146 42, 144 47",
  "M156 78 C157 67, 159 58, 161 52 C162 59, 167 52, 174 52 C177 52, 179 54, 179 56",
  "M186 66 C193 66, 200 64, 203 59 C206 55, 203 50, 198 51 C191 52, 187 60, 189 68 C191 76, 200 79, 208 73",
  // early
  "M24 150 C31 150, 38 148, 41 143 C44 139, 41 134, 36 135 C29 136, 25 144, 27 152 C29 160, 38 163, 46 157",
  "M70 136 C63 132, 55 137, 55 147 C55 155, 62 160, 68 157 C73 155, 75 146, 73 136 C73 149, 73 157, 78 160",
  "M90 160 C91 149, 93 140, 95 136 C96 143, 101 136, 108 136 C111 136, 113 138, 113 140",
  "M126 160 C124 142, 126 118, 131 107 C134 99, 139 101, 137 112 C135 125, 129 143, 127 154 C126 160, 129 163, 134 160",
  "M146 136 C144 147, 146 157, 151 160 C156 163, 161 153, 162 136 C162 152, 160 174, 154 187 C149 197, 141 198, 136 193",
];

function scribble() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 220 205");
  svg.setAttribute("class", "scribble");
  svg.setAttribute("aria-hidden", "true");

  // Перо идёт по буквам подряд: каждая ждёт, пока допишется предыдущая.
  let delay = 0.35;
  for (const d of STROKES) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    path.style.animationDelay = `${delay.toFixed(2)}s`;
    svg.append(path);
    delay += 0.17;
  }
  return svg;
}

/**
 * Два щупальца, которыми брюлик поднимает упавшее слово.
 *
 * Рисуются под ним, поэтому не видно, откуда именно они выходят — только
 * то, что тянутся из-за камня. Форма пересчитывается каждый кадр: путь
 * идёт кривой Безье, контрольные точки которой ходят по синусу, отсюда
 * и болтанка. Слово в это время едет на css-переходе, а концы щупалец
 * держатся за его фактические координаты.
 */
function tentacles(screen, gem, word) {
  const SHOOT = 620; // выброс
  const GRAB = 320; // зацеп и натяжение
  const LIFT = 2100; // подъём слова — тяжёлое, тянут медленно
  const BACK = 700; // отцепились и втянулись

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "arms");

  const layer = document.createElementNS(SVG_NS, "g");
  svg.append(layer);

  const arms = [0, 1].map(() => {
    const g = document.createElementNS(SVG_NS, "g");
    const path = document.createElementNS(SVG_NS, "path");
    const tip = document.createElementNS(SVG_NS, "circle");
    tip.setAttribute("r", "3.2");
    g.append(path, tip);
    layer.append(g);
    return { path, tip };
  });
  screen.append(svg);

  const t0 = performance.now();

  const frame = (now) => {
    const t = now - t0;
    const sr = screen.getBoundingClientRect();
    const gr = gem.getBoundingClientRect();
    const wr = word.getBoundingClientRect();

    // Точка выхода — центр камня, а сам камень вырезан из слоя маской:
    // грани у него полупрозрачные, и без этого тросы просвечивали насквозь.
    const ox = gr.left + gr.width / 2 - sr.left;
    const oy = gr.top + gr.height * 0.4 - sr.top;
    // Силуэт камня в координатах экрана: viewBox у него "-10 -6 120 112".
    const k = gr.width / 120;
    const px = (v) => gr.left + (v + 10) * k - sr.left;
    const py = (v) => gr.top + (v + 6) * k - sr.top;
    const edges = [
      [35, 24],
      [65, 24],
      [92, 44],
      [50, 93],
      [8, 44],
    ].map(([x, y]) => [px(x), py(y)]);

    /** Точка, в которой луч из центра камня протыкает его грань. */
    const onEdge = (tx, ty) => {
      let best = null;
      let nearest = Infinity;
      for (let i = 0; i < edges.length; i++) {
        const [x1, y1] = edges[i];
        const [x2, y2] = edges[(i + 1) % edges.length];
        const den = (tx - ox) * (y2 - y1) - (ty - oy) * (x2 - x1);
        if (Math.abs(den) < 1e-6) continue;
        const t = ((x1 - ox) * (y2 - y1) - (y1 - oy) * (x2 - x1)) / den;
        const u = ((x1 - ox) * (ty - oy) - (y1 - oy) * (tx - ox)) / den;
        if (t >= 0 && t <= 1 && u >= 0 && u <= 1 && t < nearest) {
          nearest = t;
          best = [ox + (tx - ox) * t, oy + (ty - oy) * t];
        }
      }
      return best;
    };

    // Насколько щупальце выпущено: растёт, держится, потом втягивается.
    const out =
      t < SHOOT
        ? 1 - Math.pow(1 - t / SHOOT, 3)
        : t > SHOOT + GRAB + LIFT
          ? Math.max(0, 1 - (t - (SHOOT + GRAB + LIFT)) / BACK)
          : 1;

    const grabbed = t > SHOOT && t < SHOOT + GRAB + LIFT;

    /*
     * Слово наклонено, а getBoundingClientRect отдаёт габарит повёрнутого
     * блока — по нему левый край оказывается заметно выше, чем на самом
     * деле, и щупальце цепляется в воздух. Поэтому берём точки в системе
     * координат самого слова и поворачиваем их текущей матрицей.
     */
    const style = getComputedStyle(word);
    const matrix = new DOMMatrix(style.transform === "none" ? "" : style.transform);
    const tilt = Math.atan2(matrix.b, matrix.a);
    const cx = wr.left + wr.width / 2 - sr.left;
    const cy = wr.top + wr.height / 2 - sr.top;
    const halfW = word.offsetWidth / 2;
    const halfH = word.offsetHeight / 2;

    arms.forEach(({ path, tip }, i) => {
      /*
       * Цепляемся за самые углы слова. Ближе к середине точка попадала
       * в просвет между штрихами «M», и казалось, что щупальце держит воздух.
       */
      const dx = halfW * (i ? 0.96 : -0.88);
      // Строка выше самих литер, поэтому опускаемся к их верхней кромке.
      const dy = -halfH + 8;
      const tx = cx + dx * Math.cos(tilt) - dy * Math.sin(tilt);
      const ty = cy + dx * Math.sin(tilt) + dy * Math.cos(tilt);

      // Выходим ровно на кромке камня — оттуда щупальце и появляется.
      const [sx, sy] = onEdge(tx, ty) ?? [ox, oy];
      const ex = sx + (tx - sx) * out;
      const ey = sy + (ty - sy) * out;

      // Пока щупальце в воздухе — гуляет сильно, зацепившись — почти замирает.
      const swing = (grabbed ? 5 : 30) * out;
      const phase = now / 240 + i * 2.3;
      const c1x = sx + (ex - sx) * 0.35 + Math.sin(phase) * swing;
      const c1y = sy + (ey - sy) * 0.35 + Math.cos(phase * 0.7) * swing * 0.7;
      const c2x = sx + (ex - sx) * 0.72 + Math.sin(phase + 1.6) * swing * 0.7;
      const c2y = sy + (ey - sy) * 0.72 + Math.cos(phase + 1.2) * swing * 0.5;

      path.setAttribute("d", `M${sx},${sy} C${c1x},${c1y} ${c2x},${c2y} ${ex},${ey}`);
      tip.setAttribute("cx", ex);
      tip.setAttribute("cy", ey);
      tip.setAttribute("opacity", grabbed ? "0.9" : "0");
    });

    if (t > SHOOT + GRAB) word.classList.add("lifted");

    if (t < SHOOT + GRAB + LIFT + BACK) requestAnimationFrame(frame);
    else svg.remove();
  };

  requestAnimationFrame(frame);
}

export function welcomeScreen(ctx) {
  const gemBox = el("div.spin.welcome__gem", {}, [hero(fit(150))]);
  const fall = el("div.crash__fall", { text: "Gram" });

  const screen = el("div.screen.screen--roomy.welcome", {}, [
    el("div.screen__spacer"),

    gemBox,

    el("div.center", {}, [
      // Камень раскручивается, трясёт экран — и верхняя строка обрушивается на нижнюю.
      el("h1.chrome.crash", {}, [fall, el("div.crash__base", { text: "Wallet" })]),
    ]),

    el("div.screen__spacer"),

    el("div.screen__actions", {}, [
      primaryButton("Создать кошелёк", () => ctx.go("forge")),
      // Импорт убирать нельзя: данные браузера чистятся и сами по себе,
      // а человек с фразой на руках должен уметь вернуть доступ.
      linkButton("У меня есть seed-фраза", () => ctx.go("import")),
      linkButton("Назад", () => ctx.go("safety")),
    ]),
  ]);

  /*
   * Угол падения зависит от того, насколько слово шире высоты строки:
   * левый край должен дойти до основания нижней строки, а не остановиться
   * на её верхней кромке. Считаем по факту — ширина зависит от шрифта.
   */
  requestAnimationFrame(() => {
    const fr = fall.getBoundingClientRect();
    const base = screen.querySelector(".crash__base")?.getBoundingClientRect();
    if (!fr.width || !base) return;
    // Левый край должен дойти до линии букв нижней строки: ниже —
    // и слова превращаются в неразборчивую кашу.
    const drop = base.top - fr.top + base.height * 0.22;
    const angle = (Math.asin(Math.min(0.42, drop / fr.width)) * 180) / Math.PI;
    fall.style.setProperty("--fall", `${angle.toFixed(1)}deg`);
  });

  // Слово улеглось — камень сам достаёт щупальца и ставит его на место.
  setTimeout(() => {
    fall.classList.add("crash__fall--down");
    tentacles(screen, gemBox.querySelector(".gem"), fall);
  }, 4100);

  return screen;
}
