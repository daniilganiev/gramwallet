/**
 * Токены, NFT и история операций.
 *
 * Всё это индексируемые данные: их нельзя получить одним get-методом
 * контракта, нужен индексатор, который разобрал блокчейн заранее. Берём
 * toncenter v3 — тот же источник, на котором работают обозреватели, и
 * единственный домен, уже разрешённый политикой безопасности.
 *
 * Картинки токенов и NFT сознательно не показываем. Ссылка на картинку
 * лежит в самом токене, то есть её выбирает тот, кто его выпустил: открыв
 * такую ссылку, телефон сходит на чужой сервер и покажет ему свой адрес.
 * Ради иконки это плохой обмен, поэтому списки текстовые.
 */

import { Address, Cell } from "@ton/core";

import { OP } from "./constants.js";

const API = {
  mainnet: "https://toncenter.com/api/v3",
  testnet: "https://testnet.toncenter.com/api/v3",
};

/*
 * Очередь запросов к индексатору.
 *
 * Публичный toncenter держит около запроса в секунду, и обойти это нечем.
 * Пара запросов вплотную проходит, но за неё же и платишь: следующий ловит
 * 429 даже через полторы секунды, а откат стоит дороже, чем сэкономленная
 * пауза. Поэтому темп ровный.
 *
 * Раз слотов мало, выигрыш берём очерёдностью. Ждут запросы по-разному:
 * историю человек ждёт глядя в экран, а списки на главном обновляются сами
 * по себе. Интерактивный запрос встаёт перед фоновыми, а фоновый, которого
 * уже никто не ждёт, снимается с очереди, не тратя слот.
 */
const GAP_MS = 1100;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pending = [];
let pumping = false;
let lastAt = 0;

/** Фоновый запрос, снятый с очереди: его экран успели закрыть. */
const DROPPED = new Error("Запрос больше не нужен.");

/**
 * Ставит запрос в очередь.
 *
 * background — обновление, которое идёт само; такие пропускают вперёд всё
 * интерактивное. alive — признак, что результат ещё кому-то нужен: его
 * спрашивают в момент выдачи слота, а не постановки в очередь.
 */
function schedule(fn, { background = false, alive = null } = {}) {
  return new Promise((resolve, reject) => {
    const task = { fn, alive, background, resolve, reject };
    const firstBackground = background ? -1 : pending.findIndex((t) => t.background);
    if (firstBackground < 0) pending.push(task);
    else pending.splice(firstBackground, 0, task);
    pump();
  });
}

async function pump() {
  if (pumping) return;
  pumping = true;

  /*
   * Уступаем ход тому, кто нас позвал. Экран ставит запрос в очередь прямо
   * при сборке, когда его узел ещё не вставлен в документ, — проверь мы
   * alive() сразу, запрос отбросило бы как ненужный, не отправив.
   */
  await sleep(0);

  try {
    while (pending.length) {
      /*
       * Паузу держим до того, как возьмём задачу из очереди. За эту секунду
       * впереди может встать интерактивный запрос — и слот достанется ему,
       * а не фоновому, который просто пришёл первым.
       */
      const wait = lastAt + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);

      const task = pending.shift();
      if (task.alive && !task.alive()) {
        task.reject(DROPPED);
        continue;
      }

      try {
        task.resolve(await task.fn());
      } catch (e) {
        task.reject(e);
      } finally {
        lastAt = Date.now();
      }
    }
  } finally {
    pumping = false;
  }
}

