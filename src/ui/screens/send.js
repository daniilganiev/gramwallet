import { Address, fromNano } from "@ton/core";

import { el, fmtCoins, shortAddress } from "../dom.js";
import { linkButton, runAction, sheet, toast } from "../components.js";
import { haptic } from "../../telegram.js";
import { COIN } from "../../core/constants.js";
import { explainError } from "../../core/client.js";
import { fetchJettons, fetchNfts } from "../../core/assets.js";
import { JETTON_ATTACH, NFT_ATTACH, jettonTransferBody, nftTransferBody } from "../../core/transfers.js";

/** Сумма в наименьших единицах токена: «0.03» при decimals 6 → 30000n. */
function toUnits(text, decimals) {
  const [whole, frac = ""] = String(text).replace(",", ".").split(".");
  if (frac.length > decimals) {
    throw new Error(`Слишком много знаков после точки: не больше ${decimals}.`);
  }
  const tail = (frac + "0".repeat(decimals)).slice(0, decimals);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(tail || "0");
}

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

  // Что отправляем. GRAM есть всегда, остальное подгружается.
  let asset = { id: "coin", kind: "coin", symbol: COIN, decimals: 9 };
  let balance = null;

  const picker = el("div.assets-pick");
  const balanceLine = el("p.faint", { text: "Проверяем баланс…" });

  const to = el("input.input", {
    type: "text",
    placeholder: "EQ… или UQ…",
    autocapitalize: "none",
    autocomplete: "off",
    spellcheck: false,
  });
  const amount = el("input.input", { type: "text", inputmode: "decimal", placeholder: "0.1" });
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
    const [jettons, nfts] = await Promise.all([
      fetchJettons(mine, wallet.network).catch(() => []),
      fetchNfts(mine, wallet.network).catch(() => []),
    ]);
    for (const j of jettons) {
      picker.append(chip(`j:${j.jetton}`, j.symbol, { kind: "jetton", ...j }));
    }
    for (const n of nfts) {
      const label = n.name === "NFT" ? n.collection || "NFT" : n.name;
      picker.append(chip(`n:${n.address}`, label, { kind: "nft", ...n }));
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
          try {
            dest = Address.parse(to.value.trim());
          } catch {
            haptic("error");
            return toast("Это не похоже на адрес TON", { error: true });
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

          const attached = asset.kind === "coin" ? null : message.amount;
          const line = (label, value) =>
            el("div.row", {}, [el("span.dim", { text: label }), el("span", { text: value })]);

          const ok = await sheet({
            title: "Проверьте перевод",
            body: el("div", {}, [
              line("Кому", shortAddress(dest.toString({ bounceable: false }))),
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
      el("label.field", {}, [el("span.field__label", { text: "Адрес получателя" }), to]),
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
