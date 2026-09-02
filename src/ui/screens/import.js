import { mnemonicToPrivateKey, mnemonicValidate } from "@ton/crypto";

import { el, fmtCoins, shortAddress } from "../dom.js";
import { glassButton, linkButton, runAction, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { Providers } from "../../core/client.js";
import { detectWallet, verifyByAddress } from "../../core/detect.js";

/**
 * Импорт с защитой от чужих сид-фраз.
 *
 * Если человек введёт фразу от Tonkeeper, мы не покажем ему пустой адрес —
 * мы назовём тип его кошелька и откажем. Иначе он решит, что деньги пропали.
 */
export function importScreen(ctx) {
  const phrase = el("textarea.input", {
    placeholder: "Двадцать четыре слова через пробел",
    autocapitalize: "none",
    autocomplete: "off",
    spellcheck: false,
  });
  const address = el("input.input", {
    type: "text",
    placeholder: "EQ… или UQ… (необязательно)",
    autocapitalize: "none",
    autocomplete: "off",
    spellcheck: false,
  });

  const status = el("div.status");

  // Без аргумента блок остаётся по-настоящему пустым и не занимает строку.
  const setStatus = (node) => (node ? status.replaceChildren(node) : status.replaceChildren());

  const go = el("button.btn.btn--primary", {
    type: "button",
    text: "Восстановить",
    onclick: () =>
      runAction(
        go,
        async () => {
          setStatus(null);

          const words = phrase.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
          if (words.length !== 24) {
            haptic("error");
            return toast(`Нужно 24 слова, а введено ${words.length}`, { error: true });
          }
          if (!(await mnemonicValidate(words))) {
            haptic("error");
            return toast("Такой seed-фразы не существует — проверь слова и порядок", { error: true });
          }

          const keyPair = await mnemonicToPrivateKey(words);
          const providers = new Providers(ctx.network);
          const typed = address.value.trim();

          // Указан адрес — единственный корректный путь для кошелька,
          // у которого меняли ключ: сверяем ключ из фразы с контрактом.
          if (typed) {
            const res = await verifyByAddress(typed, keyPair.publicKey, providers);
            if (!res.ok) {
              haptic("error");
              return setStatus(el("div.note.note--danger", { text: res.reason }));
            }
            return finish(ctx, words, res.address.toString({ bounceable: true }));
          }

          // Адрес не указан — ищем, что вообще стоит за этой фразой.
          const found = await detectWallet(keyPair.publicKey, providers, ctx.network);

          if (found.kind === "wallettg") {
            return finish(ctx, words, found.address.toString({ bounceable: true }));
          }

          // Фраза от этого же кошелька, но до смены ключа: адрес живой,
          // а подписывать им уже нельзя.
          if (found.kind === "rotated") {
            haptic("error");
            return setStatus(
              el("div.note.note--danger", {}, [
                el("strong", { text: "Эта seed-фраза уже не действует" }),
                el("div", {
                  text: `Кошелёк ${shortAddress(found.address)} существует и на нём ${fmtCoins(found.balance)}, но ключ у него менялся. Нужна та seed-фраза, которую выдала последняя ротация, — и адрес кошелька в поле выше.`,
                }),
              ]),
            );
          }

          if (found.kind === "foreign") {
            haptic("error");
            return setStatus(
              el("div.note.note--danger", {}, [
                el("strong", { text: `Это фраза от кошелька ${found.label}` }),
                el("div", { text: `Деньги на месте — они лежат на ${shortAddress(found.address)} (${fmtCoins(found.balance)}). Но такой тип кошелька здесь не поддерживается: открой его в Tonkeeper или другом обычном кошельке.`,
                }),
              ]),
            );
          }

          /*
           * Кошелька в блокчейне нет. Это не обязательно чужая фраза: свой
           * кошелёк живёт в сети только после деплоя, а деплой платится с
           * него самого. Пока не пополнили — адрес пустой, хотя фраза
           * настоящая и адрес из неё выводится. Поэтому не отказываем,
           * а предлагаем подключить: терять тут нечего.
           */
          haptic("warning");
          setStatus(
            el("div.note", {}, [
              el("strong", { text: "В блокчейне такого кошелька пока нет" }),
              el("div", {
                text: `Фраза рабочая, из неё выводится адрес ${shortAddress(found.address)}. Скорее всего кошелёк ещё не пополняли — до первого пополнения его в сети не существует. Если ты менял seed-фразу, впиши адрес в поле выше: без него найти кошелёк невозможно.`,
              }),
              el("div.screen__actions", {}, [
                glassButton("Всё равно подключить", () =>
                  finish(ctx, words, found.address.toString({ bounceable: true })),
                ),
              ]),
            ]),
          );
        },
        { loadingText: "Проверяем" },
      ),
  });

  return el("div.screen.stack.import", {}, [
    el("h1.glow", { "data-t": "Восстановление кошелька", text: "Восстановление кошелька" }),
    el("p.lead", {
      text: "Введи seed-фразу от кошелька, созданного в этом клиенте или самостоятельно через контракт WalletTg",
    }),

    el("div.note", {
      text: "Фразы от Tonkeeper, кошелька в Telegram и других приложений здесь не работают — у них другой тип контракта. Не вводи их сюда.",
    }),

    el("div.glass", {}, [
      el("label.field", {}, [el("span.field__label", { text: "Seed-фраза" }), phrase]),
      el("label.field", {}, [
        el("span.field__label", { text: "Адрес кошелька — если менял ключ" }),
        address,
      ]),
    ]),

    el("p.screen__hint", {
      text: "После смены seed-фразы адрес кошелька уже не выводится из ключа, его нужно указать самостоятельно.",
    }),

    status,

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [go, linkButton("Назад", () => ctx.go("welcome"))]),
  ]);
}

function finish(ctx, mnemonic, address) {
  haptic("success");
  ctx.draft = { mnemonic, address };
  ctx.go("pin");
}
