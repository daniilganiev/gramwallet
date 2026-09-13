/**
 * Разбор имени в сети TON.
 *
 * Сеть здесь не нужна: проверяем, что именно уйдёт в запрос. Отдельно стоит
 * приведение к нижнему регистру — toncenter отвечает пустым списком записей
 * на GrandFatherTon.ton и находит grandfatherton.ton, так что без этого
 * человек с телефонной клавиатурой, поставившей заглавную, получал бы
 * «домен ни на что не указывает» на совершенно живом имени.
 */

import { toDomain } from "../src/core/assets.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const eq = (name, got, want) =>
  check(name, got === want, `${JSON.stringify(got)} ← ждали ${JSON.stringify(want)}`);

console.log("\nИмена, которые принимаем");

eq("обычный .ton", toDomain("grandfatherton.ton"), "grandfatherton.ton");
eq("зона t.me", toDomain("realsaltlake.t.me"), "realsaltlake.t.me");
eq("@имя это домен в t.me", toDomain("@sweepes"), "sweepes.t.me");
eq("верхний регистр приводится", toDomain("GrandFatherTon.TON"), "grandfatherton.ton");
eq("пробелы по краям", toDomain("  grandfatherton.ton  "), "grandfatherton.ton");
eq("дефис внутри", toDomain("mellory-pep.ton"), "mellory-pep.ton");
eq("цифры", toDomain("wallet123.ton"), "wallet123.ton");

console.log("\nИмена, которые отклоняем");

const no = (name, input) => check(name, toDomain(input) === null, `вернулось ${JSON.stringify(toDomain(input))}`);

no("адрес не домен", "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ");
no("без зоны", "grandfatherton");
no("чужая зона", "example.com");
no("пусто", "");
no("только пробелы", "   ");
no("мусор", "!!!");
no("ничего", null);
no("точка в начале", ".ton");

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
