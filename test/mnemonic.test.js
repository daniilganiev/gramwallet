/**
 * Две схемы seed-фраз: родная TON и BIP39 из кошелька Telegram.
 *
 * Ошибка здесь не падает, а тихо открывает чужой пустой адрес, поэтому
 * сверяемся с эталонами, а не с собственным кодом.
 */

import { mnemonicNew, mnemonicToPrivateKey, pbkdf2_sha512 } from "@ton/crypto";

import { SCHEME, isBip39, keyPairFor, schemesOf } from "../src/core/mnemonic.js";

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const ABOUT = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about".split(" ");

console.log("\nКонтрольная сумма BIP39");
check("эталонная фраза из 12 слов", await isBip39(ABOUT));
check("12 × abandon — сумма не сходится", !(await isBip39(Array(12).fill("abandon"))));
check("24 слова: abandon × 23 + art", await isBip39([...Array(23).fill("abandon"), "art"]));
check("чужое слово", !(await isBip39([...ABOUT.slice(0, 11), "notaword"])));
check("13 слов", !(await isBip39([...ABOUT, "abandon"])));

console.log("\nВывод ключа BIP39");
// Эталонный сид из спецификации BIP39 для этой фразы без пароля.
const seed = await pbkdf2_sha512(ABOUT.join(" "), "mnemonic", 2048, 64);
check(
  "сид совпадает с эталоном BIP39",
  seed.toString("hex") ===
    "5eb00bbddcf069084889a8ab9155568165f5c453ccb85e70811aaed6f6da5fc19a5ac40b389cd370d086206dec8aa6c43daea6690f20ad3d8d48b2d2ce9e38e4",
);
// Путь m/44'/607'/0' сверен с живым кошельком Telegram: адрес WalletTg совпал.
const bip = await keyPairFor(ABOUT, SCHEME.BIP39);
check(
  "ключ по m/44'/607'/0'",
  bip.publicKey.toString("hex") === "7952e94118f34607c75e23258dd9220d66ccac5a3ee074125c25068e8107bfbf",
);

console.log("\nВыбор схемы");
const ours = await mnemonicNew(24);
const schemes = await schemesOf(ours);
check("наша фраза читается как TON", schemes.includes(SCHEME.TON), schemes.join(", "));
const tonKey = await keyPairFor(ours);
check(
  "схема по умолчанию — TON",
  tonKey.publicKey.equals((await mnemonicToPrivateKey(ours)).publicKey),
);
check("фраза Telegram — только BIP39", (await schemesOf(ABOUT)).join() === SCHEME.BIP39);
check("мусор не читается никак", (await schemesOf(Array(12).fill("zoo"))).length === 0);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
