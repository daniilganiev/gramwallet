// Проверка полного пути создания кошелька вне браузера.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const BASE = "../src";

const { mnemonicNew, mnemonicToPrivateKey } = await import("@ton/crypto");
const { walletTgAddress } = await import(`${BASE}/core/detect.js`);
const vault = await import(`${BASE}/crypto/vault.js`);

let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "  ok   " : "  FAIL "}${name}${detail ? "  " + detail : ""}`);
  if (!ok) failed++;
};

console.log("\nОкружение");
check("crypto.subtle доступен", Boolean(globalThis.crypto?.subtle));
check("isCryptoAvailable()", vault.isCryptoAvailable());
check("btoa/atob есть", typeof btoa === "function" && typeof atob === "function");

console.log("\nГенерация");
const t0 = Date.now();
const mnemonic = await mnemonicNew(24);
check("mnemonicNew(24)", mnemonic.length === 24, `${Date.now() - t0} мс`);

const keyPair = await mnemonicToPrivateKey(mnemonic);
check("mnemonicToPrivateKey", keyPair.publicKey.length === 32);

const address = walletTgAddress(keyPair.publicKey, "mainnet");
check("walletTgAddress", address.toString().startsWith("EQ") || address.toString().length > 40, address.toString({ bounceable: true }));

console.log("\nХранилище");
check("hasWallet() пусто в начале", vault.hasWallet() === false);

const t1 = Date.now();
await vault.saveWallet({ mnemonic, address, network: "mainnet" }, "1234");
check("saveWallet", vault.hasWallet() === true, `${Date.now() - t1} мс`);

const meta = vault.getMeta();
check("getMeta().address", meta.address === address.toString({ bounceable: true }));

const opened = await vault.unlock("1234");
check("unlock верным PIN", opened.mnemonic.join(" ") === mnemonic.join(" "));
check("unlock вернул адрес", opened.address === meta.address);

try {
  await vault.unlock("9999");
  check("unlock неверным PIN отклонён", false);
} catch (e) {
  check("unlock неверным PIN отклонён", e.message === "Неверный PIN.", e.message);
}

const newMnemonic = await mnemonicNew(24);
await vault.replaceMnemonic(newMnemonic, "1234");
const after = await vault.unlock("1234");
check("replaceMnemonic сменил фразу", after.mnemonic.join(" ") === newMnemonic.join(" "));
check("адрес после ротации не изменился", after.address === meta.address);

vault.wipe();
check("wipe", vault.hasWallet() === false);

console.log(failed === 0 ? "\nВСЁ ЗЕЛЁНОЕ\n" : `\nПРОВАЛОВ: ${failed}\n`);
process.exit(failed === 0 ? 0 : 1);
