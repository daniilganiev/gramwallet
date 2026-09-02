import { Address, fromNano, toNano } from "@ton/core";

import { el, fmtCoins } from "../dom.js";
import { glassButton, linkButton, runAction, sheet, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN } from "../../core/constants.js";
import { explainError } from "../../core/client.js";

/** Столько сообщений вмещает один запрос к контракту. */
const MAX = 255;

/** Сколько строк показываем сразу: чтобы было видно, что их несколько. */
const START = 3;

/**
 * Пакетная отправка.
 *
 * Контракт принимает до 255 сообщений за один подписанный запрос — это одна
 * подпись и одна комиссия сети на всех получателей. Руками столько строк
 * никто не введёт, поэтому основной способ заполнения — вставка списком,
 * а поля по одному нужны для двух-трёх адресов.
 */
export function batchScreen(ctx) {
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const wallet = ctx.wallet;
  let balance = null;

  const rows = el("div.batch__rows");
  const summary = el("div.batch__total");
  const balanceLine = el("p.faint", { text: "Проверяем баланс…" });

  /** Одна строка: кому и сколько. */
  const addRow = (to = "", amount = "") => {
    if (rows.children.length >= MAX) {
      return toast(`Больше ${MAX} получателей контракт не примет`, { error: true });
    }

    const address = el("input.input.batch__to", {
      type: "text",
      placeholder: "EQ… или UQ…",
      autocapitalize: "none",
      autocomplete: "off",
      spellcheck: false,
      value: to,
    });
    const value = el("input.input.batch__amount", {
      type: "text",
      inputmode: "decimal",
      placeholder: "0.1",
      value: amount,
    });

    const row = el("div.batch__row", {}, [
      address,
      value,
      el("button.batch__drop", {
        type: "button",
        text: "×",
        title: "Убрать получателя",
        onclick: () => {
          row.remove();
          if (!rows.children.length) addRow();
          recount();
        },
      }),
    ]);

    address.addEventListener("input", recount);
    value.addEventListener("input", recount);
    rows.append(row);
    recount();
    return row;
  };

  /** Всё, что заполнено: строки без адреса или суммы просто пропускаем. */
  const collect = () => {
    const out = [];
    for (const row of rows.children) {
      const to = row.querySelector(".batch__to").value.trim();
      const raw = row.querySelector(".batch__amount").value.trim().replace(",", ".");
      if (!to && !raw) continue;
      out.push({ to, raw });
    }
    return out;
  };

  function recount() {
    const items = collect();
    let total = 0n;
    let broken = 0;

    for (const { to, raw } of items) {
      try {
        Address.parse(to);
        const v = toNano(raw);
        if (v <= 0n) throw new Error("ноль");
        total += v;
      } catch {
        broken += 1;
      }
    }

    const parts = [`Получателей: ${items.length}`];
    if (total > 0n) parts.push(`всего ${fromNano(total)} ${COIN}`);
    if (broken) parts.push(`с ошибкой: ${broken}`);
    summary.textContent = items.length ? parts.join(" · ") : "Заполните хотя бы одну строку.";
    summary.classList.toggle("batch__total--bad", broken > 0);
  }

  /**
   * Вставка списком — единственный вменяемый способ задать много адресов.
   * Формат простой: адрес и сумма в строке, разделитель любой.
   */
  const pasteList = async () => {
    const area = el("textarea.input", {
      placeholder: "EQ… 0.5\nUQ… 1.25\nEQ… 0.1",
      autocapitalize: "none",
      autocomplete: "off",
      spellcheck: false,
    });

    const ok = await sheet({
      title: "Вставить списком",
      body: el("div", {}, [
        el("p.faint", { text: "По одному получателю в строке: адрес, затем сумма." }),
        area,
      ]),
      confirmText: "Добавить",
    });
    if (!ok) return;

    const parsed = area.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.split(/[\s,;]+/).filter(Boolean))
      .filter((parts) => parts.length >= 2);

    if (!parsed.length) return toast("Не нашли ни одной строки вида «адрес сумма»", { error: true });

    // Пустые строки, оставшиеся от заготовки, занимать место не должны.
    for (const row of [...rows.children]) {
      const empty =
        !row.querySelector(".batch__to").value.trim() &&
        !row.querySelector(".batch__amount").value.trim();
      if (empty) row.remove();
    }

    for (const [to, amount] of parsed) addRow(to, amount);
    haptic("success");
    toast(`Добавлено получателей: ${parsed.length}`);
  };

  const send = el("button.btn.btn--primary", {
    type: "button",
    text: "Отправить пакетом",
    onclick: () =>
      runAction(
        send,
        async () => {
          const items = collect();
          if (!items.length) {
            haptic("error");
            return toast("Некому отправлять", { error: true });
          }
          if (items.length > MAX) {
            haptic("error");
            return toast(`Больше ${MAX} получателей контракт не примет`, { error: true });
          }

          const messages = [];
          let total = 0n;
          for (const [i, { to, raw }] of items.entries()) {
            let dest;
            try {
              dest = Address.parse(to);
            } catch {
              haptic("error");
              return toast(`Строка ${i + 1}: адрес не похож на адрес TON`, { error: true });
            }
            let value;
            try {
              value = toNano(raw);
            } catch {
              haptic("error");
              return toast(`Строка ${i + 1}: некорректная сумма`, { error: true });
            }
            if (value <= 0n) {
              haptic("error");
              return toast(`Строка ${i + 1}: сумма должна быть больше нуля`, { error: true });
            }
            total += value;
            messages.push({ to: dest, amount: raw });
          }

          if (balance !== null && total >= balance) {
            haptic("error");
            return toast("На балансе столько нет — нужно оставить и на комиссию", { error: true });
          }

          let fee = null;
          try {
            fee = await wallet.estimateFee(messages);
          } catch {
            // Не оценили — скажем об этом в подтверждении, а не молча.
          }

          const line = (label, value) =>
            el("div.row", {}, [el("span.dim", { text: label }), el("span", { text: value })]);

          const confirmed = await sheet({
            title: "Проверьте пакет",
            body: el("div", {}, [
              line("Получателей", String(messages.length)),
              line("Всего", `${fromNano(total)} ${COIN}`),
              line("Комиссия сети", fee === null ? "не удалось оценить" : `≈ ${fromNano(fee)} ${COIN}`),
              el("p.faint", {
                text: "Одна подпись на всех: пакет уходит целиком или не уходит вовсе.",
              }),
            ]),
            confirmText: "Отправить",
          });
          if (!confirmed) return;

          const res = await wallet.send(messages);
          if (!res.confirmed) {
            toast("Пакет ушёл, но подтверждения пока нет. Проверьте баланс через минуту.", {
              error: true,
            });
          } else {
            haptic("success");
            toast(`Отправлено получателям: ${messages.length}`);
          }
          ctx.go("home");
        },
        { loadingText: "Отправляем" },
      ),
  });

  wallet
    .getBalance()
    .then((b) => {
      balance = b;
      balanceLine.textContent = `Доступно ${fmtCoins(b)}`;
    })
    .catch(() => {
      balanceLine.textContent = "Не удалось получить баланс";
    });

  for (let i = 0; i < START; i++) addRow();

  return el("div.screen.stack.batch", {}, [
    el("h1.glow", { "data-t": "Пакетная отправка", text: "Пакетная отправка" }),
    el("p.lead", { text: `Одна подпись и одна комиссия сети — до ${MAX} получателей.` }),
    balanceLine,

    el("div.glass", {}, [rows]),

    el("div.batch__tools", {}, [
      glassButton("Ещё получатель", () => addRow()),
      glassButton("Вставить списком", pasteList),
    ]),

    summary,

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [send, linkButton("Назад", () => ctx.go("send"))]),
  ]);
}
