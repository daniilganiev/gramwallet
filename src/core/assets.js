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

import { Address } from "@ton/core";

const API = {
  mainnet: "https://toncenter.com/api/v3",
  testnet: "https://testnet.toncenter.com/api/v3",
};

/*
 * Публичный toncenter пускает примерно один запрос в секунду на адрес.
 * Экрану нужно три-четыре подряд — токены, их описания, NFT, история, —
 * поэтому пропускаем их по одному с паузой, а не веером. Иначе часть
 * ответов приходит как 429, и список выглядит пустым на ровном месте.
 */
const GAP_MS = 1100;
let queue = Promise.resolve();
let lastAt = 0;

function queued(fn) {
  const run = queue.then(async () => {
    const wait = lastAt + GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      lastAt = Date.now();
    }
  });
  queue = run.catch(() => {});
  return run;
}

async function get(path, params, network = "mainnet") {
  const url = new URL(`${API[network] ?? API.mainnet}${path}`);
  for (const [k, v] of params) url.searchParams.append(k, v);

  /*
   * Пауза между попытками растёт. Публичный toncenter отвечает 429 не только
   * на наши запросы: лимит общий на адрес, и в него попадают все, кто сидит
   * за тем же выходом в сеть. Одной повторной попытки не хватало, и экран
   * писал «не удалось спросить индексатор» там, где токены есть.
   */
  const BACKOFF = [1500, 3500, 7000];

  return queued(async () => {
    let last = null;
    for (let attempt = 0; attempt <= BACKOFF.length; attempt++) {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.ok) return res.json();
      last = res.status;
      if ((res.status === 429 || res.status >= 500) && attempt < BACKOFF.length) {
        await new Promise((r) => setTimeout(r, BACKOFF[attempt]));
        continue;
      }
      throw new Error(`Индексатор ответил ${last}`);
    }
    throw new Error(`Индексатор ответил ${last}`);
  });
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
export async function fetchJettons(address, network = "mainnet") {
  const data = await get("/jetton/wallets", [["owner_address", asString(address)], ["limit", "100"]], network);
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
export async function fetchNfts(address, network = "mainnet") {
  const data = await get("/nft/items", [["owner_address", asString(address)], ["limit", "100"]], network);

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
 * История операций — в том же виде, в каком её показывают обозреватели.
 *
 * Сырые транзакции для этого не годятся: перевод токена в них выглядит как
 * служебное сообщение на чужой адрес (кошелёк токена), а не как «отправил
 * 0.03 USD₮». Индексатор уже собрал их в события — берём готовое.
 */
export async function fetchHistory(address, network = "mainnet", limit = 100) {
  const mine = asString(address);
  const data = await get(
    "/actions",
    [["account", mine], ["limit", String(limit)], ["sort", "desc"]],
    network,
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

  return (data.actions ?? []).map((act) => {
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
    return { ...row, kind: "self", title: "Операция", amount: "", unit: "", peer: null };
  });
}
