/**
 * Проверка запроса на смену ключа: форма, доказательство, границы.
 * Работает офлайн на случайных ключах, ничего никуда не отправляет.
 */

import crypto from "node:crypto";
import { Address } from "@ton/core";
import { keyPairFromSeed, signVerify } from "@ton/crypto";

import {
  buildChangeKeyRequest,
  buildKeyRotationProof,
  buildSendRequest,
  signRequest,
  toMessageToSend,
} from "../src/core/serialize.js";
import { KEY_ROTATION_TAG, OP } from "../src/core/constants.js";
import { requestOpcode, selfOpName } from "../src/core/assets.js";

const randomKey = () => keyPairFromSeed(crypto.randomBytes(32));
const randomAddress = () => new Address(0, crypto.randomBytes(32));

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

const ADDR = randomAddress();
const OTHER = randomAddress();
const currentKey = randomKey();
const newKey = randomKey();
const proof = buildKeyRotationProof(ADDR, newKey.secretKey);

console.log("\nТег доказательства");
const tagAscii = Buffer.from(KEY_ROTATION_TAG.toString(16), "hex").toString("ascii");
check('декодируется как "KEY_ROTATION"', tagAscii === "KEY_ROTATION", tagAscii);
check("занимает ровно 96 бит", KEY_ROTATION_TAG < 1n << 96n && KEY_ROTATION_TAG >= 1n << 88n);

console.log("\nДоказательство владения новым ключом");
check("payload = 96 + 8 + 256 бит", proof.payload.bits.length === 360, `${proof.payload.bits.length} бит`);
check("рефов в payload нет", proof.payload.refs.length === 0);
check("подпись 64 байта", proof.signature.length === 64);
check("проходит проверку новым ключом", signVerify(proof.payload.hash(), proof.signature, newKey.publicKey));
check(
  "НЕ проходит текущим ключом",
  !signVerify(proof.payload.hash(), proof.signature, currentKey.publicKey),
);
check(
  "привязано к адресу кошелька",
  !buildKeyRotationProof(OTHER, newKey.secretKey).payload.equals(proof.payload),
);

console.log("\nЗапрос ChangePublicKeyRequestE");
const request = buildChangeKeyRequest({
  newPublicKey: newKey.publicKey,
  rotationSignature: proof.signature,
  subwalletId: 0x7fff7f11,
  seqno: 3,
  validUntil: 1788290000,
  isExternal: true,
});

const s = request.beginParse();
const op = s.loadUint(32);
const sw = s.loadUint(32);
const vu = s.loadUint(32);
const sq = s.loadUint(32);
const pk = s.loadBuffer(32);
const sigCell = s.loadRef();

check("опкод 0xfbba99c8", op === OP.CHANGE_KEY_E, `0x${op.toString(16)}`);
check("заголовок разобран", sw === 0x7fff7f11 && vu === 1788290000 && sq === 3);
check("новый публичный ключ совпадает", pk.equals(newKey.publicKey));
check("доказательство лежит рефом, 512 бит", sigCell.bits.length === 512);
check("подпись в рефе — та самая", sigCell.beginParse().loadBuffer(64).equals(proof.signature));
check("тело разобрано без остатка", s.remainingBits === 0 && s.remainingRefs === 0);

console.log("\nВнешняя подпись");
const body = signRequest(request, currentKey.secretKey);
const outer = body.beginParse().loadBuffer(64);
check("подпись стоит впереди", signVerify(request.hash(), outer, currentKey.publicKey));
check("влезает в одну ячейку", body.bits.length <= 1023, `${body.bits.length} из 1023`);

console.log("\nНазвание операции в истории");

/*
 * Тело в том виде, в каком его отдаёт индексатор: BOC внешнего сообщения
 * целиком. Настоящие байты с цепочки сюда не кладём — в них лежит публичный
 * ключ, а по нему считается адрес живого кошелька.
 *
 * Проверка от этого не слабеет: она ловит ровно то, ради чего написана —
 * что опкод ищут за подписью, а не в начале тела. Переставь signRequest
 * подпись в конец, как в wallet v5, и этот тест упадёт.
 */
const ROTATION_BODY = body.toBoc().toString("base64");

const decoded = requestOpcode(ROTATION_BODY);
check("опкод достаётся из-за подписи", decoded === OP.CHANGE_KEY_E, `0x${(decoded ?? 0).toString(16)}`);
check("названа своим именем", selfOpName(ROTATION_BODY) === "Ротация seed-фразы");

// Обычный перевод под это название попасть не должен.
const transfer = signRequest(
  buildSendRequest({
    messages: [toMessageToSend({ to: ADDR, amount: "0.01" })],
    subwalletId: 0x7fff7f11,
    seqno: 0,
    validUntil: 1788290000,
    isExternal: true,
  }),
  currentKey.secretKey,
);
check("перевод остаётся без названия", selfOpName(transfer.toBoc().toString("base64")) === null);
check("мусор не ломает разбор", requestOpcode("не-boc") === null && requestOpcode(null) === null);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
