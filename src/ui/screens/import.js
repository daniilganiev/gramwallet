import { el, fmtCoins, shortAddress } from "../dom.js";
import { glassButton, linkButton, runAction, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { Providers } from "../../core/client.js";
import { detectWallet, verifyByAddress } from "../../core/detect.js";
import { SCHEME, keyPairFor, schemesOf } from "../../core/mnemonic.js";

/** Чем меньше, тем живее находка. */
const RANK = { wallettg: 0, rotated: 1, foreign: 2, empty: 3 };

/**
 * Импорт с защитой от чужих сид-фраз.
 *
 * Если человек введёт фразу от Tonkeeper, мы не покажем ему пустой адрес —
 * мы назовём тип его кошелька и откажем. Иначе он решит, что деньги пропали.
 */
export function importScreen(ctx) {
  const phrase = el("textarea.input", {
    placeholder: "12 или 24 слова через пробел",
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
          if (words.length !== 12 && words.length !== 24) {
            haptic("error");
            return toast(`Нужно 12 или 24 слова, а введено ${words.length}`, { error: true });
          }
          const schemes = await schemesOf(words);
          if (!schemes.length) {
            haptic("error");
            return toast("Такой seed-фразы не существует — проверь слова и порядок", { error: true });
          }

          // Фраза может пройти проверку обеих схем сразу. Первой пробуем
          // вероятную: 12 слов выдаёт Telegram, 24 — обычно наш клиент.
          const likely = words.length === 12 ? SCHEME.BIP39 : SCHEME.TON;
          schemes.sort((a, b) => (b === likely) - (a === likely));
          const candidates = [];
          for (const scheme of schemes) {
            candidates.push({ scheme, keyPair: await keyPairFor(words, scheme) });
          }

          const providers = new Providers(ctx.network);
          const typed = address.value.trim();

          // Указан адрес — единственный корректный путь для кошелька,
          // у которого меняли ключ: сверяем ключ из фразы с контрактом.
          if (typed) {
            let res;
            for (const { scheme, keyPair } of candidates) {
              res = await verifyByAddress(typed, keyPair.publicKey, providers);
              if (res.ok) return finish(ctx, words, res.address.toString({ bounceable: true }), scheme);
            }
            haptic("error");
            return setStatus(el("div.note.note--danger", { text: res.reason }));
          }

          // Адрес не указан — ищем, что вообще стоит за этой фразой.
          // При двух схемах берём ту, что привела к самому живому кошельку.
          let found;
          let scheme;
          for (const c of candidates) {
            const next = await detectWallet(c.keyPair.publicKey, providers, ctx.network);
            if (!found || RANK[next.kind] < RANK[found.kind]) {
              found = next;
              scheme = c.scheme;
            }
            if (found.kind === "wallettg") break;
          }

          if (found.kind === "wallettg") {
            return finish(ctx, words, found.address.toString({ bounceable: true }), scheme);
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
                  finish(ctx, words, found.address.toString({ bounceable: true }), scheme),
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
      text: "Введи seed-фразу от кошелька, созданного в этом клиенте, в Telegram Wallet или самостоятельно через контракт WalletTg",
    }),

    el("div.note.note--ok", {}, [
      el("strong", { text: "Кошелёк из Telegram Wallet переносится целиком" }),
      el("div", {
        text: "В настройках Telegram Wallet нажми «Показать секретную фразу» и вставь сюда все слова — 12 или 24. Адрес и баланс останутся прежними.",
      }),
    ]),

    el("p.screen__hint", {
      text: "Фразы от Tonkeeper и других приложений с обычными кошельками здесь не работают — у них другой тип контракта.",
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

function finish(ctx, mnemonic, address, scheme) {
  haptic("success");
  ctx.draft = { mnemonic, address, scheme };
  ctx.go("pin");
}
