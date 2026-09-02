import { el, copyText, shortAddress } from "../dom.js";
import { githubMark, glassButton, linkButton, primaryButton, sheet, toast } from "../components.js";
import { openLink } from "../../telegram.js";
import { APP_REPO_URL } from "../../core/constants.js";
import { unlock, wipe } from "../../crypto/vault.js";
import { requirePin } from "./lock.js";

export function settingsScreen(ctx) {
  // Сюда можно попасть после перезагрузки страницы, когда расшифрованной
  // сессии в памяти уже нет: молча уводим на ввод PIN, а не падаем.
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const wallet = ctx.wallet;
  const address = wallet.address.toString({ bounceable: true });

  const showBackup = async () => {
    const pin = await requirePin();
    if (!pin) return;

    const { mnemonic } = await unlock(pin);

    /*
     * Копирование не закрывает лист. Человек копирует фразу, чтобы тут же
     * куда-то её положить, и лист ему нужен на месте: проверить слова,
     * сверить адрес, скопировать ещё раз, если первый раз не вставилось.
     */
    const copyAll = async () => {
      const ok = await copyText(`${mnemonic.join(" ")}\n\nАдрес: ${address}`);
      toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
    };

    await sheet({
      title: "Резервная копия",
      body: el("div", {}, [
        el("p", { text: "Сохраните фразу и адрес вместе — после смены ключа адрес из фразы не выводится." }),
        el(
          "div.words",
          {},
          mnemonic.map((w, i) =>
            el("div.word", {}, [el("span.word__n", { text: String(i + 1) }), el("span", { text: w })]),
          ),
        ),
        el("div.glass.glass--tight.backup__address", {}, [
          el("div.faint", { text: "Адрес" }),
          el("div.mono", { text: address }),
        ]),
        primaryButton("Скопировать всё", copyAll),
      ]),
      confirmText: null,
      cancelText: "Закрыть",
    });
  };

  const removeWallet = async () => {
    const ok = await sheet({
      title: "Удалить кошелёк с устройства?",
      body: "Сам кошелёк и деньги останутся в блокчейне. Но вернуть к ним доступ можно будет только сид-фразой и адресом. Если фраза не сохранена — доступ пропадёт навсегда.",
      confirmText: "Удалить",
      danger: true,
    });
    if (!ok) return;

    const pin = await requirePin();
    if (!pin) return;

    wipe();
    ctx.wallet = null;
    ctx.session = null;
    toast("Кошелёк удалён с этого устройства");
    ctx.go("welcome");
  };

  return el("div.screen.stack", {}, [
    el("h1.glow", { "data-t": "Настройки", text: "Настройки" }),

    // Монету из плашки убрали: GRAM подписан на каждой цифре в приложении,
    // и повторять его строкой справки незачем.
    el("div.glass.settings__card", {}, [
      el("div.row", {}, [
        el("span.dim", { text: "Адрес" }),
        el("span", { text: shortAddress(address, 6, 6) }),
      ]),
      el("div.row", {}, [el("span.dim", { text: "Сеть" }), el("span", { text: wallet.network })]),
    ]),

    el("div.screen__actions.settings__keys", {}, [
      glassButton("Показать seed-фразу", showBackup),
      glassButton("Сменить seed-фразу", () => ctx.go("rotate")),
    ]),

    el("div.screen__spacer"),

    /*
     * Кто это сделал и где исходники: клиент открытый, и проверить его
     * должно быть можно прямо из приложения.
     */
    el("div.credits", {}, [
      el("a.credits__dev", {
        href: "https://t.me/sweepes",
        target: "_blank",
        rel: "noopener",
        text: "dev @sweepes",
        onclick: (e) => {
          e.preventDefault();
          openLink("https://t.me/sweepes");
        },
      }),
      el("a.credits__gh", {
        href: APP_REPO_URL,
        target: "_blank",
        rel: "noopener",
        title: "Исходный код приложения",
        onclick: (e) => {
          e.preventDefault();
          openLink(APP_REPO_URL);
        },
      }, [githubMark(), el("span", { text: "GitHub" })]),
    ]),

    el("div.screen__actions", {}, [
      el("button.btn.btn--danger", {
        type: "button",
        text: "Удалить кошелёк с устройства",
        onclick: removeWallet,
      }),
      linkButton("Назад", () => ctx.go("home")),
    ]),
  ]);
}
