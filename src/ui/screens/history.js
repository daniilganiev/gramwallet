import { el, shortAddress } from "../dom.js";
import { glassButton, linkButton } from "../components.js";
import { openLink } from "../../telegram.js";
import { fetchHistory, hashToHex } from "../../core/assets.js";
import { explainError } from "../../core/client.js";

const when = (ms) =>
  new Date(ms).toLocaleString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * История операций.
 *
 * Всё, что происходило с кошельком с самого его создания: приходы, расходы
 * и первая транзакция деплоя. Данные — из того же индексатора, на котором
 * работают обозреватели, поэтому список совпадает с тем, что видно в них.
 */
export function historyScreen(ctx) {
  if (!ctx.wallet) {
    setTimeout(() => ctx.go("lock"), 0);
    return el("div.screen");
  }

  const wallet = ctx.wallet;
  const list = el("div.history", {}, [el("p.dim", { text: "Поднимаем историю…" })]);

  const load = async () => {
    list.replaceChildren(el("p.dim", { text: "Поднимаем историю…" }));
    try {
      const rows = await fetchHistory(wallet.address.toString({ bounceable: true }), wallet.network);

      if (!rows.length) {
        list.replaceChildren(
          el("p.faint", { text: "Операций пока нет. Первой станет пополнение кошелька." }),
        );
        return;
      }

      list.replaceChildren(
        ...rows.map((r) =>
          el(`div.op.op--${r.kind}`, {}, [
            el("div.op__head", {}, [
              el("span.op__kind", { text: r.success ? r.title : `${r.title} — не прошло` }),
              r.amount
                ? el("span.op__amount", {
                    text: `${r.kind === "in" ? "+" : r.kind === "out" ? "−" : ""}${r.amount}${r.unit ? " " + r.unit : ""}`,
                  })
                : el("span"),
            ]),
            el("div.op__meta", {}, [
              el("span", { text: when(r.at) }),
              r.peer ? el("span.op__peer", { text: shortAddress(r.peer, 6, 6) }) : el("span"),
            ]),
            r.comment ? el("div.op__comment", { text: r.comment }) : el("span"),

            // Ссылка на обозреватель: там видно всё, чего мы не показываем —
            // комиссии, служебные сообщения, дерево транзакции целиком.
            el("button.op__link", {
              type: "button",
              text: "Открыть в Tonviewer",
              onclick: () => openLink(`https://tonviewer.com/transaction/${hashToHex(r.hash)}`),
            }),
          ]),
        ),
      );
    } catch (e) {
      list.replaceChildren(
        el("div.note.note--danger", { text: explainError(e) }),
        glassButton("Повторить", () => load()),
      );
    }
  };

  load();

  return el("div.screen.stack.history-screen", {}, [
    el("h1.glow", { "data-t": "История", text: "История" }),
    el("p.lead", { text: "Всё, что происходило с кошельком с первого дня." }),
    list,
    el("div.screen__spacer"),
    el("div.screen__actions", {}, [linkButton("Назад", () => ctx.go("home"))]),
  ]);
}
