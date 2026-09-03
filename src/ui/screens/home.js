import { fromNano, toNano } from "@ton/core";

import { el, copyText } from "../dom.js";
import { copyButton, diamond, glassButton, linkButton, primaryButton, runAction, sheet, terminal, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN, MIN_DEPLOY_BALANCE } from "../../core/constants.js";
import { explainError } from "../../core/client.js";
import { fetchJettons, fetchNfts } from "../../core/assets.js";

/**
 * Последнее, что мы видели на кошельке.
 *
 * Живёт вне экрана: при возврате с отправки или из истории цифры должны
 * стоять на месте сразу, а не мигать заново полосой ожидания. Свежесть
 * догонит их через секунду сама.
 */
const seen = { address: null, balance: null, jettons: null, nfts: null, deployed: null };

/** Баланс спрашиваем часто: это дешёвый запрос к ноде. */
const BALANCE_EVERY = 5000;

/**
 * Токены и NFT — редко. Их отдаёт индексатор с лимитом около запроса
 * в секунду, и на каждый круг их уходит два. Чаще — гарантированные 429
 * и пустые списки вместо балансов.
 */
const ASSETS_EVERY = 30000;

/**
 * Сколько ждём пополнение после нажатия «Я пополнил»: перевод доходит
 * за несколько секунд, и отвечать «не видно» раньше — значит спорить
 * с человеком о том, что он только что сделал.
 */
const LOOK_FOR_TOPUP_MS = 12000;

/** Баланс всегда с тремя знаками: цифра не прыгает по ширине при обновлении. */
function grams(nano) {
  const [whole, frac = ""] = fromNano(nano ?? 0n).split(".");
  return `${whole}.${(frac + "000").slice(0, 3)}`;
}

