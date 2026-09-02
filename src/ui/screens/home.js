import { fromNano, toNano } from "@ton/core";

import { el, copyText } from "../dom.js";
import { diamond, glassButton, iconButton, linkButton, primaryButton, runAction, terminal, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN, MIN_DEPLOY_BALANCE } from "../../core/constants.js";
import { explainError } from "../../core/client.js";
import { fetchJettons, fetchNfts } from "../../core/assets.js";

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

  const copy = async () => {
    const ok = await copyText(addressText);
    haptic(ok ? "light" : "error");
    toast(ok ? "Адрес скопирован" : "Не удалось скопировать", { error: !ok });
  };

  const balanceValue = el("span.balance__value");

  // Пока баланс не пришёл, на его месте идёт волна света по силуэту цифры.
  // Прочерк выглядел как ответ «ноль, и всё», а это ещё вопрос.
  const waiting = () => balanceValue.replaceChildren(el("span.balance__wait"));
  const showBalance = (nano) => {
    balanceValue.textContent = grams(nano);
  };
  waiting();

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

  const screen = el("div.screen.stack.home", {}, [
    el("h1.glow", { "data-t": "Ваш кошелёк", text: "Ваш кошелёк" }),

    // Адрес показываем целиком: по обрезанному нельзя проверить, туда ли
    // отправляешь, а именно этим человек и занимается на этом экране.
    // Нажатие по всей карточке копирует — попасть в неё проще, чем в кнопку.
    el("div.glass.address", { onclick: copy }, [
      el("div.address__text", {}, [
        el("div", { text: addressText.slice(0, 24) }),
        el("div", { text: addressText.slice(24) }),
      ]),
      iconButton("⧉", "Скопировать адрес", (e) => {
        e.stopPropagation();
        copy();
      }),
    ]),

    el("div.balance-box", {}, [
      el("div.balance__label", { text: "Баланс" }),
      el("div.balance", {}, [gem, balanceValue, el("span.balance__coin", { text: COIN })]),
    ]),

    status,
    assets,
    actions,

    el("div.screen__spacer"),
    el("div.home__nav", {}, [
      linkButton("История", () => ctx.go("history")),
      linkButton("Настройки", () => ctx.go("settings")),
    ]),
  ]);

  /** Списки токенов и NFT. Индексатор может молчать — это не повод падать. */
  const loadAssets = async () => {
    assets.replaceChildren(el("p.dim", { text: "Смотрим, что на кошельке…" }));

    const [jettons, nfts] = await Promise.all([
      fetchJettons(addressText, wallet.network).catch(() => null),
      fetchNfts(addressText, wallet.network).catch(() => null),
    ]);

    const section = (title, items, empty, render) =>
      el("div.assets", {}, [
        el("div.assets__title", { text: title }),
        items === null
          ? el("p.faint", { text: "Не удалось спросить индексатор." })
          : items.length === 0
            ? el("p.faint", { text: empty })
            : el("div.assets__list", {}, items.map(render)),
      ]);

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
  };

  /** Деплой на глазах: то же окно терминала, что и при создании кошелька. */
  const runDeploy = async (balance) => {
    const term = terminal({ name: "node · javascript", meta: "@ton/ton · ed25519", compact: true });
    status.replaceChildren(term.node);

    term.write("$ node deploy.js", "cmd");
    term.write(`Кошелёк: ${addressText}`, "val");
    term.write(`Баланс:  ${grams(balance)} ${COIN}`, "val");
    term.write("Собираем внешнее сообщение со stateInit…", "out");
    term.write("Подпись ed25519 — на этом устройстве.", "out");
    term.write("Отправляем в сеть и ждём подтверждения…", "wait");

    try {
      const res = await wallet.deploy();
      if (!res.confirmed) {
        term.write("Сообщение ушло, подтверждения пока нет.", "wait");
        term.write("Сеть иногда думает дольше минуты — нажми «Обновить».", "out");
        term.done();
        actions.replaceChildren(glassButton("Обновить", () => refresh()));
        return;
      }
      term.write(`seqno: ${res.seqno} → ${res.seqno + 1}`, "val");
      term.write("Готово. Кошелёк создан в блокчейне.", "done");
      term.done();
      haptic("success");

      /*
       * Терминал не убираем сам. Это единственное место, где видно, что
       * именно ушло в сеть, — человек вправе его перечитать и пролистать.
       * Убирает он его сам, кнопкой; всё остальное на экране обновляем
       * молча, не трогая лог.
       */
      status.append(glassButton("Закрыть терминал", () => refresh()));

      try {
        const after = await wallet.getState();
        showBalance(after.balance ?? 0n);
        actions.replaceChildren(primaryButton("Отправить", () => ctx.go("send")));
        await loadAssets();
      } catch {
        // Цифры подождут: сам деплой уже подтверждён, и это главное.
      }
    } catch (e) {
      term.write(explainError(e), "danger");
      term.done();
      actions.replaceChildren(glassButton("Попробовать снова", () => refresh()));
    }
  };

  const refresh = async () => {
    waiting();
    try {
      const state = await wallet.getState();
      const deployed = state.state === "active";
      const balance = state.balance ?? 0n;
      showBalance(balance);

      if (deployed) {
        status.replaceChildren();
        actions.replaceChildren(primaryButton("Отправить", () => ctx.go("send")));
        await loadAssets();
        return;
      }

      assets.replaceChildren();
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
              waiting();
              const fresh = await wallet.getState();
              const now = fresh.balance ?? 0n;
              showBalance(now);

              if (now < toNano(MIN_DEPLOY_BALANCE)) {
                haptic("error");
                toast(`Пополнения пока не видно. Нужно хотя бы ${MIN_DEPLOY_BALANCE} ${COIN}.`, {
                  error: true,
                });
                return;
              }
              await runDeploy(now);
            },
            { loadingText: "Проверяем" },
          ),
      });

      actions.replaceChildren(check);
    } catch (e) {
      balanceValue.textContent = "—";
      status.replaceChildren(
        el("div.note.note--danger", { text: explainError(e) }),
        glassButton("Повторить", () => refresh()),
      );
    }
  };

  refresh();
  return screen;
}
