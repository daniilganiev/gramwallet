/**
 * Тела сообщений для перевода токенов и NFT.
 *
 * Сам кошелёк умеет одно — отправить internal-сообщение по адресу. Токен
 * переводится не «на адрес получателя», а командой его собственному
 * контракту: у каждого владельца свой кошелёк токена, и распоряжается им
 * только он. То же с NFT: команда идёт самому предмету.
 *
 * К такому сообщению прикладывается немного GRAM — на газ и на пересылку
 * дальше по цепочке. Остаток возвращается отправителю.
 */

import { Address, beginCell, toNano } from "@ton/core";

/** op-коды из стандартов TEP-74 (жетоны) и TEP-62 (NFT). */
const OP_JETTON_TRANSFER = 0x0f8a7ea5;
const OP_NFT_TRANSFER = 0x5fcc3d14;

/**
 * Сколько GRAM прикладываем к команде.
 *
 * Это не комиссия сети, а рабочие деньги для цепочки контрактов: часть
 * уходит на газ, часть пересылается получателю уведомлением, остальное
 * возвращается. Значения — общепринятые для этих стандартов.
 */
export const JETTON_ATTACH = "0.05";
export const NFT_ATTACH = "0.05";

/** Уведомление получателю: 1 нанограмм, чтобы его кошелёк увидел приход. */
const FORWARD_AMOUNT = 1n;

const addr = (a) => (typeof a === "string" ? Address.parse(a) : a);

/** Комментарий в том же виде, в каком его читают обозреватели. */
const commentCell = (text) =>
  text ? beginCell().storeUint(0, 32).storeStringTail(text).endCell() : null;

export function jettonTransferBody({ amount, to, responseTo, comment = null, queryId = 0n }) {
  const forward = commentCell(comment);
  const body = beginCell()
    .storeUint(OP_JETTON_TRANSFER, 32)
    .storeUint(queryId, 64)
    .storeCoins(amount)
    .storeAddress(addr(to))
    .storeAddress(addr(responseTo))
    .storeBit(0) // custom_payload
    .storeCoins(forward ? toNano("0.02") : FORWARD_AMOUNT);

  // Комментарий едет отдельной ячейкой: в тело он может не поместиться.
  if (forward) body.storeBit(1).storeRef(forward);
  else body.storeBit(0);

  return body.endCell();
}

export function nftTransferBody({ to, responseTo, comment = null, queryId = 0n }) {
  const forward = commentCell(comment);
  const body = beginCell()
    .storeUint(OP_NFT_TRANSFER, 32)
    .storeUint(queryId, 64)
    .storeAddress(addr(to))
    .storeAddress(addr(responseTo))
    .storeBit(0) // custom_payload
    .storeCoins(forward ? toNano("0.02") : FORWARD_AMOUNT);

  if (forward) body.storeBit(1).storeRef(forward);
  else body.storeBit(0);

  return body.endCell();
}
