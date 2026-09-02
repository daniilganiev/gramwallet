import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";

import { el, copyText } from "../dom.js";
import { linkButton, primaryButton, runAction, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { replaceMnemonic } from "../../crypto/vault.js";
import { TgWallet } from "../../core/wallet.js";
import { requirePin } from "./lock.js";

/**
 * Смена ключа. Адрес при этом не меняется — он посчитан от первого ключа
 * и зафиксирован навсегда. Поэтому новый бэкап обязан содержать и фразу,
 * и адрес: по одной фразе кошелёк потом не найти.
 */
export function rotateScreen(ctx) {
  // Сессии может не быть после перезагрузки страницы — уводим на PIN.
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const screen = el("div.screen.stack.rotate");
  let stage = "warn";
  let mnemonic = null;

  const render = () => {
    screen.replaceChildren(...({ warn, phrase, verify }[stage]()));
  };

  const warn = () => [
    el("h1.glow", { "data-t": "Смена seed-фразы", text: "Смена seed-фразы" }),
    el("p.lead", {
      text: "Кошелёк получит новую seed-фразу. Адрес, баланс и история останутся прежними.",
    }),

    el("div.glass", {}, [
      el("div.rotate__row", { text: "Старая фраза перестанет работать сразу." }),
      el("div.rotate__row", { text: "Отката нет — контракт не помнит прежние ключи." }),
      el("div.rotate__row", { text: "Менять фразу можно сколько угодно раз." }),
    ]),

    el("p.screen__hint", {
      text: "Новую фразу сохраните вместе с адресом: после смены адрес из фразы уже не выводится.",
    }),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [
      primaryButton("Продолжить", async () => {
        mnemonic = await mnemonicNew(24);
        stage = "phrase";
        render();
      }),
      linkButton("Отмена", () => ctx.go("settings")),
    ]),
  ];

  const phrase = () => [
    el("h1.glow", { "data-t": "Новая seed-фраза", text: "Новая seed-фраза" }),
    el("p.lead", { text: "Запишите её целиком. Старая перестанет работать сразу после смены." }),

    el(
      "div.glass",
      {}, [
        el(
          "div.words",
          {},
          mnemonic.map((w, i) =>
            el("div.word", {}, [el("span.word__n", { text: String(i + 1) }), el("span", { text: w })]),
          ),
        ),
      ],
    ),

    el("div.glass.glass--tight", {}, [
      el("div.faint", { text: "Адрес кошелька — сохраните вместе с фразой" }),
      el("div.mono", { text: ctx.wallet.address.toString({ bounceable: true }) }),
    ]),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [
      primaryButton("Я записал", () => {
        stage = "verify";
        render();
      }),
      linkButton("Скопировать фразу и адрес", async () => {
        const ok = await copyText(
          `${mnemonic.join(" ")}\n\nАдрес: ${ctx.wallet.address.toString({ bounceable: true })}`,
        );
        toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
      }),
    ]),
  ];

  const verify = () => {
    const indexes = [...new Set([1, 1 + Math.floor(Math.random() * 22), 24])].sort((a, b) => a - b);
    const inputs = indexes.map((n) =>
      el("input.input", {
        type: "text",
        autocapitalize: "none",
        autocomplete: "off",
        spellcheck: false,
        placeholder: `Слово №${n}`,
      }),
    );
    const error = el("div.field__error", { style: "display:none" });

    const apply = el("button.btn.btn--primary", {
      type: "button",
      text: "Сменить seed-фразу",
      onclick: () =>
        runAction(
          apply,
          async () => {
            const wrong = indexes.some((n, i) => inputs[i].value.trim().toLowerCase() !== mnemonic[n - 1]);
            if (wrong) {
              error.textContent = "Слова не совпали. Проверьте запись.";
              error.style.display = "";
              haptic("error");
              return;
            }

            const pin = await requirePin();
            if (!pin) return;

            const newKeyPair = await mnemonicToPrivateKey(mnemonic);
            const res = await ctx.wallet.changePublicKey(newKeyPair);

            if (!res.confirmed) {
              return toast("Запрос ушёл, но подтверждения нет. Проверьте кошелёк через минуту.", {
                error: true,
              });
            }
            if (!res.keyChanged) {
              return toast("Операция прошла, но ключ в контракте прежний.", { error: true });
            }

            // Фраза меняется, адрес — нет.
            await replaceMnemonic(mnemonic, pin);
            ctx.session.mnemonic = mnemonic;
            ctx.wallet = await TgWallet.fromMnemonic(mnemonic, {
              network: ctx.wallet.network,
              address: ctx.wallet.address,
            });

            haptic("success");
            toast("Ключ сменён. Адрес остался прежним.");
            ctx.go("home");
          },
          { loadingText: "Меняем ключ" },
        ),
    });

    return [
      el("h1.glow", { "data-t": "Проверим запись", text: "Проверим запись" }),
      el("p.lead", { text: "Введите три слова из новой фразы — так мы убедимся, что она сохранена." }),
      el("div.glass", {}, indexes.map((n, i) =>
        el("label.field", {}, [el("span.field__label", { text: `Слово №${n}` }), inputs[i]]),
      )),
      error,
      el("div.screen__spacer"),
      el("div.screen__actions", {}, [
        apply,
        linkButton("Показать фразу снова", () => {
          stage = "phrase";
          render();
        }),
      ]),
    ];
  };

  render();
  return screen;
}
