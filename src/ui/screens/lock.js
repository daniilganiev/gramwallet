import { el, shortAddress } from "../dom.js";
import { diamond, linkButton, pinField, runAction, sheet } from "../components.js";
import { haptic } from "../../telegram.js";
import { getMeta, unlock, wipe } from "../../crypto/vault.js";
import { TgWallet } from "../../core/wallet.js";

/** Экран ввода PIN при открытии приложения. */
export function lockScreen(ctx) {
  const meta = getMeta();
  const gate = pinField("PIN");
  const pin = gate.input;
  const error = el("div.field__error", { style: "display:none" });

  const open = el("button.btn.btn--primary", {
    type: "button",
    text: "Открыть",
    onclick: () =>
      runAction(open, async () => {
        try {
          const data = await unlock(pin.value.trim());
          ctx.session = data;
          ctx.wallet = await TgWallet.fromMnemonic(data.mnemonic, {
            network: data.network,
            address: data.address,
          });
          haptic("success");
          ctx.go("home");
        } catch (e) {
          error.textContent = e.message;
          error.style.display = "";
          pin.value = "";
          pin.classList.add("input--error");
          haptic("error");
        }
      }),
  });

  pin.addEventListener("keydown", (e) => e.key === "Enter" && open.click());

  /*
   * Выходы для того, кто забыл PIN.
   *
   * Без них экран блокировки — тупик: приложение не открыть и не сбросить,
   * остаётся чистить данные Telegram вслепую. Оба пути стирают хранилище,
   * поэтому оба спрашивают подтверждение и честно называют цену.
   */
  const forget = async (title, body, confirmText, next) => {
    const ok = await sheet({ title, body, confirmText, danger: true });
    if (!ok) return;
    wipe();
    haptic("warning");
    ctx.go(next);
  };

  return el("div.screen.stack", {}, [
    el("div.screen__spacer"),
    el("div.center", {}, [
      el("div.lock__gem", {}, [diamond(96)]),
      el("h1", { text: "С возвращением" }),
      meta?.address && el("p.faint", { text: shortAddress(meta.address, 8, 8) }),
    ]),

    el("div.glass", {}, [gate.field]),
    error,

    el("div.screen__spacer"),
    el("div.screen__actions", {}, [open]),

    // Выходы стоят отдельно и ниже: это не соседи кнопки «Открыть», а другой
    // разговор — оба стирают кошелёк с устройства.
    el("div.lock__exits", {}, [
      linkButton("Войти в другой кошелёк", () =>
        forget(
          "Войти в другой кошелёк?",
          "Этот кошелёк будет стёрт с устройства. Он останется в блокчейне, но вернуть к нему доступ можно будет только seed-фразой и адресом.",
          "Стереть и войти",
          "import",
        ),
      ),
      linkButton("Удалить кошелёк с устройства", () =>
        forget(
          "Удалить кошелёк с устройства?",
          "Сам кошелёк и деньги останутся в блокчейне. Но вернуть к ним доступ можно будет только seed-фразой и адресом. Если фраза не сохранена — доступ пропадёт навсегда.",
          "Удалить",
          "welcome",
        ),
      ),
    ]),
  ]);
}

/**
 * Запрос PIN перед подписью.
 *
 * Ключ в этот момент уже в памяти, так что от вора данных это не спасёт —
 * зато спасёт от того, кто взял в руки разблокированный телефон с открытым
 * приложением. Ради этого сценария лишний экран и стоит.
 */
export function requirePin() {
  return new Promise((resolve) => {
    const gate = pinField("PIN");
    const pin = gate.input;
    const error = el("div.field__error", { style: "display:none" });

    // Возвращаем сам PIN, а не флаг: он нужен, чтобы перешифровать хранилище
    // после смены ключа. null означает отказ.
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const confirm = el("button.btn.btn--primary", {
      type: "button",
      text: "Подтвердить",
      onclick: () =>
        runAction(confirm, async () => {
          const value = pin.value.trim();
          try {
            await unlock(value);
            haptic("success");
            close(value);
          } catch (e) {
            error.textContent = e.message;
            error.style.display = "";
            pin.value = "";
            haptic("error");
          }
        }),
    });

    pin.addEventListener("keydown", (e) => e.key === "Enter" && confirm.click());

    const overlay = el("div.modal", { onclick: (e) => e.target === overlay && close(null) }, [
      el("div.modal__sheet", {}, [
        el("h2", { text: "Введите PIN" }),
        el("p", { text: "Подтвердите, что это вы." }),
        gate.field,
        error,
        el("div.screen__actions", {}, [
          confirm,
          el("button.btn.btn--link", { type: "button", text: "Отмена", onclick: () => close(null) }),
        ]),
      ]),
    ]);

    document.body.append(overlay);
    setTimeout(() => pin.focus(), 60);
  });
}
