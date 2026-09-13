/**
 * Суммы: чистка ввода и разбор вставленного списка.
 *
 * Обе функции стоят прямо на пути денег. Строка «UQ… 0,5» когда-то
 * распадалась на «0» и «5», суммой бралось первое, и вместо половины уходил
 * ноль — без единой ошибки, потому что «0» разбирается прекрасно. Такое
 * глазами не ловится, поэтому здесь.
 */

import { cleanAmount } from "../src/ui/components.js";
import { parseLine } from "../src/ui/screens/batch.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const eq = (name, got, want) => check(name, got === want, `${JSON.stringify(got)} ← ждали ${JSON.stringify(want)}`);

console.log("\nЧистка поля суммы");

eq("буквы не проходят", cleanAmount("12abc3"), "123");
eq("буквы вместо числа", cleanAmount("abc"), "");
eq("точка остаётся", cleanAmount("0.5"), "0.5");
eq("запятая остаётся", cleanAmount("0,5"), "0,5");
eq("второй разделитель отбрасывается", cleanAmount("0.5.7"), "0.57");
eq("смешанные разделители", cleanAmount("1,2.3"), "1,23");
eq("минус и пробелы", cleanAmount("-1 000.5"), "1000.5");
eq("экспонента", cleanAmount("1e9"), "19");
eq("девять знаков — предел GRAM", cleanAmount("0.1234567890123"), "0.123456789");
eq("шесть знаков для USD₮", cleanAmount("0.1234567", 6), "0.123456");
eq("целые, если знаков нет вовсе", cleanAmount("12.34", 0), "12");
eq("пустая строка", cleanAmount(""), "");

console.log("\nРазбор строки вставленного списка");

const A = "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ";
const line = (text) => parseLine(text);

eq("адрес и сумма", line(`${A} 0.5`).amount, "0.5");
eq("запятая — дробная, а не разделитель", line(`${A} 0,5`).amount, "0.5");
eq("адрес при этом цел", line(`${A} 0,5`).to, A);
eq("табуляция", line(`${A}\t1.25`).amount, "1.25");
eq("точка с запятой", line(`${A};2.5`).amount, "2.5");
eq("сумма впереди адреса", line(`0.5 ${A}`).to, A);
eq("сумма впереди: сумма", line(`0.5 ${A}`).amount, "0.5");
eq("лишнее слово не мешает", line(`${A} 0.5 GRAM`).amount, "0.5");
eq("строка без суммы: адрес есть", line(A).to, A);
eq("строка без суммы: сумма пуста", line(A).amount, "");
eq("домен вместо адреса", line("grandfatherton.ton 0,5").to, "grandfatherton.ton");
eq("домен: сумма", line("grandfatherton.ton 0,5").amount, "0.5");
eq("целая сумма", line(`${A} 3`).amount, "3");

// Ровно та подмена, из-за которой всё затевалось.
check(
  "0,5 больше не превращается в 0",
  parseLine(`${A} 0,5`).amount !== "0",
  `сейчас ${JSON.stringify(parseLine(`${A} 0,5`).amount)}`,
);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
