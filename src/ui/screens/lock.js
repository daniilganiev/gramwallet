import { el, shortAddress } from "../dom.js";
import { diamond, linkButton, pinField, PIN_LENGTH, sheet } from "../components.js";
import { haptic } from "../../telegram.js";
import { getMeta, unlock, wipe } from "../../crypto/vault.js";
import { TgWallet } from "../../core/wallet.js";

/** Экран ввода PIN при открытии приложения. */
export function lockScreen(ctx) {
  const meta = getMeta();

  /*
   * Кнопки «Открыть» здесь нет.
   *
   * PIN ровно шесть символов, и как только набран последний, ждать больше
   * нечего: нажатие после него ничего не решает, а шаг добавляет. Работа
   * видна в самом поле, ошибка — под ним.
   */
  const gate = pinField("PIN", { onFull: () => submit() });
  const pin = gate.input;
  const error = el("div.field__error", { style: "display:none" });

  let working = false;

  async function submit() {
    if (working || pin.value.length !== PIN_LENGTH) return;
    working = true;
    gate.busy(true);
    error.style.display = "none";

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
      gate.fail();
      haptic("error");
    } finally {
      working = false;
      gate.busy(false);
    }
  }

  pin.addEventListener("keydown", (e) => e.key === "Enter" && submit());

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
      el("h1.glow", { "data-t": "С возвращением", text: "С возвращением" }),
      meta?.address && el("p.faint", { text: shortAddress(meta.address, 8, 8) }),
    ]),

    el("div.glass", {}, [gate.field]),
    error,

    el("div.screen__spacer"),

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
    const gate = pinField("PIN", { onFull: () => submit() });
    const pin = gate.input;
    const error = el("div.field__error", { style: "display:none" });

    // Возвращаем сам PIN, а не флаг: он нужен, чтобы перешифровать хранилище
    // после смены ключа. null означает отказ.
    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    let working = false;

    async function submit() {
      if (working || pin.value.length !== PIN_LENGTH) return;
      working = true;
      gate.busy(true);
      error.style.display = "none";

      const value = pin.value.trim();
      try {
        await unlock(value);
        haptic("success");
        close(value);
      } catch (e) {
        error.textContent = e.message;
        error.style.display = "";
        gate.fail();
        haptic("error");
      } finally {
        working = false;
        gate.busy(false);
      }
    }

    pin.addEventListener("keydown", (e) => e.key === "Enter" && submit());

    const overlay = el("div.modal", { onclick: (e) => e.target === overlay && close(null) }, [
      el("div.modal__sheet", {}, [
        el("h2", { text: "Введите PIN" }),
        el("p", { text: "Подтвердите, что это вы." }),
        gate.field,
        error,
        el("div.screen__actions", {}, [
          el("button.btn.btn--link", { type: "button", text: "Отмена", onclick: () => close(null) }),
        ]),
      ]),
    ]);

    document.body.append(overlay);
    setTimeout(() => pin.focus(), 60);
  });
}
