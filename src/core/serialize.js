/**
 * Сериализация запросов к контракту WalletTg.
 *
 * Код перенесён из CLI-клиента, проверенного на мейннете: деплой, переводы,
 * пакетная отправка змейкой и ротация ключа туда-обратно. Логика не менялась,
 * только модульный синтаксис.
 *
 * Ключевое отличие от wallet v5: подпись стоит В НАЧАЛЕ тела, а не в конце,
 * и контракт сам собирает c5 — клиент шлёт сообщения, а не готовый регистр.
 */

import {
  beginCell,
  Cell,
  Address,
  internal,
  storeMessageRelaxed,
  comment,
  toNano,
} from "@ton/core";
import { sign } from "@ton/crypto";

import {
  DEFAULT_SEND_MODE,
  KEY_ROTATION_TAG,
  MAX_MESSAGES,
  OP,
} from "./constants.js";

/**
 * struct (0x00) Storage { seqno: uint32, subwalletId: uint32, publicKey: uint256 }
 * Префикс 0x00 — Revision.Rev00_Initial; при новой ревизии контракт мигрирует c4 сам.
 */
export function buildStorage(publicKey, subwalletId, seqno = 0) {
  return beginCell()
    .storeUint(0x00, 8)
    .storeUint(seqno, 32)
    .storeUint(subwalletId, 32)
    .storeBuffer(publicKey, 32)
    .endCell();
}

/** Готовая ячейка исходящего internal-сообщения — то, что уйдёт в sendRawMessage. */
export function transferCell({ to, value, body = null, bounce = false, init = null }) {
  const msg = internal({
    to: typeof to === "string" ? Address.parse(to) : to,
    value: typeof value === "string" ? toNano(value) : value,
    bounce,
    init,
    body: typeof body === "string" && body.length > 0 ? comment(body) : (body ?? Cell.EMPTY),
  });
  return beginCell().store(storeMessageRelaxed(msg)).endCell();
}

/** Нормализует описание перевода в { sendMode, messageCell }. */
export function toMessageToSend(item) {
  if (item && item.messageCell instanceof Cell) {
    return { sendMode: item.sendMode ?? DEFAULT_SEND_MODE, messageCell: item.messageCell };
  }
  return {
    sendMode: item.sendMode ?? DEFAULT_SEND_MODE,
    messageCell: transferCell({
      to: item.to,
      value: item.value ?? item.amount,
      body: item.body ?? item.comment ?? null,
      bounce: item.bounce ?? false,
    }),
  };
}

/**
 * Кодирует array<MessageToSend> ровно так, как его читает parseArrayAndSend:
 *
 *   внешний слайс: uint8 len + maybeRef -> головной чанк
 *   чанк:          maybeRef(next) + N x (uint8 sendMode + ref messageCell)
 *
 * Змейка строится с хвоста: последний чанк не тратит реф на next и вмещает
 * до 4 сообщений, промежуточные — до 3. Контракт идёт head -> next, поэтому
 * порядок сообщений сохраняется.
 */
export function encodeMessagesArray(messages) {
  if (messages.length < 1 || messages.length > MAX_MESSAGES) {
    throw new Error(`Сообщений должно быть от 1 до ${MAX_MESSAGES}, получено ${messages.length}.`);
  }
  let tail = null;
  let end = messages.length;
  while (end > 0) {
    const take = Math.min(tail === null ? 4 : 3, end);
    const start = end - take;
    const chunk = beginCell().storeMaybeRef(tail);
    for (let i = start; i < end; i++) {
      chunk.storeUint(messages[i].sendMode, 8).storeRef(messages[i].messageCell);
    }
    tail = chunk.endCell();
    end = start;
  }
  return beginCell().storeUint(messages.length, 8).storeMaybeRef(tail);
}

/**
 * Тело запроса без подписи. Одно сообщение уезжает через SendOneMessageRequest —
 * это дешевле по import fee, чем массив из одного элемента.
 */
export function buildSendRequest({ messages, subwalletId, seqno, validUntil, isExternal = true }) {
  const single = messages.length === 1;
  const opcode = single
    ? isExternal
      ? OP.SEND_ONE_E
      : OP.SEND_ONE_I
    : isExternal
      ? OP.SEND_BULK_E
      : OP.SEND_BULK_I;

  const b = beginCell()
    .storeUint(opcode, 32)
    // struct SeqnoHeader { subwalletId, validUntil, seqno }
    .storeUint(subwalletId, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32);

  return single
    ? b.storeUint(messages[0].sendMode, 8).storeRef(messages[0].messageCell).endCell()
    : b.storeBuilder(encodeMessagesArray(messages)).endCell();
}

/**
 * struct KeyRotationProofPayload {
 *     private tag: uint96 = 0x4B45595F524F544154494F4E   // ASCII "KEY_ROTATION"
 *     walletWorkchain: int8
 *     walletAddrHash: uint256
 * }
 *
 * Подписывается НОВЫМ приватным ключом и доказывает, что приватник от нового
 * ключа действительно есть — иначе кошелёк можно было бы намертво запереть.
 * Адрес входит в payload, чтобы доказательство нельзя было переиспользовать
 * на другом кошельке.
 */
export function buildKeyRotationProof(address, newSecretKey) {
  const payload = beginCell()
    .storeUint(KEY_ROTATION_TAG, 96)
    .storeInt(address.workChain, 8)
    .storeBuffer(address.hash, 32)
    .endCell();
  return { payload, signature: sign(payload.hash(), newSecretKey) };
}

/**
 * struct (0xFBBA99C8) ChangePublicKeyRequestE {
 *     header: SeqnoHeader
 *     newPublicKey: uint256
 *     rotationSignature: Cell<bits512>   // реф, а не инлайн
 * }
 */
export function buildChangeKeyRequest({
  newPublicKey,
  rotationSignature,
  subwalletId,
  seqno,
  validUntil,
  isExternal = true,
}) {
  return beginCell()
    .storeUint(isExternal ? OP.CHANGE_KEY_E : OP.CHANGE_KEY_I, 32)
    .storeUint(subwalletId, 32)
    .storeUint(validUntil, 32)
    .storeUint(seqno, 32)
    .storeBuffer(newPublicKey, 32)
    .storeRef(beginCell().storeBuffer(rotationSignature, 64).endCell())
    .endCell();
}

/** struct SignedRequest<T> { signature: bits512, request: T } — подпись впереди. */
export function signRequest(request, secretKey) {
  const signature = sign(request.hash(), secretKey);
  return beginCell().storeBuffer(signature, 64).storeSlice(request.beginParse()).endCell();
}
