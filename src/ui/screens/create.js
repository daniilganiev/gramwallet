import { mnemonicNew, mnemonicToPrivateKey } from "@ton/crypto";

import { TgWallet } from "../../core/wallet.js";

import { el, copyText } from "../dom.js";
import { linkButton, pinField, PIN_LENGTH, primaryButton, runAction, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { walletTgAddress } from "../../core/detect.js";
import { saveWallet } from "../../crypto/vault.js";

/** Три случайных номера слова для проверки бэкапа. */
function pickIndexes(count = 3, total = 24) {
  const set = new Set();
  while (set.size < count) set.add(1 + Math.floor(Math.random() * total));
  return [...set].sort((a, b) => a - b);
}

/**
 * Фраза ещё раз — сюда возвращает кнопка «Назад» с экрана PIN.
 *
 * Экран повторяет блок, которым заканчивается создание кошелька: тот же
 * заголовок, тот же текст, та же карточка. Человек уходил именно с него,
 * и увидеть на возврате что-то другое означало бы решить, что фраза
 * поменялась. Слова берутся из черновика — новая фраза не создаётся.
 */
export function createScreen(ctx) {
  const screen = el("div.screen.stack", {}, [
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
  ]);

  const wordsBox = el("div.glass", {}, [el("p.dim", { text: "Готовим фразу…" })]);
  screen.append(wordsBox);

  const actions = el("div.screen__actions");
  screen.append(el("div.screen__spacer"), actions);

  (async () => {
    // Обычно фразу уже собрал экран forge — там её и показывали в логе.
    const mnemonic = ctx.draft?.mnemonic ?? (await mnemonicNew(24));
    ctx.draft = { ...ctx.draft, mnemonic };

    wordsBox.replaceChildren(
      el(
        "div.words",
        {},
        mnemonic.map((w, i) =>
          el("div.word", {}, [el("span.word__n", { text: String(i + 1) }), el("span", { text: w })]),
        ),
      ),
    );

    actions.replaceChildren(
      primaryButton("Я записал seed-фразу", () => ctx.go("pin")),
      linkButton("Скопировать", async () => {
        const ok = await copyText(mnemonic.join(" "));
        toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
      }),
    );
  })();

  return screen;
}
export function verifyScreen(ctx) {
  const mnemonic = ctx.draft?.mnemonic;
  // Переход откладываем: go() уже рендерит экран, и синхронный вызов
  // положил бы наш пустой div поверх него.
  if (!mnemonic) {
    setTimeout(() => ctx.go("welcome"), 0);
    return el("div.screen");
  }

  const indexes = pickIndexes();
  const inputs = indexes.map((n) =>
    el("input.input", { type: "text", autocapitalize: "none", autocomplete: "off", spellcheck: false, placeholder: `Слово №${n}` }),
  );

  const error = el("div.field__error", { style: "display:none" });

  const submit = primaryButton("Подтвердить", () => {
    const wrong = indexes.some((n, i) => inputs[i].value.trim().toLowerCase() !== mnemonic[n - 1]);
    inputs.forEach((inp) => inp.classList.toggle("input--error", wrong));

    if (wrong) {
      error.textContent = "Слова не совпали. Проверь свою запись.";
      error.style.display = "";
      haptic("error");
      return;
    }
    haptic("success");
    ctx.go("pin");
  });

  return el("div.screen.stack", {}, [
    el("h1", { text: "Проверим запись" }),
    el("p.lead", { text: "Введи три слова из фразы — так мы убедимся, что ты её действительно сохранил." }),

    el(
      "div.glass",
      { },
      indexes.map((n, i) =>
        el("label.field", {}, [el("span.field__label", { text: `Слово №${n}` }), inputs[i]]),
      ),
    ),
    error,

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [submit, linkButton("Показать фразу снова", () => ctx.go("create"))]),
  ]);
}

export function pinScreen(ctx) {
  const mnemonic = ctx.draft?.mnemonic;
  if (!mnemonic) {
    setTimeout(() => ctx.go("welcome"), 0);
    return el("div.screen");
  }

  // Шесть символов, буквы и цифры. Регистр не учитываем — на телефоне
  // промахнуться по Caps проще, чем забыть сам код.
  const first = pinField("PIN");
  const second = pinField("Ещё раз");
  const pin = first.input;
  const pin2 = second.input;
  const error = el("div.field__error", { style: "display:none" });

  const fail = (msg) => {
    error.textContent = msg;
    error.style.display = "";
    haptic("error");
  };

  const save = el("button.btn.btn--primary", {
    type: "button",
    text: "Сохранить",
    onclick: () =>
      runAction(save, async () => {
        const value = pin.value.trim();
        if (value.length !== PIN_LENGTH) return fail("PIN — ровно шесть символов: буквы или цифры.");
        if (value.toLowerCase() !== pin2.value.trim().toLowerCase()) return fail("PIN не совпадает.");

        // При импорте адрес уже проверен и может отличаться от выводимого
        // из фразы — так бывает, если у кошелька меняли ключ.
        let address = ctx.draft.address;
        if (!address) {
          const keyPair = await mnemonicToPrivateKey(mnemonic);
          address = walletTgAddress(keyPair.publicKey, ctx.network).toString({ bounceable: true });
        }

        await saveWallet({ mnemonic, address, network: ctx.network }, value);
        ctx.draft = null;
        ctx.session = { mnemonic, address, network: ctx.network };
        // Без этого главный экран открывался пустым: он работает с ctx.wallet,
        // а собирался тот до сих пор только при разблокировке.
        ctx.wallet = await TgWallet.fromMnemonic(mnemonic, {
          network: ctx.network,
          address,
        });

        haptic("success");
        ctx.go("home");
      }),
  });

  return el("div.screen.stack.pin", {}, [
    el("h1.glow", { "data-t": "Придумай PIN", text: "Придумай PIN" }),
    el("p.lead", {
      text: "Шесть символов — буквы или цифры, регистр не важен.",
    }),

    el("div.glass", {}, [first.field, second.field]),
    error,

    el("p.screen__hint", {
      text: "PIN шифрует вашу seed-фразу на этом устройстве.",
    }),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [save, linkButton("Назад", () => ctx.go("forge"))]),
  ]);
}
