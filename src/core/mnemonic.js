/**
 * Две схемы превращения seed-фразы в ключ.
 *
 * Наш клиент выдаёт родную TON-мнемонику: 24 слова, ключ из PBKDF2 по
 * самой фразе. Кошелёк в Telegram выдаёт обычный BIP39 и выводит ключ
 * по SLIP-10 на пути m/44'/607'/0' — проверено на живом кошельке: адрес
 * WalletTg совпал байт в байт. Словарь у обеих схем один, поэтому по
 * словам схему не отличить, только по контрольной сумме и по адресу.
 */

import {
  deriveEd25519Path,
  keyPairFromSeed,
  mnemonicToPrivateKey,
  mnemonicValidate,
  mnemonicWordList,
  pbkdf2_sha512,
  sha256,
} from "@ton/crypto";

export const SCHEME = { TON: "ton", BIP39: "bip39" };

// 607' — номер TON в SLIP-44.
const BIP39_PATH = [44, 607, 0];

const WORD_INDEX = new Map(mnemonicWordList.map((w, i) => [w, i]));

/** Контрольная сумма BIP39: последние биты фразы — начало sha256 от энтропии. */
export async function isBip39(words) {
  if (![12, 15, 18, 21, 24].includes(words.length)) return false;
  let bits = "";
  for (const w of words) {
    const i = WORD_INDEX.get(w);
    if (i === undefined) return false;
    bits += i.toString(2).padStart(11, "0");
  }
  const checksumBits = words.length / 3;
  const entropyBits = bits.slice(0, bits.length - checksumBits);
  const entropy = Buffer.from(entropyBits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const hash = await sha256(entropy);
  const expected = [...hash]
    .map((b) => b.toString(2).padStart(8, "0"))
    .join("")
    .slice(0, checksumBits);
  return bits.slice(-checksumBits) === expected;
}

/** Какими схемами фраза вообще читается. Бывает и обе сразу. */
export async function schemesOf(words) {
  const found = [];
  if (await mnemonicValidate(words)) found.push(SCHEME.TON);
  if (await isBip39(words)) found.push(SCHEME.BIP39);
  return found;
}

export async function keyPairFor(words, scheme = SCHEME.TON) {
  if (scheme === SCHEME.BIP39) {
    const seed = await pbkdf2_sha512(words.join(" ").normalize("NFKD"), "mnemonic", 2048, 64);
    return keyPairFromSeed(await deriveEd25519Path(seed, BIP39_PATH));
  }
  return mnemonicToPrivateKey(words);
}
