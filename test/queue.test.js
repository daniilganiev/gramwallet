/**
 * Очередь запросов к индексатору: темп, приоритет и отмена.
 *
 * Сеть не трогаем — подменяем fetch и смотрим, что и когда ушло. Ошибки
 * здесь глазами не видны: они превращаются либо в лишние секунды ожидания,
 * либо в запрос, который молча никуда не пошёл.
 */

import { fetchHistory, fetchJettons, fetchNfts } from "../src/core/assets.js";

// Нулевой адрес: запросы всё равно не уходят дальше подменённого fetch.
const ADDR = "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Что ушло в сеть и на какой секунде. */
let hits = [];
const t0 = Date.now();

globalThis.fetch = async (url) => {
  hits.push({ path: new URL(url).pathname.replace("/api/v3", ""), at: Date.now() - t0 });
  await sleep(30);
  return {
    ok: true,
    status: 200,
    json: async () => ({ actions: [], jetton_wallets: [], nft_items: [], transactions: [] }),
  };
};

console.log("\nПриоритет и темп");

hits = [];
await Promise.all([
  // Фон: главный экран обновляет свои списки.
  fetchJettons(ADDR, "mainnet", { background: true }),
  fetchNfts(ADDR, "mainnet", { background: true }),
  // Человек в этот же момент открыл историю.
  fetchHistory(ADDR, "mainnet", 10),
]);

check("интерактивный запрос обгоняет фоновые", hits[0]?.path === "/actions", hits.map((h) => h.path).join(" -> "));
check("фоновые идут следом", hits[1]?.path === "/jetton/wallets" && hits[2]?.path === "/nft/items");

const gaps = [hits[1].at - hits[0].at, hits[2].at - hits[1].at];
check("темп не быстрее 1100 мс", gaps.every((g) => g >= 1100), gaps.map((g) => `${g} мс`).join(", "));

console.log("\nОтмена ненужного");

hits = [];
let dropped = false;
await fetchJettons(ADDR, "mainnet", { background: true, alive: () => false }).catch(() => {
  dropped = true;
});
check("закрытый экран не тратит слот", dropped && hits.length === 0, `запросов: ${hits.length}`);

console.log("\nЗапрос, поставленный до вставки экрана");

/*
 * Экран собирается и сразу просит данные, а в документ его вставляют строкой
 * позже. Проверка alive() не должна успеть сработать до этого — иначе запрос
 * отбрасывается как ненужный, ни разу не уйдя в сеть.
 */
hits = [];
let attached = false;
const pending = fetchHistory(ADDR, "mainnet", 10, { alive: () => attached });
attached = true;
await pending;
check("не теряется", hits.length === 1, `запросов: ${hits.length}`);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