async function get(path, params, network = "mainnet", opts = {}) {
  const url = new URL(`${API[network] ?? API.mainnet}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);

  /*
   * Пауза между попытками растёт. Публичный toncenter отвечает 429 не только
   * на наши запросы: лимит общий на адрес, и в него попадают все, кто сидит
   * за тем же выходом в сеть. Одной повторной попытки не хватало, и экран
   * писал «не удалось спросить индексатор» там, где токены есть.
   *
   * Место в очереди берётся на каждую попытку отдельно: повтор — такой же
   * запрос и в общий темп укладываться обязан.
   */
  const BACKOFF = [1500, 3500, 7000];

  let last = null;
  for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
    const res = await schedule(
      () => fetch(url, { headers: { Accept: "application/json" } }),
      opts,
    );
    if (res.ok) return res.json();
    last = res.status;
    if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF.length) {
      await sleep(BACKOFF[attempt]);
      continue;
    }
    throw new Error(`Индексатор ответил ${last}`);
  }
  throw new Error(`Индексатор ответил ${last}`);
}

/** Хеш транзакции в том виде, в каком его понимают обозреватели. */
export const hashToHex = (b64) => {
  try {
    return [...atob(b64.replace(/-/g, "+").replace(/_/g, "/"))]
      .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return b64;
  }
};

const asString = (address) =>
  typeof address === "string" ? address : address.toString({ bounceable: true });

/** Красивая сумма для токена с произвольной точностью. */
function fmtUnits(raw, decimals) {
  const d = Number(decimals ?? 9);
  const s = String(raw ?? "0").padStart(d + 1, "0");
  const whole = s.slice(0, s.length - d) || "0";
  const frac = d ? s.slice(s.length - d).replace(/0+$/, "") : "";
  return frac ? `${whole}.${frac.slice(0, 4)}` : whole;
}

/**
 * Токены на кошельке. Нулевые остатки не показываем: это мусор.
 *
 * Название и точность берём из metadata того же ответа: там лежат и
 * внешние описания, которые индексатор уже скачал за нас. Ходить за
 * ними самим нельзя — они живут на серверах, выбранных выпускающим
 * токена (у USDT это tether.to), и запрос выдал бы им наш адрес.
 */
export async function fetchJettons(address, network = "mainnet", opts = {}) {
  const data = await get(
    "/jetton/wallets",
    [["owner_address", asString(address)], ["limit", "100"]],
    network,
    opts,
  );
  const wallets = (data.jetton_wallets ?? []).filter((w) => BigInt(w.balance ?? "0") > 0n);
  if (!wallets.length) return [];

  return wallets.map((w) => {
    const info = data.metadata?.[w.jetton]?.token_info?.[0] ?? {};
    const decimals = info.extra?.decimals ?? info.decimals ?? 9;
    return {
      jetton: w.jetton,
      // Кошелёк токена — адрес, которому уходит команда перевода.
      wallet: data.address_book?.[w.address]?.user_friendly ?? w.address,
      raw: w.balance,
      decimals: Number(info.extra?.decimals ?? info.decimals ?? 9),
      symbol: info.symbol || info.name || "токен",
      name: info.name || data.address_book?.[w.jetton]?.user_friendly || w.jetton,
      amount: fmtUnits(w.balance, decimals),
      scam: Boolean(info.is_scam),
    };
  });
}

/** NFT на кошельке. */
export async function fetchNfts(address, network = "mainnet", opts = {}) {
  const data = await get("/nft/items", [["owner_address", asString(address)], ["limit", "100"]], network, opts);

  return (data.nft_items ?? []).map((item) => {
    const info = data.metadata?.[item.address]?.token_info?.[0] ?? {};
    const collection = data.metadata?.[item.collection_address]?.token_info?.[0] ?? {};
    // У части коллекций индекс — 78-значное число: как имя оно бесполезно.
    const index = String(item.index ?? "");
    const short = index.length <= 12 ? `#${index}` : "NFT";
    // У доменов имени нет вовсе: оно лежит отдельным полем, и без него
    // домен показывался безликим «NFT».
    const domain = info.extra?.domain || item.content?.domain;
    return {
      address: data.address_book?.[item.address]?.user_friendly ?? item.address,
      name: domain || info.name || item.content?.name || short,
      collection: collection.name || data.address_book?.[item.collection_address]?.user_friendly || "",
      scam: Boolean(info.is_scam || collection.is_scam),
    };
  });
}

/**
 * Название операции, которую индексатор не разобрал.
 *
 * Запрос к самому кошельку не порождает исходящих сообщений, и toncenter
 * отдаёт такое событие как type "unknown" вообще без деталей: ни опкода,
 * ни сторон. Так выглядит смена ключа — в истории она стояла безымянной
 * «Операцией» рядом с обычными переводами.
 *
 * Опкод при этом лежит в теле внешнего сообщения, сразу за подписью. Поле
 * opcode из ответа индексатора здесь не годится: он читает первые 32 бита
 * тела, а у WalletTg там начало подписи, а не команда.
 */
const UNNAMED = "Операция";

const SELF_OPS = {
  [OP.CHANGE_KEY_E]: "Ротация seed-фразы",
};

/** Что уже разбирали, по хешу транзакции. null — опкод не наш. */
const nameCache = new Map();

/** Опкод запроса WalletTg: подпись впереди, команда за ней. */
export function requestOpcode(body) {
  if (!body) return null;
  try {
    const s = Cell.fromBase64(body).beginParse();
    if (s.remainingBits < 512 + 32) return null;
    s.skip(512);
    return s.loadUint(32);
  } catch {
    return null;
  }
}

/** Как назвать внешний запрос по его телу. null — не наш опкод. */
export function selfOpName(body) {
  return SELF_OPS[requestOpcode(body)] ?? null;
}

/**
 * Называет операции по телам самих транзакций.
 *
 * Запрос уходит только если в истории есть неразобранные события, и только
 * по ним. Индексатор не ответил — операции останутся безымянными, но список
 * покажется: ради названия терять историю целиком нельзя.
 */
async function namesByHash(hashes, network, opts) {
  const names = new Map();
  // Хеш в адресной строке занимает под шестьдесят символов, поэтому пачками.
  for (let i = 0; i < hashes.length; i += 20) {
    const chunk = hashes.slice(i, i + 20);
    let data;
    try {
      data = await get(
        "/transactions",
        [...chunk.map((h) => ["hash", h]), ["limit", String(chunk.length)]],
        network,
        opts,
      );
    } catch {
      break;
    }
    for (const tx of data.transactions ?? []) {
      // Интересуют только внешние запросы: у них source пустой.
      if (tx.in_msg?.source) continue;
      const name = selfOpName(tx.in_msg?.message_content?.body);
      if (name) names.set(tx.hash, name);
    }
  }
  return names;
}

