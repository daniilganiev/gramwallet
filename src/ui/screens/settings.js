import { el, copyText, shortAddress } from "../dom.js";
import { glassButton, linkButton, sheet, toast } from "../components.js";
import { openLink } from "../../telegram.js";
import { APP_REPO_URL, COIN } from "../../core/constants.js";
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
        el("div.glass.glass--tight", {}, [
          el("div.faint", { text: "Адрес" }),
          el("div.mono", { text: address }),
        ]),
      ]),
      confirmText: "Скопировать всё",
      cancelText: "Закрыть",
    }).then(async (copy) => {
      if (!copy) return;
      const ok = await copyText(`${mnemonic.join(" ")}\n\nАдрес: ${address}`);
      toast(ok ? "Скопировано" : "Не удалось скопировать", { error: !ok });
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

    el("div.glass", {}, [
      el("div.row", {}, [
        el("span.dim", { text: "Адрес" }),
        el("span", { text: shortAddress(address, 6, 6) }),
      ]),
      el("div.row", {}, [el("span.dim", { text: "Сеть" }), el("span", { text: wallet.network })]),
      el("div.row", {}, [el("span.dim", { text: "Монета" }), el("span", { text: COIN })]),
    ]),

    el("div.screen__actions", {}, [
      glassButton("Показать резервную копию", showBackup),
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

/** Значок GitHub — восьмёрка кота-осьминога, официальный контур марки. */
function githubMark() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute(
    "d",
    "M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.42 7.42 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z",
  );
  svg.append(path);
  return svg;
}
