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
 * Все двадцать четыре слова идут одним списком, а кнопка смены стоит под
 * ними в общем потоке, а не прибита к низу экрана. До неё нельзя дотянуться,
 * не пролистав фразу целиком: прокрутка получается обязательной по самому
 * устройству экрана, а не по доброй воле.
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
    screen.replaceChildren(...({ warn, phrase }[stage]()));
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

    // Утка занимает пустоту между предупреждением и кнопкой: экран с одними
    // запретами читается тяжело, а тут решение принимают спокойно.
    el("div.screen__spacer"),
    el("div.sticker.rotate__duck", {}, [
      el("div.sticker__glow"),
      el("img.sticker__img", { src: "/utya2.gif", alt: "", loading: "eager", decoding: "async" }),
    ]),
    el("div.screen__spacer"),

    el("div.screen__actions", {}, [
      // Не «Продолжить»: кнопка должна называть то, что произойдёт по нажатию,
      // а произойдут пока только новые слова на экране.
      primaryButton("Показать новую фразу", async () => {
        mnemonic = await mnemonicNew(24);
        stage = "phrase";
        render();
      }),
      linkButton("Отмена", () => ctx.go("settings")),
    ]),
  ];

  /** Все двадцать четыре слова одним списком. */
  const words = () =>
    el("div.glass", {}, [
      el(
        "div.words",
        {},
        mnemonic.map((w, i) =>
          el("div.word", {}, [
            el("span.word__n", { text: String(i + 1) }),
            el("span", { text: w }),
          ]),
        ),
      ),
    ]);

  const phrase = () => {
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
      el("p.lead", { text: "Запишите все 24 слова. Фраза заработает только после нажатия кнопки внизу." }),

      words(),

      // Адрес ломаем пополам сами: иначе перенос по ширине оставляет
      // на второй строке один символ.
      el("div.glass.glass--tight.rotate__address", {}, [
        el("div.faint", { text: "Адрес кошелька" }),
        el("div.mono", {}, [
          el("div", { text: address.slice(0, 24) }),
          el("div", { text: address.slice(24) }),
        ]),
      ]),

      el("div.screen__actions", {}, [
        apply,
        linkButton("Скопировать фразу и адрес", async () => {
          const ok = await copyText(`${mnemonic.join(" ")}\n\nАдрес: ${address}`);
          toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
        }),
        linkButton("Отмена", () => ctx.go("settings")),
      ]),
    ];
  };

  render();
  return screen;
}
