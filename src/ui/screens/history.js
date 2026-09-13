import { el, copyText, shortAddress } from "../dom.js";
import { glassButton, linkButton, toast } from "../components.js";
import { haptic, openLink } from "../../telegram.js";
import { fetchHistory, hashToHex, nameSelfOps } from "../../core/assets.js";
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
 * Последний показанный список.
 *
 * Живёт вне экрана по той же причине, что и цифры на главном: индексатор
 * пускает около запроса в секунду, и собирать историю заново на каждом
 * заходе значит каждый раз показывать пустоту с полосой ожидания. Прошлый
 * список почти наверняка ещё верен — показываем его сразу, свежесть
 * догоняет в фоне.
 */
const seen = { address: null, rows: null };

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
  const address = wallet.address.toString({ bounceable: true });

  // Кошелёк сменился — прошлый список не наш.
  if (seen.address !== address) {
    seen.address = address;
    seen.rows = null;
  }

  const list = el("div.history");

  const screen = el("div.screen.stack.history-screen", {}, [
    el("h1.glow", { "data-t": "История", text: "История" }),
    list,
    el("div.screen__spacer"),
    el("div.screen__actions", {}, [linkButton("Назад", () => ctx.go("home"))]),
  ]);

  const caption = (r) => (r.success ? r.title : `${r.title} — не прошло`);

  /** Заголовки строк: названия части операций приходят уже после показа. */
  const captions = new Map();

  const paint = (rows) => {
    captions.clear();
    list.replaceChildren(
      ...rows.map((r) => {
        const kind = el("span.op__kind", { text: caption(r) });
        captions.set(r, kind);

        return el(`div.op.op--${r.kind}`, {}, [
          el("div.op__head", {}, [
            kind,
            r.amount
              ? el("span.op__amount", {
                  text: `${r.kind === "in" ? "+" : r.kind === "out" ? "−" : ""}${r.amount}${r.unit ? " " + r.unit : ""}`,
                })
              : el("span"),
          ]),
          el("div.op__meta", {}, [
            el("span", { text: when(r.at) }),

            /*
             * Адрес второй стороны — кнопка, а не подпись. Из истории его
             * чаще всего и берут: повторить перевод, ответить, занести
             * в заметки. Показываем коротко, копируем целиком.
             */
            r.peer
              ? el("button.op__peer", {
                  type: "button",
                  title: "Скопировать адрес",
                  // Показываем домен, если он есть, а копируем всё равно адрес:
                  // он однозначен и понятен любому обозревателю.
                  text: `${r.kind === "out" ? "кому" : "от"} ${r.peerName ?? shortAddress(r.peer, 6, 6)}`,
                  onclick: async () => {
                    const ok = await copyText(r.peer);
                    haptic(ok ? "light" : "error");
                    toast(ok ? "Адрес скопирован" : "Не удалось скопировать", { error: !ok });
                  },
                })
              : el("span"),
          ]),
          r.comment ? el("div.op__comment", { text: r.comment }) : el("span"),

          // Ссылка на обозреватель: там видно всё, чего мы не показываем —
          // комиссии, служебные сообщения, дерево транзакции целиком.
          el("button.op__link", {
            type: "button",
            text: "Открыть в Tonviewer",
            onclick: () => openLink(`https://tonviewer.com/transaction/${hashToHex(r.hash)}`),
          }),
        ]);
      }),
    );
  };

  const load = async () => {
    if (seen.rows?.length) paint(seen.rows);
    else list.replaceChildren(el("p.dim", { text: "История загружается…" }));

    const alive = () => screen.isConnected;

    try {
      const rows = await fetchHistory(address, wallet.network, 100, { alive });

      // Список кладём в память даже если экран уже закрыли: он верен,
      // и следующий заход начнётся не с пустоты.
      seen.rows = rows;
      if (!alive()) return;

      if (!rows.length) {
        list.replaceChildren(
          el("p.faint", { text: "Операций пока нет. Первой станет пополнение кошелька." }),
        );
        return;
      }

      paint(rows);

      /*
       * Названия операций, которых индексатор не разобрал, стоят второго
       * запроса — а это ещё секунда в общем темпе. Список к этому моменту
       * уже на экране: дописываем заголовки по месту, а не держим ради них
       * всю историю за полосой ожидания.
       */
      for (const r of await nameSelfOps(rows, wallet.network, { alive })) {
        const node = captions.get(r);
        if (node) node.textContent = caption(r);
      }
    } catch (e) {
      // Список из памяти честнее ошибки: минуту назад он был верен.
      if (seen.rows?.length) return;
      list.replaceChildren(
        el("div.note.note--danger", { text: explainError(e) }),
        glassButton("Повторить", () => load()),
      );
    }
  };

  load();

  return screen;
}
