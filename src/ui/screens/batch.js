import { Address, fromNano, toNano } from "@ton/core";

import { el, fmtCoins, fromUnits, toUnits } from "../dom.js";
import { amountInput, glassButton, linkButton, runAction, sheet, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN } from "../../core/constants.js";
import { explainError } from "../../core/client.js";
import { fetchJettons, resolveDomain, toDomain } from "../../core/assets.js";
import { JETTON_ATTACH, jettonTransferBody } from "../../core/transfers.js";

/**
 * Запас, который остаётся на кошельке сверх сумм и комиссии: оценка
 * приблизительная, и упираться в ноль ровно нельзя.
 */
const RESERVE = toNano("0.001");

/** Столько сообщений вмещает один запрос к контракту. */
const MAX = 255;

/** Сколько строк показываем сразу: чтобы было видно, что их несколько. */
const START = 3;

/** Сумма в строке списка: число с одним разделителем дробной части. */
const AMOUNT = /^\d+(?:[.,]\d+)?$/;

/**
 * Разбирает строку вставленного списка.
 *
 * Разделителями считаем пробелы и точку с запятой, но НЕ запятую: в «0,5»
 * она дробная. Раньше запятая стояла среди разделителей, строка распадалась
 * на «0» и «5», суммой бралось первое — и вместо половины уходил ноль. Молча,
 * потому что «0» разбирается без ошибки. При наборе руками запятая при этом
 * понималась правильно, так что одно и то же число вело себя по-разному.
 *
 * Порядок в строке не важен: сумма узнаётся по тому, что она число, адрес —
 * по тому, что не число. Строку без суммы не выбрасываем, а добавляем
 * с пустым полем: незаполненное видно и правится на месте, а пропавшая
 * строка — нет.
 */