export function homeScreen(ctx) {
  // Сюда можно попасть после перезагрузки страницы, когда расшифрованной
  // сессии в памяти уже нет: молча уводим на ввод PIN, а не падаем.
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const wallet = ctx.wallet;
  const addressText = wallet.address.toString({ bounceable: false });

  // Кошелёк сменился — прошлые цифры не наши.
  if (seen.address !== addressText) {
    seen.address = addressText;
    seen.balance = null;
    seen.jettons = null;
    seen.nfts = null;
    seen.deployed = null;
  }

  // Вспышка по плашке — подтверждение прямо там, куда человек нажал.
  const flash = el("span.address__flash", { "aria-hidden": "true" });

  const copy = async () => {
    const ok = await copyText(addressText);
    haptic(ok ? "light" : "error");
    if (ok) {
      flash.classList.remove("address__flash--on");
      // Перезапуск анимации: без чтения раскладки браузер не заметит,
      // что класс снимали, и второе нажатие пройдёт без вспышки.
      void flash.offsetWidth;
      flash.classList.add("address__flash--on");
    }
    toast(ok ? "Адрес скопирован" : "Не удалось скопировать", { error: !ok });
    return ok;
  };

  const balanceValue = el("span.balance__value");

  // Пока баланс не пришёл ни разу, на его месте идёт волна света по силуэту
  // цифры. Прочерк выглядел как ответ «ноль, и всё», а это ещё вопрос.
  const waiting = () => balanceValue.replaceChildren(el("span.balance__wait"));
  const showBalance = (nano) => {
    const text = grams(nano);
    // Ту же цифру не переписываем: иначе выделение текста слетает на каждом круге.
    if (balanceValue.textContent !== text) balanceValue.textContent = text;
  };
  if (seen.balance === null) waiting();
  else showBalance(seen.balance);

  // Камень у баланса: по нажатию коротко раскручивается и мигает светом.
  // Класс снимаем по концу анимации, иначе второе нажатие ничего не даст.
  const gem = el("button.balance__gem", {
    type: "button",
    "aria-label": "Gram Wallet",
    onclick: () => {
      if (gem.classList.contains("gem-tap")) return;
      gem.classList.add("gem-tap");
      haptic("light");
    },
  }, [diamond(46)]);

  /*
   * Класс снимаем только когда закончился сам оборот. На камне идут две
   * анимации сразу — вращение и вспышки, — и они всплывают сюда обеими
   * событиями. Первое же снимало класс и обрывало вторую на полукадре:
   * камень заметно дёргался в самом конце.
   */
  gem.addEventListener("animationend", (e) => {
    if (e.animationName === "gem-tap-spin") gem.classList.remove("gem-tap");
  });

  // Первый оборот камень делает сам: иначе про то, что он живой, никто
  // не узнает — по камню на главном экране обычно не тыкают.
  requestAnimationFrame(() => gem.classList.add("gem-tap"));
  const status = el("div.home__status");
  const assets = el("div.home__assets");
  const actions = el("div.screen__actions");

  const copyBtn = copyButton("Скопировать адрес", (e) => {
    e.stopPropagation();
    return copy();
  });

  /*
   * «Что нового» покачивается: на главном экране нет ничего движущегося,
   * кроме камня, и неподвижную плашку человек просто не замечает.
   */
  const whatsNew = el("button.whatsnew", {
    type: "button",
    onclick: () => {
      haptic("light");
      sheet({
        title: "Что нового",
        body: el("div", {}, [
          el("p", { text: "В этой версии кошелька ты можешь протестировать ключевые доступные функции:" }),
          el("div.whatsnew__list", {}, [
            el("div.whatsnew__item", { text: "1. Смену seed-фразы — в настройках." }),
            el("div.whatsnew__item", { text: "2. Пакетную отправку — кнопка «Отправить», внизу «Пакетная отправка»." }),
          ]),
          el("p", { text: "После того как запустится официальный Gram Wallet, этот кошелёк должен открыться там." }),
        ]),
        confirmText: null,
        cancelText: "Закрыть",
      });
    },
  }, [
    el("span.whatsnew__glow", { "aria-hidden": "true" }),
    el("span.whatsnew__spark", { text: "✦" }),
    el("span.whatsnew__text", { text: "Что нового" }),
  ]);

  const screen = el("div.screen.stack.home", {}, [
    el("h1.glow", { "data-t": "Ваш кошелёк", text: "Ваш кошелёк" }),

    // Адрес показываем целиком: по обрезанному нельзя проверить, туда ли
    // отправляешь, а именно этим человек и занимается на этом экране.
    // Нажатие по всей карточке копирует — попасть в неё проще, чем в кнопку.
    el("div.glass.address", { onclick: () => copyBtn.run() }, [
      el("span.address__sheen", { "aria-hidden": "true" }),
      flash,
      el("div.address__text", {}, [
        el("div", { text: addressText.slice(0, 24) }),
        el("div", { text: addressText.slice(24) }),
      ]),
      copyBtn.node,
    ]),

    el("div.balance-box", {}, [
      el("div.balance__label", { text: "Баланс" }),
      el("div.balance", {}, [gem, balanceValue, el("span.balance__coin", { text: COIN })]),
    ]),

    status,
    assets,
    actions,

    // Плашка висит в пустом месте между кнопкой и нижним рядом: два
    // распорки по бокам держат её ровно посередине этого промежутка.
    el("div.screen__spacer"),
    el("div.whatsnew-slot", {}, [whatsNew]),
    el("div.screen__spacer"),

    el("div.home__nav", {}, [
      linkButton("История", () => ctx.go("history")),
      linkButton("Настройки", () => ctx.go("settings")),
    ]),
  ]);

  /*
   * Прокрутка своя, а не scrollIntoView({behavior:"smooth"}).
   *
   * Родная плавная прокрутка идёт вне кадрового цикла страницы, и вместе
   * с исчезновением большого блока браузер пересобирает слои — на телефоне
   * это видно как рывок. Здесь всё в одном requestAnimationFrame.
   */
  const glideTo = (top, ms = 480) =>
    new Promise((resolve) => {
      const from = screen.scrollTop;
      const dist = Math.max(0, top) - from;
      if (Math.abs(dist) < 1) return resolve();
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        // Плавный вход и выход, без рывка в конце.
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        screen.scrollTop = from + dist * e;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });

  /** Подвести блок под верхнюю кромку экрана, оставив немного воздуха. */
  const glideToNode = (node, pad = 16) =>
    glideTo(
      screen.scrollTop + node.getBoundingClientRect().top - screen.getBoundingClientRect().top - pad,
    );

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---- Токены и NFT ----------------------------------------------------- */

  const section = (title, items, empty, render) =>
    el("div.assets", {}, [
      el("div.assets__title", { text: title }),
      items === null
        ? el("p.faint", { text: "Не удалось спросить индексатор." })
        : items.length === 0
          ? el("p.faint", { text: empty })
          : el("div.assets__list", {}, items.map(render)),
    ]);

  /** Отпечаток списков: пока он тот же, разметку не трогаем вообще. */
  const stamp = (jettons, nfts) =>
    JSON.stringify([
      jettons?.map((j) => [j.jetton, j.amount, j.symbol]) ?? null,
      nfts?.map((n) => [n.address, n.name, n.collection]) ?? null,
    ]);

  let painted = null;

  /**
   * Списки перерисовываем только когда они изменились.
   *
   * Раньше на каждый заход экран сначала писал «смотрим, что на кошельке»,
   * потом подставлял ровно то же самое. Обновление должно быть незаметным:
   * человек узнаёт о нём по новой цифре, а не по мельтешению блоков.
   */
  const paintAssets = (jettons, nfts, fromCache = false) => {
    const next = stamp(jettons, nfts);
    if (next === painted) return;
    const first = painted === null;
    painted = next;

    assets.replaceChildren(
      section("Токены", jettons, "Пока пусто.", (j) =>
        el("div.asset", {}, [
          el("span.asset__name", { text: j.symbol }),
          el("span.asset__value", { text: j.amount }),
        ]),
      ),
      section("NFT", nfts, "Пока пусто.", (n) =>
        el("div.asset", {}, [
          el("span.asset__name", { text: n.name }),
          el("span.asset__value", { text: n.collection }),
        ]),
      ),
    );
    // Мягко проявляется только первый показ за сеанс. Возврат с другого экрана
    // рисует списки из памяти сразу — мигать там нечему.
    assets.classList.toggle("home__in", first && !fromCache);
  };

  const loadAssets = async () => {
    const [jettons, nfts] = await Promise.all([
      fetchJettons(addressText, wallet.network).catch(() => null),
      fetchNfts(addressText, wallet.network).catch(() => null),
    ]);
    // Молчание индексатора — не новость: держим на экране прошлые списки.
    if (jettons === null && nfts === null && painted !== null) return null;
    seen.jettons = jettons;
    seen.nfts = nfts;
    return [jettons, nfts];
  };

  /**
   * Пока о токенах ничего не известно, на их месте стоят те же две секции
   * с полосой ожидания. Блоки не должны появляться и пропадать: кнопки под
   * ними прыгали бы по экрану на каждом заходе.
   */
  const skeleton = () =>
    assets.replaceChildren(
      ...["Токены", "NFT"].map((title) =>
        el("div.assets", {}, [
          el("div.assets__title", { text: title }),
          el("div.assets__list", {}, [
            el("div.asset", {}, [
              el("span.asset__skel"),
              el("span.asset__skel.asset__skel--sm"),
            ]),
          ]),
        ]),
      ),
    );

  if (seen.jettons !== null || seen.nfts !== null) paintAssets(seen.jettons, seen.nfts, true);
  else skeleton();

  /* ---- Состояние кошелька ------------------------------------------------ */

  // Что сейчас на экране: пока режим не сменился, кнопки не пересобираем —
  // иначе палец попадает по кнопке, которую только что заменили.
  let mode = null;
  let busy = false;

  const showReady = () => {
    if (mode === "ready") return;
    mode = "ready";
    status.replaceChildren();
    actions.replaceChildren(primaryButton("Отправить", () => ctx.go("send")));
  };

  const showTopUp = () => {
    if (mode === "wait") return;
    mode = "wait";
    assets.replaceChildren();
    painted = null;
    status.replaceChildren(
      el("div.note", {}, [
        el("div", { text: `Для деплоя пополни баланс на ${MIN_DEPLOY_BALANCE} ${COIN}.` }),
        el("div.note__more", { text: "Не рекомендуем отправлять большие суммы." }),
      ]),
    );

    const check = el("button.btn.btn--primary", {
      type: "button",
      text: "Я пополнил",
      onclick: () =>
        runAction(
          check,
          async () => {
            /*
             * Смотрим несколько раз подряд, а не один.
             *
             * Человек жмёт кнопку сразу, как отправил перевод, а тому нужно
             * несколько секунд до включения в блок. Один запрос успевал
             * ответить «пусто» — и получалось, что кошелёк спорит с тем, что
             * человек только что сделал своими руками.
             */
            const need = toNano(MIN_DEPLOY_BALANCE);
            const deadline = Date.now() + LOOK_FOR_TOPUP_MS;
            let now = 0n;

            for (;;) {
              now = (await wallet.getState()).balance ?? 0n;
              seen.balance = now;
              showBalance(now);
              if (now >= need) break;
              if (Date.now() >= deadline) {
                haptic("error");
                toast(`Пополнения пока не видно.\nНужно хотя бы ${MIN_DEPLOY_BALANCE} ${COIN}.`, {
                  error: true,
                });
                return;
              }
              await sleep(2500);
            }

            await runDeploy(now);
          },
          { loadingText: "Ищем пополнение" },
        ),
    });

    actions.replaceChildren(check);
  };

  const showError = (text) => {
    if (mode === "error") return;
    mode = "error";
    status.replaceChildren(el("div.note.note--danger", { text }));
    actions.replaceChildren();
  };

  /** Один круг опроса: баланс и признак деплоя. */
  const pullState = async () => {
    if (busy) return;
    try {
      const state = await wallet.getState();
      seen.balance = state.balance ?? 0n;
      seen.deployed = state.state === "active";
      showBalance(seen.balance);
      if (seen.deployed) showReady();
      else showTopUp();
    } catch (e) {
      // Сеть моргнула — прошлые цифры честнее прочерка. Ругаемся только
      // тогда, когда показывать ещё нечего.
      if (seen.balance === null) showError(explainError(e));
    }
  };

  /** Один круг опроса списков. Только для развёрнутого кошелька. */
  const pullAssets = async () => {
    if (busy || mode !== "ready") return;
    const got = await loadAssets();
    if (got) paintAssets(got[0], got[1]);
  };

  /* ---- Деплой ------------------------------------------------------------ */

  /** Деплой на глазах: то же окно терминала, что и при создании кошелька. */
  const runDeploy = async (balance) => {
    const term = terminal({ name: "node · javascript", meta: "@ton/ton · ed25519", compact: true });

    /*
     * Пока идёт деплой, ниже терминала не должно быть ничего.
     *
     * Раньше сразу после подтверждения там просыпался список токенов и
     * кнопка «Отправить»: экран дёргался под руками, а лог читать мешало.
     * На это время терминал и есть экран, остальное вернётся, когда человек
     * сам его закроет.
     */
    busy = true;
    mode = "deploy";
    assets.replaceChildren();
    actions.replaceChildren();
    painted = null;
    status.replaceChildren(term.node);
    glideToNode(term.node);

    term.write("$ node deploy.js", "cmd");
    term.write(`Кошелёк: ${addressText}`, "val");
    term.write(`Баланс:  ${grams(balance)} ${COIN}`, "val");
    term.write("Собираем внешнее сообщение со stateInit…", "out");
    term.write("Подпись ed25519 — на этом устройстве.", "out");
    term.write("Отправляем в сеть и ждём подтверждения…", "wait");

    /** Кнопка живёт при логе, а не внизу экрана: она относится к нему. */
    const under = (label, onclick) => status.append(glassButton(label, onclick));

    /** Выйти из режима деплоя: дальше экран снова живёт сам. */
    const resume = () => {
      busy = false;
      mode = null;
      pullState();
    };

    try {
      const res = await wallet.deploy();
      if (!res.confirmed) {
        term.write("Сообщение ушло, подтверждения пока нет.", "wait");
        term.write("Сеть иногда думает дольше минуты — нажми «Обновить».", "out");
        term.done();
        under("Обновить", resume);
        return;
      }
      term.write(`seqno: ${res.seqno} → ${res.seqno + 1}`, "val");
      term.write("Готово. Кошелёк создан в блокчейне.", "done");
      term.done();
      haptic("success");

      /*
       * Терминал не убираем сам. Это единственное место, где видно, что
       * именно ушло в сеть, — человек вправе его перечитать и пролистать.
       * Свежий баланс и списки готовим молча, в фоне: к моменту закрытия
       * всё уже на месте, и ждать второй раз не придётся.
       */
      const ready = Promise.all([
        wallet.getState().then((s) => s.balance ?? 0n).catch(() => null),
        loadAssets().catch(() => null),
      ]);

      under("Закрыть терминал", async () => {
        haptic("light");
        const [fresh, list] = await ready;

        /*
         * Сначала возвращаем взгляд наверх и только потом убираем лог.
         * Если снять его сразу, страница схлопывается под скроллом, и экран
         * прыгает сам — это и выглядело как рывок к балансу.
         */
        await glideTo(0);
        status.classList.add("home__status--out");
        await sleep(260);

        status.classList.remove("home__status--out");
        status.replaceChildren();

        busy = false;
        mode = "ready";
        if (fresh !== null) {
          seen.balance = fresh;
          showBalance(fresh);
        }
        actions.replaceChildren(primaryButton("Отправить", () => ctx.go("send")));
        actions.classList.add("home__in");
        if (list) paintAssets(list[0], list[1]);
        else pullAssets();
      });
    } catch (e) {
      term.write(explainError(e), "danger");
      term.done();
      under("Попробовать снова", resume);
    }
  };

  /* ---- Ход экрана -------------------------------------------------------- */

  /*
   * Экран сам держит цифры свежими, пока открыт. Роутер экраны просто
   * заменяет, отдельного «закрыть» у него нет, поэтому признак жизни —
   * связь с документом: как только узел из него вышел, таймеры снимаем.
   */
  const timers = [
    setInterval(() => (screen.isConnected ? pullState() : timers.forEach(clearInterval)), BALANCE_EVERY),
    setInterval(() => (screen.isConnected ? pullAssets() : timers.forEach(clearInterval)), ASSETS_EVERY),
  ];

  /*
   * Кнопку рисуем до первого ответа сети — по прошлому известному состоянию.
   * Иначе при каждом возврате с другой страницы она пропадала на секунду и
   * появлялась заново, утаскивая за собой весь низ экрана.
   */
  if (seen.deployed === true) showReady();
  else if (seen.deployed === false) showTopUp();

  pullState().then(pullAssets);
  return screen;
}
