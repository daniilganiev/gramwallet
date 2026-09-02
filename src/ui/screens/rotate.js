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
 *
 * Необратимое действие стоит в самом конце, и до него человек видит слова
 * целиком. Раньше порядок читался наоборот: слова показывались там, где
 * кнопки «сменить» на экране уже не было, будто смена произошла, а дальше
 * шёл экзамен на три слова. С экзамена уходили кнопкой «назад» — уверенные,
 * что фраза новая, хотя кошелёк всё это время работал на старой.
 *
 * Двадцать четыре слова не помещаются в экран телефона вместе с адресом
 * и кнопкой, а листать их человек не обязан: пропущенное слово он заметит
 * только тогда, когда кошелёк уже понадобится. Поэтому фраза идёт двумя
 * половинами, каждая целиком в экране.
 */
export function rotateScreen(ctx) {
  // Сессии может не быть после перезагрузки страницы — уводим на PIN.
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const screen = el("div.screen.stack.rotate");
  const address = ctx.wallet.address.toString({ bounceable: true });
  let stage = "warn";
  let mnemonic = null;

  const render = () => {
    screen.replaceChildren(...({ warn, first, second }[stage]()));
    screen.scrollTop = 0;
  };

  const warn = () => [
    el("h1.glow", { "data-t": "Смена seed-фразы", text: "Смена seed-фразы" }),
    el("p.lead", {
      text: "Кошелёк получит новую seed-фразу. Адрес, баланс и история останутся прежними.",
    }),

    el("div.glass", {}, [
      el("div.rotate__row", { text: "Старая фраза перестанет работать" }),
      el("div.rotate__row", { text: "Вернуть её обратно нельзя" }),
      el("div.rotate__row", { text: "Менять фразу можно сколько угодно" }),
    ]),

    el("p.screen__hint", {
      text: "Новую фразу сохраните вместе с адресом: после смены адрес из фразы уже не выводится.",
    }),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [
      // Не «Продолжить»: кнопка должна называть то, что произойдёт по нажатию,
      // а произойдут пока только новые слова на экране.
      primaryButton("Показать новую фразу", async () => {
        mnemonic = await mnemonicNew(24);
        stage = "first";
        render();
      }),
      linkButton("Отмена", () => ctx.go("settings")),
    ]),
  ];

  /** Половина фразы: слова с from по to включительно. */
  const half = (from, to) =>
    el(
      "div.glass",
      {},
      [
        el(
          "div.words",
          {},
          mnemonic.slice(from - 1, to).map((w, i) =>
            el("div.word", {}, [
              el("span.word__n", { text: String(from + i) }),
              el("span", { text: w }),
            ]),
          ),
        ),
      ],
    );

  const first = () => [
    el("h1.glow", { "data-t": "Новая seed-фраза", text: "Новая seed-фраза" }),
    el("p.lead", { text: "Слова с 1 по 12. Кошелёк пока работает на старой фразе." }),

    half(1, 12),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [
      primaryButton("Дальше", () => {
        stage = "second";
        render();
      }),
      linkButton("Отмена", () => ctx.go("settings")),
    ]),
  ];

  const second = () => {
    const apply = el("button.btn.btn--primary", {
      type: "button",
      text: "Сменить seed-фразу",
      onclick: () =>
        runAction(
          apply,
          async () => {
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
            toast("Фраза сменена. Адрес остался прежним.");
            ctx.go("home");
          },
          { loadingText: "Меняем ключ" },
        ),
    });

    return [
      el("h1.glow", { "data-t": "Новая seed-фраза", text: "Новая seed-фраза" }),
      el("p.lead", { text: "Слова с 13 по 24. Фраза заработает после нажатия кнопки внизу." }),

      half(13, 24),

      // Адрес ломаем пополам сами: иначе перенос по ширине оставляет
      // на второй строке один символ.
      el("div.glass.glass--tight.rotate__address", {}, [
        el("div.faint", { text: "Адрес кошелька" }),
        el("div.mono", {}, [
          el("div", { text: address.slice(0, 24) }),
          el("div", { text: address.slice(24) }),
        ]),
      ]),

      el("div.screen__spacer"),
      el("div.screen__actions", {}, [
        apply,
        linkButton("Скопировать фразу и адрес", async () => {
          const ok = await copyText(`${mnemonic.join(" ")}\n\nАдрес: ${address}`);
          toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
        }),
        linkButton("Первые 12 слов", () => {
          stage = "first";
          render();
        }),
      ]),
    ];
  };

  render();
  return screen;
}
