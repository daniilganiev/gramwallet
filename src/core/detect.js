/**
 * Распознавание чужих сид-фраз.
 *
 * Главный риск при импорте: человек вводит фразу от Tonkeeper или другого
 * кошелька, видит пустой WalletTg-адрес и решает, что деньги пропали.
 * Поэтому мы не просто отказываем, а называем тип кошелька и его адрес.
 *
 * Фраза при этом никуда не уходит: проверяются только адреса, а они публичны,
 * и запросы идут с устройства пользователя напрямую к ноде.
 */

import {
  WalletContractV3R1,
  WalletContractV3R2,
  WalletContractV4,
  WalletContractV5R1,
} from "@ton/ton";
import { Address, Cell, contractAddress } from "@ton/core";

import { SUBWALLET_ID, TRAMPOLINE_BOC } from "./constants.js";
import { buildStorage } from "./serialize.js";

const KNOWN_WALLETS = [
  { label: "Wallet v5 R1", make: (publicKey) => WalletContractV5R1.create({ workchain: 0, publicKey }) },
  { label: "Wallet v4 R2", make: (publicKey) => WalletContractV4.create({ workchain: 0, publicKey }) },
  { label: "Wallet v3 R2", make: (publicKey) => WalletContractV3R2.create({ workchain: 0, publicKey }) },
  { label: "Wallet v3 R1", make: (publicKey) => WalletContractV3R1.create({ workchain: 0, publicKey }) },
];

/** Адрес WalletTg для данного публичного ключа (до всякой ротации). */
export function walletTgAddress(publicKey, network = "mainnet") {
  return contractAddress(0, {
    code: Cell.fromBase64(TRAMPOLINE_BOC),
    data: buildStorage(publicKey, SUBWALLET_ID[network]),
  });
}

/**
 * Состояние адреса с подтверждением.
 *
 * Публичные ноды периодически отдают живой контракт как uninitialized
 * с нулевым балансом — поймано на мейннете: два запроса подряд «active»,
 * третий «uninitialized». Ошибиться здесь дорого: импорт отказал бы
 * человеку в его собственном кошельке. Поэтому «пусто» принимаем, только
 * если это подтвердили несколько разных нод, а «active» — сразу.
 */
async function stateOf(providers, address, { confirmations = 3 } = {}) {
  let last = null;
  for (let i = 0; i < confirmations; i++) {
    try {
      last = await providers.call((c) => c.getContractState(address));
      if (last.state === "active") return last;
    } catch {
      last = last ?? null;
    }
    if (i < confirmations - 1) await providers.connect({ next: true }).catch(() => {});
  }
  return last;
}

/**
 * Что за кошелёк стоит за этой фразой.
 *
 * Возвращает:
 *   { kind: "wallettg", address, balance }   — наш, можно импортировать
 *   { kind: "rotated",  address, balance }   — наш, но ключ уже сменили
 *   { kind: "foreign",  address, label }     — чужой тип, отказываем
 *   { kind: "empty",    address }            — нигде ничего не найдено
 */
export async function detectWallet(publicKey, providers, network = "mainnet") {
  const ours = walletTgAddress(publicKey, network);

  const ourState = await stateOf(providers, ours);
  if (ourState?.state === "active") {
    /*
     * Адрес выводится из ПЕРВОГО ключа и после ротации не меняется. Значит
     * старая фраза по-прежнему приводит к живому кошельку — но подписать им
     * уже нечего: в контракте другой ключ. Импортировать такую фразу нельзя,
     * иначе человек увидит свой баланс и не сможет ничего отправить.
     */
    const onchain = await publicKeyAt(providers, ours);
    if (onchain && onchain !== publicKey.toString("hex")) {
      return { kind: "rotated", address: ours, balance: ourState.balance };
    }
    return { kind: "wallettg", address: ours, balance: ourState.balance };
  }

  for (const { label, make } of KNOWN_WALLETS) {
    const address = make(publicKey).address;
    const state = await stateOf(providers, address, { confirmations: 1 });
    if (state?.state === "active") {
      return { kind: "foreign", address, label, balance: state.balance };
    }
  }

  return { kind: "empty", address: ours };
}

/** Публичный ключ, который реально лежит в контракте. */
async function publicKeyAt(providers, address) {
  try {
    const { stack } = await providers.call((c) => c.runMethod(address, "get_public_key"));
    return stack.readBigNumber().toString(16).padStart(64, "0");
  } catch {
    return null;
  }
}

/**
 * Проверка импорта по указанному адресу — единственный корректный путь для
 * кошелька с ротированным ключом: сверяем ключ из фразы с тем, что реально
 * лежит в контракте.
 */
export async function verifyByAddress(addressLike, publicKey, providers) {
  let address;
  try {
    address = typeof addressLike === "string" ? Address.parse(addressLike) : addressLike;
  } catch {
    return { ok: false, reason: "Адрес не похож на адрес TON." };
  }

  const state = await stateOf(providers, address);
  if (state?.state !== "active") {
    return { ok: false, reason: "По этому адресу нет задеплоенного кошелька.", address };
  }

  const onchain = await publicKeyAt(providers, address);
  if (!onchain) {
    return {
      ok: false,
      reason: "По этому адресу стоит не WalletTg — у него нет метода get_public_key.",
      address,
    };
  }

  if (onchain !== publicKey.toString("hex")) {
    return { ok: false, reason: "Фраза не подходит к этому адресу.", address };
  }

  return { ok: true, address };
}
