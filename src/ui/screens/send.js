import { Address, fromNano, toNano } from "@ton/core";

import { el, fmtCoins, shortAddress, toUnits } from "../dom.js";
import { amountInput, linkButton, runAction, sheet, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN } from "../../core/constants.js";
import { explainError } from "../../core/client.js";
import { fetchJettons, resolveDomain, toDomain } from "../../core/assets.js";
import { JETTON_ATTACH, NFT_ATTACH, jettonTransferBody, nftTransferBody } from "../../core/transfers.js";

/**
 * Запас, который обязан остаться на кошельке сверх суммы и комиссии.
 * Оценка комиссии приблизительная, и упереться в ноль ровно — плохая идея.
 */
const RESERVE = toNano("0.001");

/** Сумма в наименьших единицах токена: «0.03» при decimals 6 → 30000n. */
/**
 * Отправка.
 *
 * Один экран на три случая: GRAM, токен, NFT. Разница только в том, какое
 * сообщение уходит: GRAM — прямо получателю, токен — кошельку токена, NFT —
 * самому предмету. Для человека это одно действие, и экран поэтому один.
 */
export function sendScreen(ctx) {
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const wallet = ctx.wallet;
  const mine = wallet.address.toString({ bounceable: false });

  /*
   * Что отправляем. GRAM есть всегда, токены подгружаются, а NFT приходит
   * только снаружи: его выбирают нажатием на самом кошельке, а не из списка.
   * Иначе строка выбора превращалась в свалку из десятка предметов.
   */
  const picked = ctx.sendAsset ?? null;
  ctx.sendAsset = null;

  let asset = picked ?? { id: "coin", kind: "coin", symbol: COIN, decimals: 9 };
  let balance = null;

  const picker = el("div.assets-pick");
  const balanceLine = el("p.faint", { text: "Проверяем баланс…" });

  const to = el("input.input", {
    type: "text",
    placeholder: "Адрес, домен или @имя",
    autocapitalize: "none",
    autocomplete: "off",
    spellcheck: false,
  });

  /*
   * Куда указывает домен.
   *
   * Показать это обязательно: имя человек читает, а подписывает он адрес,
   * и между ними стоит запись, которую владелец домена может поменять когда
   * угодно. Подписывать вслепую нельзя.
   */
  const resolvedLine = el("p.resolved", { style: "display:none" });

  let resolved = null;
  let lookUps = 0;
  let lookUpTimer = null;

  const say = (text, bad = false) => {
    resolvedLine.textContent = text;
    resolvedLine.style.display = text ? "" : "none";
    resolvedLine.classList.toggle("resolved--bad", bad);
  };

  const lookUp = async () => {
    resolved = null;
    const domain = toDomain(to.value);
    if (!domain) {
      say("");
      return;
    }

    // Отвечает только последний запрос: пока летит ответ, имя могли дописать.
    const ticket = ++lookUps;
    say(`Ищем ${domain}…`);

    try {
      const found = await resolveDomain(domain, wallet.network);
      if (ticket !== lookUps) return;
      if (!found) {
        say(`${domain} ни на что не указывает`, true);
        return;
      }
      resolved = found;
      say(`${domain} → ${shortAddress(found.address, 6, 6)}`);
    } catch (e) {
      if (ticket !== lookUps) return;
      say(explainError(e), true);
    }
  };

  to.addEventListener("input", () => {
    resolved = null;
    clearTimeout(lookUpTimer);
    // Не на каждую букву: индексатор пускает примерно запрос в секунду.
    lookUpTimer = setTimeout(lookUp, 600);
  });
  // Точность берём у выбранной монеты: у GRAM девять знаков, у USD₮ шесть.
  const amount = amountInput({ placeholder: "0.1", decimals: () => asset.decimals ?? 9 });
  const note = el("input.input", { type: "text", placeholder: "Необязательно", maxlength: 120 });

  const amountLabel = el("span.field__label", { text: `Сумма, ${COIN}` });
  const amountField = el("label.field", {}, [amountLabel, amount]);

  const showAsset = () => {
    for (const chip of picker.children) {
      chip.classList.toggle("chip--on", chip.dataset.id === asset.id);
    }

    if (asset.kind === "nft") {
      amountField.style.display = "none";
      balanceLine.textContent = asset.collection
        ? `${asset.name} · ${asset.collection}`
        : asset.name;
      return;
    }

    amountField.style.display = "";
    amountLabel.textContent = `Сумма, ${asset.symbol}`;
    if (asset.kind === "coin") {
      balanceLine.textContent = balance === null ? "Проверяем баланс…" : `Доступно ${fmtCoins(balance)}`;
    } else {
      balanceLine.textContent = `Доступно ${asset.amount} ${asset.symbol}`;
    }
  };

  const chip = (id, label, data) =>
    el("button.chip", {
      type: "button",
      text: label,
      "data-id": id,
      onclick: () => {
        asset = { id, ...data };
        haptic("light");
        showAsset();
      },
    });

  picker.append(chip("coin", COIN, { kind: "coin", symbol: COIN, decimals: 9 }));

  // Выбранный предмет показываем отдельной фишкой: видно, что именно уйдёт,
  // и можно передумать, переключившись на GRAM или токен.
  if (picked?.kind === "nft") {
    picker.append(chip(picked.id, picked.name === "NFT" ? picked.collection || "NFT" : picked.name, picked));
  }

  wallet
    .getBalance()
    .then((b) => {
      balance = b;
      showAsset();
    })
    .catch(() => {
      balanceLine.textContent = "Не удалось получить баланс";
    });

  // Токены и NFT приезжают позже — экран уже работает с GRAM.
  (async () => {
    const jettons = await fetchJettons(mine, wallet.network).catch(() => []);
    for (const j of jettons) {
      picker.append(chip(`j:${j.jetton}`, j.symbol, { kind: "jetton", ...j }));
    }
    showAsset();
  })();

  /** Что именно уйдёт в сеть — одно описание и для оценки, и для отправки. */
  const buildMessage = (dest, raw) => {
    const comment = note.value.trim() || null;

    if (asset.kind === "coin") {
      return { to: dest, amount: raw, comment };
    }

    if (asset.kind === "jetton") {
      return {
        to: asset.wallet,
        amount: JETTON_ATTACH,
        bounce: true,
        body: jettonTransferBody({
          amount: toUnits(raw, asset.decimals),
          to: dest,
          responseTo: wallet.address,
          comment,
        }),
      };
    }

    return {
      to: asset.address,
      amount: NFT_ATTACH,
      bounce: true,
      body: nftTransferBody({ to: dest, responseTo: wallet.address, comment }),
    };
  };

  const send = el("button.btn.btn--primary", {
    type: "button",
    text: "Отправить",
    onclick: () =>
      runAction(
        send,
        async () => {
          let dest;
          const typed = to.value.trim();
          const domain = toDomain(typed);

          if (domain) {
            // Резолв мог не долететь: человек вправе нажать сразу после ввода.
            if (resolved?.domain !== domain) await lookUp();
            if (!resolved) {
              haptic("error");
              return toast(`Не нашли, куда указывает ${domain}`, { error: true });
            }
            dest = Address.parse(resolved.address);
          } else {
            try {
              dest = Address.parse(typed);
            } catch {
              haptic("error");
              return toast("Это не похоже на адрес TON", { error: true });
            }
          }

          const raw = amount.value.trim().replace(",", ".");

          if (asset.kind !== "nft") {
            let units;
            try {
              units = toUnits(raw, asset.decimals);
            } catch (e) {
              haptic("error");
              return toast(e.message, { error: true });
            }
            if (units <= 0n) {
              haptic("error");
              return toast("Сумма должна быть больше нуля", { error: true });
            }
            if (asset.kind === "coin" && balance !== null && units >= balance) {
              haptic("error");
              return toast("На балансе столько нет — нужно оставить и на комиссию", { error: true });
            }

            if (asset.kind === "jetton" && units > BigInt(asset.raw)) {
              haptic("error");
              return toast(`Токена столько нет: доступно ${asset.amount} ${asset.symbol}`, {
                error: true,
              });
            }
          }

          const message = buildMessage(dest, raw);

          // Комиссию считаем до подписи и показываем в подтверждении:
          // цену человек должен знать до того, как нажмёт «Отправить».
          let fee = null;
          let feeError = null;
          try {
            fee = await wallet.estimateFee(message);
          } catch (e) {
            feeError = explainError(e);
          }

          /*
           * Сумма вместе с комиссией обязана помещаться в баланс.
           *
           * Контракт шлёт сообщения с флагом IGNORE_ERRORS — иначе он вообще
           * не принимает внешний запрос. Флаг означает, что при нехватке
           * денег действие молча пропускается: транзакция успешна, seqno
           * растёт, перевода нет. Поэтому не пускаем такой перевод вовсе.
           */
          if (fee !== null && balance !== null) {
            const value = asset.kind === "coin" ? toUnits(raw, 9) : toNano(message.amount);
            if (value + fee + RESERVE > balance) {
              haptic("error");
              const room = balance - fee - RESERVE;
              return toast(
                asset.kind === "coin"
                  ? room > 0n
                    ? `Не хватит на комиссию. Максимум к отправке — ${fromNano(room)} ${COIN}.`
                    : `На комиссию не хватает ${COIN}. Пополните кошелёк.`
                  : `Не хватает ${COIN} на газ: нужно ещё ${fromNano(value + fee + RESERVE - balance)} ${COIN}.`,
                { error: true },
              );
            }
          }

          const attached = asset.kind === "coin" ? null : message.amount;
          const line = (label, value) =>
            el("div.row", {}, [el("span.dim", { text: label }), el("span", { text: value })]);

          const ok = await sheet({
            title: "Проверьте перевод",
            body: el("div", {}, [
              line("Кому", resolved?.domain ?? shortAddress(dest.toString({ bounceable: false }))),
              // При переводе по имени адрес показываем отдельной строкой:
              // подписывается именно он, а запись домена владелец может менять.
              resolved && line("Адрес", shortAddress(dest.toString({ bounceable: false }))),
              asset.kind === "nft"
                ? line("Что", asset.name === "NFT" ? asset.collection || "NFT" : asset.name)
                : line("Сумма", `${raw} ${asset.symbol}`),
              attached && line("Прикладываем", `${attached} ${COIN}`),
              line("Комиссия сети", fee === null ? "не удалось оценить" : `≈ ${fromNano(fee)} ${COIN}`),
              note.value.trim() && line("Сообщение", note.value.trim()),
              attached &&
                el("p.faint", {
                  text: "Приложенные GRAM идут на газ по цепочке контрактов, остаток вернётся на кошелёк.",
                }),
              feeError && el("div.note.note--danger", { text: feeError }),
              el("p.faint", { text: "Отменить перевод после отправки нельзя." }),
            ]),
            confirmText: "Отправить",
          });
          if (!ok) return;

          const res = await wallet.send(message);

          if (!res.confirmed) {
            toast("Перевод ушёл, но подтверждения пока нет. Проверьте баланс через минуту.", {
              error: true,
            });
          } else if (res.delivered === false) {
            // Запрос приняли, но сообщение контракт не отправил: на балансе
            // не хватило на сумму вместе с комиссией. Молчать об этом нельзя.
            haptic("error");
            toast("Сеть приняла запрос, но перевод не ушёл: не хватило на сумму вместе с комиссией.", {
              error: true,
            });
          } else {
            haptic("success");
            toast("Отправлено");
          }
          ctx.go("home");
        },
        { loadingText: "Отправляем" },
      ),
  });

  showAsset();

  return el("div.screen.stack", {}, [
    el("h1.glow", { "data-t": "Отправить", text: "Отправить" }),
    picker,
    balanceLine,

    el("div.glass", {}, [
      el("label.field", {}, [
        el("span.field__label", { text: "Адрес получателя" }),
        to,
        resolvedLine,
      ]),
      amountField,
      el("label.field", {}, [el("span.field__label", { text: "Сообщение" }), note]),
    ]),

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [
      send,
      linkButton("Пакетная отправка", () => ctx.go("batch")),
      linkButton("Назад", () => ctx.go("home")),
    ]),
  ]);
}