/**
 * История операций — в том же виде, в каком её показывают обозреватели.
 *
 * Сырые транзакции для этого не годятся: перевод токена в них выглядит как
 * служебное сообщение на чужой адрес (кошелёк токена), а не как «отправил
 * 0.03 USD₮». Индексатор уже собрал их в события — берём готовое.
 */
export async function fetchHistory(address, network = "mainnet", limit = 100, opts = {}) {
  const mine = asString(address);
  const data = await get(
    "/actions",
    [["account", mine], ["limit", String(limit)], ["sort", "desc"]],
    network,
    opts,
  );

  /*
   * Направление считаем сравнением самих адресов, а не строк.
   *
   * Раньше свой адрес искался по справочнику индексатора, а тот пишет туда
   * неотскакивающую форму (UQ…), тогда как историю мы спрашиваем в
   * отскакивающей (EQ…). Строки не совпадали никогда — свой адрес не
   * узнавался, и любая операция, включая собственные переводы, показывалась
   * как приход.
   */
  const me = Address.parse(mine);
  const isMine = (a) => {
    try {
      return Boolean(a) && Address.parse(a).equals(me);
    } catch {
      return false;
    }
  };

  /** Адрес контрагента в том виде, в каком его показывают обозреватели. */
  const friendly = (a) => {
    if (!a) return null;
    const known = data.address_book?.[a]?.user_friendly;
    if (known) return known;
    try {
      return Address.parse(a).toString({ bounceable: false });
    } catch {
      return a;
    }
  };
  const token = (a) => data.metadata?.[a]?.token_info?.[0] ?? {};

  const rows = (data.actions ?? []).map((act) => {
    const d = act.details ?? {};
    const row = {
      at: Number(act.start_utime ?? 0) * 1000,
      hash: act.transactions?.[0] ?? act.trace_id,
      success: act.success !== false,
      comment: d.comment || "",
      type: act.type,
    };

    if (act.type === "ton_transfer") {
      const out = isMine(d.source);
      return { ...row, kind: out ? "out" : "in", title: out ? "Отправлено" : "Получено",
        amount: fmtUnits(d.value, 9), unit: "GRAM", peer: friendly(out ? d.destination : d.source) };
    }

    if (act.type === "jetton_transfer") {
      const out = isMine(d.sender);
      const info = token(d.asset);
      return { ...row, kind: out ? "out" : "in", title: out ? "Отправлен токен" : "Получен токен",
        amount: fmtUnits(d.amount, info.extra?.decimals ?? info.decimals ?? 9),
        unit: info.symbol || "токен", peer: friendly(out ? d.receiver : d.sender) };
    }

    if (act.type === "nft_transfer") {
      const out = isMine(d.old_owner);
      const item = token(d.nft_item);
      const collection = token(d.nft_collection);
      return { ...row, kind: out ? "out" : "in", title: out ? "Отправлен NFT" : "Получен NFT",
        amount: item.name || collection.name || "NFT", unit: "",
        peer: friendly(out ? d.new_owner : d.old_owner) };
    }

    if (act.type === "contract_deploy") {
      return { ...row, kind: "self", title: "Кошелёк создан в блокчейне", amount: "", unit: "", peer: null };
    }

    if (act.type === "change_dns") {
      return { ...row, kind: "self", title: "Запись DNS изменена", amount: "", unit: "", peer: null };
    }

    // Тип, который индексатор не разобрал. Прятать нельзя: событие было,
    // и человек должен видеть его в списке, пусть и без подробностей.
    return { ...row, kind: "self", title: UNNAMED, amount: "", unit: "", peer: null };
  });

  return rows;
}

/**
 * Дописывает названия операциям, которые индексатор не разобрал.
 *
 * Отдельным шагом, уже после показа списка: за телами транзакций нужен
 * второй запрос, а он в общем темпе стоит секунду с лишним. Держать ради
 * двух заголовков всю историю за полосой ожидания — плохая сделка.
 *
 * Возвращает строки, у которых название изменилось: экрану остаётся
 * переписать их заголовки на месте.
 */
export async function nameSelfOps(rows, network = "mainnet", opts = {}) {
  const unnamed = rows.filter((r) => r.title === UNNAMED && r.hash);
  if (!unnamed.length) return [];

  const changed = [];
  const take = (r, name) => {
    if (!name) return;
    r.title = name;
    changed.push(r);
  };

  // Уже разобранное берём из памяти: тело транзакции не меняется никогда,
  // и второй заход на экран не должен снова стоить запроса.
  const ask = [];
  for (const r of unnamed) {
    if (nameCache.has(r.hash)) take(r, nameCache.get(r.hash));
    else if (!ask.includes(r.hash)) ask.push(r.hash);
  }
  if (!ask.length) return changed;

  const names = await namesByHash(ask, network, opts);
  // Запоминаем и промахи: чужой опкод вторым запросом своим не станет.
  for (const h of ask) nameCache.set(h, names.get(h) ?? null);
  for (const r of unnamed) take(r, names.get(r.hash));

  return changed;
}
