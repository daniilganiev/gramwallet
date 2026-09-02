/**
 * Round-trip проверка кодирования массива сообщений против логики
 * parseArrayAndSend из contracts/WalletTg/send-to-c5.tolk.
 *
 * Это главный тест проекта: ошибка здесь означает, что деньги уйдут не туда
 * или не в том порядке, и поймать её на цепочке будет уже дорого.
 */

import { Address } from "@ton/core";

import { encodeMessagesArray, buildSendRequest, signRequest, toMessageToSend } from "../src/core/serialize.js";
import { OP } from "../src/core/constants.js";

// Нулевой адрес: тесты проверяют кодирование, а не доставку.
const DEST = "UQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJKZ";

/** Точная копия parseArrayAndSend. */
function parseArrayAndSend(slice) {
  const len = slice.loadUint(8);
  let head = slice.loadMaybeRef();
  if (head === null) throw new Error("head == null -> beginParse of null");

  const out = [];
  let count = 0;
  do {
    const s = head.beginParse();
    head = s.loadMaybeRef();
    const chunkSize = s.remainingRefs;
    if (chunkSize > 4) throw new Error("в чанке больше 4 рефов");
    count += chunkSize;
    for (let i = 0; i < chunkSize; i++) {
      out.push({ sendMode: s.loadUint(8), messageCell: s.loadRef() });
    }
    if (s.remainingBits !== 0 || s.remainingRefs !== 0) {
      throw new Error(`assertEnd провален: bits=${s.remainingBits} refs=${s.remainingRefs}`);
    }
  } while (head !== null);

  if (count === 0) throw new Error("exit 147: пустой массив");
  if (count !== len) throw new Error(`exit 147: len=${len} != count=${count}`);
  return out;
}

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

console.log("\nКодирование массива сообщений");

for (const n of [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 100, 254, 255]) {
  const messages = Array.from({ length: n }, (_, i) =>
    toMessageToSend({ to: DEST, amount: "0.001", comment: `msg-${i}` }),
  );

  try {
    const encoded = encodeMessagesArray(messages).endCell();
    const decoded = parseArrayAndSend(encoded.beginParse());

    if (decoded.length !== n) throw new Error(`декодировано ${decoded.length}, ждали ${n}`);
    for (let i = 0; i < n; i++) {
      if (decoded[i].sendMode !== messages[i].sendMode) throw new Error(`sendMode #${i}`);
      if (!decoded[i].messageCell.equals(messages[i].messageCell)) throw new Error(`порядок сбит на #${i}`);
    }

    let depth = 0;
    const s = encoded.beginParse();
    s.loadUint(8);
    let c = s.loadMaybeRef();
    while (c !== null) {
      depth++;
      c = c.beginParse().loadMaybeRef();
    }
    check(`${String(n).padStart(3)} сообщений`, true, `чанков ${depth}`);
  } catch (e) {
    check(`${String(n).padStart(3)} сообщений`, false, e.message);
  }
}

console.log("\nГраницы");
try {
  encodeMessagesArray([]);
  check("пустой массив отклонён", false);
} catch {
  check("пустой массив отклонён", true);
}
try {
  encodeMessagesArray(new Array(256).fill(toMessageToSend({ to: DEST, amount: "0.001" })));
  check("256 сообщений отклонено", false);
} catch {
  check("256 сообщений отклонено", true);
}

console.log("\nФорма запроса");
const one = [toMessageToSend({ to: DEST, amount: "0.1" })];
const reqOne = buildSendRequest({
  messages: one,
  subwalletId: 0x7fff7f11,
  seqno: 3,
  validUntil: 1788290000,
  isExternal: true,
});
{
  const s = reqOne.beginParse();
  const op = s.loadUint(32);
  const sw = s.loadUint(32);
  const vu = s.loadUint(32);
  const sq = s.loadUint(32);
  const sm = s.loadUint(8);
  check("одно сообщение: опкод 0x63896e75", op === OP.SEND_ONE_E, `0x${op.toString(16)}`);
  check("заголовок разобран", sw === 0x7fff7f11 && vu === 1788290000 && sq === 3);
  check("sendMode содержит IGNORE_ERRORS", (sm & 2) !== 0, String(sm));
  check("тело разобрано без остатка", s.remainingBits === 0 && s.remainingRefs === 1);
}

const many = Array.from({ length: 5 }, (_, i) => toMessageToSend({ to: DEST, amount: "0.01", comment: `b${i}` }));
const reqMany = buildSendRequest({
  messages: many,
  subwalletId: 0x7fff7f11,
  seqno: 3,
  validUntil: 1788290000,
  isExternal: true,
});
{
  const s = reqMany.beginParse();
  const op = s.loadUint(32);
  s.loadUint(32);
  s.loadUint(32);
  s.loadUint(32);
  check("пакет: опкод 0x73896e75", op === OP.SEND_BULK_E, `0x${op.toString(16)}`);
  check("пакет распарсился", parseArrayAndSend(s).length === 5);
}

const signed = signRequest(reqMany, Buffer.alloc(64));
check("подписанное тело влезает в ячейку", signed.bits.length <= 1023, `${signed.bits.length} из 1023`);

check("адрес разбирается", Address.parse(DEST).toString().length > 0);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
