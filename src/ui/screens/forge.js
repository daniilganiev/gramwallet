import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";

import { el, copyText } from "../dom.js";
import { linkButton, primaryButton, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { walletTgAddress } from "../../core/detect.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Экран создания кошелька: показываем, что именно считает устройство.
 *
 * Лог повторяет вывод консольного deploy-wallettg.js — те же подписи,
 * те же разделители, те же настоящие значения. Отличие одно: сид-фразу
 * не печатаем никогда, экран может видеть кто-то ещё.
 */
export function forgeScreen(ctx) {
  const body = el("div.term__body");
  const caret = el("span.term__caret");
  body.append(caret);

  const screen = el("div.screen.screen--roomy.stack.forge", {}, [
    el("h1.glow", { "data-t": "Создание кошелька", text: "Создание кошелька" }),
    el("p.lead", { text: "Всё происходит на этом устройстве." }),

    el("div.term", {}, [
      el("div.term__bar", {}, [
        el("span.term__dot"),
        el("span.term__dot"),
        el("span.term__dot"),
        el("span.term__name", { text: "node · javascript" }),
        el("span.term__meta", { text: "@ton/ton · @ton/crypto" }),
      ]),
      body,
    ]),
  ]);

  /** Строка лога: команды печатаются посимвольно, ответы появляются целиком. */
  const write = async (text, kind = "out", speed = 13) => {
    const row = el(`div.term__row.term__row--${kind}`);
    body.insertBefore(row, caret);

    if (speed === 0) {
      row.textContent = text;
    } else {
      for (const ch of text) {
        row.textContent += ch;
        body.scrollTop = body.scrollHeight;
        await sleep(speed);
      }
    }
    body.scrollTop = body.scrollHeight;
    return row;
  };

  // Возврат с экрана PIN. Фраза уже создана: лог печатаем разом, без пауз,
  // и сразу показываем блок с фразой — считать кошелёк заново незачем,
  // а терминал остаётся на месте, к нему можно пролистать вверх.
  const replay = Boolean(ctx.draft?.mnemonic);
  const pause = (ms) => (replay ? Promise.resolve() : sleep(ms));

  (async () => {
    await pause(300);
    await write("PS ~\\wallet> node deploy-wallettg.js", "cmd", replay ? 0 : 15);
    await pause(480);
    await write("", "dim", 0);

    const mnemonic = ctx.draft?.mnemonic ?? (await mnemonicNew(24));
    const keyPair = await mnemonicToPrivateKey(mnemonic);
    const wallet = walletTgAddress(keyPair.publicKey, ctx.network);

    await write("========= СОХРАНИ В БЕЗОПАСНОЕ МЕСТО =========", "dim", 0);
    await pause(280);
    // В консоли на этом месте печатаются сами слова. На экране их показывать
    // нельзя: рядом может стоять кто угодно, а до предупреждения человек
    // ещё не дошёл. Поэтому только отметка, слова — ниже, по кнопке.
    await write("Mnemonic: •••• •••• •••• ••••  (24 слова — ниже на этом экране)", "val", 0);
    await pause(280);
    await write(`Public Key: ${hex(keyPair.publicKey)}`, "val", 0);
    await pause(280);
    await write("==============================================", "dim", 0);
    await pause(560);
    await write("", "dim", 0);

    await write("Адрес (bounceable):", "cmd", 0);
    await pause(220);
    await write(wallet.toString({ bounceable: true }), "ok", 0);
    await pause(260);
    await write("Адрес (non-bounceable):", "cmd", 0);
    await pause(220);
    await write(wallet.toString({ bounceable: false }), "ok", 0);
    await pause(620);
    await write("", "dim", 0);

    // Сумму для пополнения консоль подсказывает, а экран — нет: адрес
    // перед человеком уже настоящий, а фразу он ещё не сохранил. Совет
    // «отправь сюда 0.05 GRAM» на этом шаге сработал бы как призыв
    // пополнить кошелёк, ключ от которого он вот-вот потеряет.
    await write("Деплой пройдёт после пополнения кошелька.", "done", 0);

    caret.remove();
    haptic("success");

    ctx.draft = { ...ctx.draft, mnemonic };
    await pause(700);

    const reveal = el("div.reveal", {}, [
      el("h1.glow.glow--lines", {
        "data-t": "Поздравляем!\nКошелёк создан!",
        text: "Поздравляем!\nКошелёк создан!",
      }),
      el("p.lead", {
        text: "Обязательно сохраните свою seed-фразу, иначе доступ к кошельку будет утерян.",
      }),
      el("div.note", {
        text: "Запиши все 24 слова. Мы не имеем к ним доступа и не сможем их восстановить.",
      }),
      el("div.glass", {}, [
        el(
          "div.words",
          {},
          mnemonic.map((w, i) =>
            el("div.word", {}, [el("span.word__n", { text: String(i + 1) }), el("span", { text: w })]),
          ),
        ),
      ]),
      el("div.screen__actions", {}, [
        primaryButton("Я записал seed-фразу", () => ctx.go("pin")),
        linkButton("Скопировать", async () => {
          const ok = await copyText(mnemonic.join(" "));
          toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
        }),
      ]),
    ]);

    screen.append(reveal);

    /*
     * Прокрутка своя, а не scrollIntoView({behavior:"smooth"}).
     *
     * Родная плавная прокрутка идёт вне кадрового цикла страницы, и вместе
     * с появлением большого стеклянного блока браузер пересобирает слои —
     * на телефоне это видно как вспышка. Здесь всё в одном requestAnimationFrame:
     * экран едет, блок проявляется, лишних слоёв не создаётся.
     */
    const glideTo = (top, ms) => {
      const from = screen.scrollTop;
      const dist = top - from;
      if (!dist) return;
      const started = performance.now();
      const step = (now) => {
        const t = Math.min(1, (now - started) / ms);
        // Плавный вход и выход, без рывка в конце.
        const e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
        screen.scrollTop = from + dist * e;
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    requestAnimationFrame(() => {
      const top = screen.scrollTop + reveal.getBoundingClientRect().top - screen.getBoundingClientRect().top;
      if (replay) screen.scrollTop = top;
      else glideTo(top, 700);
    });
  })();

  return screen;
}