export function parseLine(line) {
  const parts = line.split(/[\s;]+/).filter(Boolean);
  const at = parts.findIndex((p) => AMOUNT.test(p));
  return {
    to: parts.find((_, i) => i !== at) ?? "",
    amount: at < 0 ? "" : parts[at].replace(",", "."),
  };
}

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

  /*
   * Чем платим.
   *
   * GRAM уходит прямо получателю, токен — командой твоему жетон-кошельку,
   * по одной на каждого. Для контракта это те же 255 сообщений в одном
   * подписанном запросе, разница только в теле и в том, что к каждому
   * сообщению придётся приложить GRAM на газ.
   */
  let asset = { id: "coin", kind: "coin", symbol: COIN, decimals: 9 };

  const picker = el("div.assets-pick");
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
    // Точность у выбранной монеты своя: у GRAM девять знаков, у USD₮ шесть.
    // Читается при каждом наборе, поэтому смена монеты доходит и до старых строк.
    const value = amountInput({
      class: "batch__amount",
      placeholder: "0.1",
      value: amount,
      decimals: () => asset.decimals,
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
        // Домен проверить локально нельзя, но отличить его от мусора можно:
        // ругаться на живое имя красным было бы неправдой.
        if (!toDomain(to)) Address.parse(to);
        const v = toUnits(raw, asset.decimals);
        if (v <= 0n) throw new Error("ноль");
        total += v;
      } catch {
        broken += 1;
      }
    }

    const parts = [`Получателей: ${items.length}`];
    if (total > 0n) parts.push(`всего ${fromUnits(total, asset.decimals)} ${asset.symbol}`);
    // Газ на жетоны — не мелочь: на сотне получателей это пять GRAM.
    if (asset.kind === "jetton" && items.length) {
      parts.push(`газ ≈ ${fromNano(toNano(JETTON_ATTACH) * BigInt(items.length))} ${COIN}`);
    }
    if (broken) parts.push(`с ошибкой: ${broken}`);
    summary.textContent = items.length ? parts.join(" · ") : "Заполните хотя бы одну строку.";
    summary.classList.toggle("batch__total--bad", broken > 0);
  }

  /*
   * Список монет. NFT сюда не попадают: каждый предмет уникален, и «послать
   * один NFT сразу всем» не значит ничего.
   */
  const chip = (id, label, data) =>
    el("button.chip", {
      type: "button",
      text: label,
      "data-id": id,
      onclick: () => {
        asset = { id, ...data };
        showAsset();
        recount();
      },
    });

  const showAsset = () => {
    for (const node of picker.children) {
      node.classList.toggle("chip--on", node.dataset.id === asset.id);
    }
    balanceLine.textContent =
      asset.kind === "coin"
        ? balance === null
          ? "Проверяем баланс…"
          : `Доступно ${fmtCoins(balance)}`
        : `Доступно ${asset.amount} ${asset.symbol}`;
  };

  picker.append(chip("coin", COIN, { kind: "coin", symbol: COIN, decimals: 9 }));

  fetchJettons(wallet.address.toString({ bounceable: false }), wallet.network)
    .then((list) => {
      for (const j of list) {
        if (j.scam) continue;
        picker.append(chip(j.jetton, j.symbol, { kind: "jetton", ...j }));
      }
      showAsset();
    })
    .catch(() => {
      // Индексатор промолчал — остаёмся с одним GRAM, это не повод падать.
    });

  /**
   * Вставка списком — единственный вменяемый способ задать много адресов.
   * Формат простой: адрес и сумма в строке, разделитель любой.
   */
  const pasteList = async () => {
    const area = el("textarea.input", {
      placeholder: "EQ… 0.5\nUQ… 1,25\nEQ… 0.1",
      autocapitalize: "none",
      autocomplete: "off",
      spellcheck: false,
    });

    const ok = await sheet({
      title: "Вставить списком",
      body: el("div", {}, [
        el("p.faint", {
          text: "По одному получателю в строке: адрес и сумма, в любом порядке. Запятая в сумме считается дробной.",
        }),
        area,
      ]),
      confirmText: "Добавить",
    });
    if (!ok) return;

    const parsed = area.value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseLine)
      .filter((row) => row.to);

    if (!parsed.length) return toast("Не нашли ни одного адреса", { error: true });

    // Пустые строки, оставшиеся от заготовки, занимать место не должны.
    for (const row of [...rows.children]) {
      const empty =
        !row.querySelector(".batch__to").value.trim() &&
        !row.querySelector(".batch__amount").value.trim();
      if (empty) row.remove();
    }

    // Больше MAX контракт не примет: лишнее отсекаем сразу и говорим об этом,
    // а не ругаемся отдельно на каждую строку сверх предела.
    const room = Math.max(0, MAX - rows.children.length);
    const fit = parsed.slice(0, room);
    for (const { to, amount } of fit) addRow(to, amount);

    const noAmount = fit.filter((row) => !row.amount).length;
    const said = [`Добавлено получателей: ${fit.length}`];
    if (noAmount) said.push(`без суммы: ${noAmount}`);
    if (parsed.length > fit.length) said.push(`не поместилось: ${parsed.length - fit.length}`);

    haptic(noAmount || parsed.length > fit.length ? "warning" : "success");
    toast(said.join(" · "), { error: parsed.length > fit.length });
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

          /*
           * Домены разрешаем до всего остального и по одному разу на имя.
           *
           * Индексатор пускает около запроса в секунду, поэтому список из
           * сотни имён — это минуты ожидания. Повторы в списке встречаются
           * часто (одному человеку несколько выплат), и считать их заново
           * незачем.
           */
          const names = [...new Set(items.map((it) => toDomain(it.to)).filter(Boolean))];
          const found = new Map();
          for (const [n, name] of names.entries()) {
            send.replaceChildren(
              el("span.spinner"),
              el("span", { text: `Ищем домены: ${n + 1} из ${names.length}` }),
            );
            let hit;
            try {
              hit = await resolveDomain(name, wallet.network);
            } catch (e) {
              haptic("error");
              return toast(`${name}: ${explainError(e)}`, { error: true });
            }
            if (!hit) {
              haptic("error");
              return toast(`${name} ни на что не указывает`, { error: true });
            }
            found.set(name, hit.address);
          }

          const messages = [];
          let total = 0n;
          for (const [i, { to, raw }] of items.entries()) {
            const name = toDomain(to);
            let dest;
            try {
              dest = Address.parse(name ? found.get(name) : to);
            } catch {
              haptic("error");
              return toast(`Строка ${i + 1}: адрес не похож на адрес TON`, { error: true });
            }
            let value;
            try {
              value = toUnits(raw, asset.decimals);
            } catch (e) {
              haptic("error");
              return toast(`Строка ${i + 1}: ${e.message}`, { error: true });
            }
            if (value <= 0n) {
              haptic("error");
              return toast(`Строка ${i + 1}: сумма должна быть больше нуля`, { error: true });
            }
            total += value;

            messages.push(
              asset.kind === "coin"
                ? { to: dest, amount: raw }
                : {
                    // Токеном распоряжается не получатель, а твой собственный
                    // жетон-кошелёк: команда идёт ему, а он уже шлёт дальше.
                    to: asset.wallet,
                    amount: JETTON_ATTACH,
                    bounce: true,
                    body: jettonTransferBody({
                      amount: value,
                      to: dest,
                      responseTo: wallet.address,
                    }),
                  },
            );
          }

          /** Сколько GRAM уйдёт на газ: у жетонов он свой на каждое сообщение. */
          const gas = asset.kind === "coin" ? 0n : toNano(JETTON_ATTACH) * BigInt(messages.length);

          if (asset.kind === "jetton" && total > BigInt(asset.raw)) {
            haptic("error");
            return toast(`Токена столько нет: доступно ${asset.amount} ${asset.symbol}`, {
              error: true,
            });
          }

          if (asset.kind === "coin" && balance !== null && total >= balance) {
            haptic("error");
            return toast("На балансе столько нет — нужно оставить и на комиссию", { error: true });
          }

          let fee = null;
          try {
            fee = await wallet.estimateFee(messages);
          } catch {
            // Не оценили — скажем об этом в подтверждении, а не молча.
          }

          /*
           * Суммы пакета вместе с комиссией обязаны помещаться в баланс.
           *
           * Сообщения уходят с флагом IGNORE_ERRORS — без него контракт не
           * принимает внешний запрос вовсе. Как только денег перестанет
           * хватать, оставшиеся переводы будут молча пропущены, а транзакция
           * всё равно окажется успешной.
           */
          // Для GRAM в баланс обязаны поместиться сами суммы, для токена —
          // газ на все сообщения. И то и другое сверх комиссии запроса.
          const needed = (asset.kind === "coin" ? total : gas) + (fee ?? 0n) + RESERVE;
          if (fee !== null && balance !== null && needed > balance) {
            haptic("error");
            return toast(
              `Не хватает ${fromNano(needed - balance)} ${COIN}: ` +
                (asset.kind === "coin" ? "на суммы вместе с комиссией." : "на газ вместе с комиссией."),
              { error: true },
            );
          }

          const line = (label, value) =>
            el("div.row", {}, [el("span.dim", { text: label }), el("span", { text: value })]);

          const confirmed = await sheet({
            title: "Проверьте пакет",
            body: el("div", {}, [
              line("Получателей", String(messages.length)),
              line("Всего", `${fromUnits(total, asset.decimals)} ${asset.symbol}`),
              gas > 0n && line("Газ на переводы", `${fromNano(gas)} ${COIN}`),
              line("Комиссия сети", fee === null ? "не удалось оценить" : `≈ ${fromNano(fee)} ${COIN}`),
              el("p.faint", { text: "Одна подпись и одна комиссия сети на всех получателей." }),
              gas > 0n &&
                el("p.faint", {
                  text: "Газ идёт по цепочке контрактов токена, по одной порции на получателя. Неизрасходованное вернётся на кошелёк.",
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
          } else if (res.delivered === false) {
            // Часть действий контракт пропустил — почти всегда это нехватка
            // средств на хвост списка. Показать это обязаны.
            haptic("error");
            toast("Ушли не все переводы: денег хватило не на всех. Проверьте историю.", {
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
      // Строку пишет showAsset: при выбранном токене доступен он,
      // а не GRAM, и перетирать её балансом монеты нельзя.
      showAsset();
    })
    .catch(() => {
      balanceLine.textContent = "Не удалось получить баланс";
    });

  for (let i = 0; i < START; i++) addRow();

  return el("div.screen.stack.batch", {}, [
    el("h1.glow", { "data-t": "Пакетная отправка", text: "Пакетная отправка" }),
    picker,
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
