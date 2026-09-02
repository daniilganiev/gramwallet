/**
 * Хранилище seed-фразы на устройстве.
 *
 * Фраза шифруется AES-GCM-256, ключ выводится из PIN. В localStorage лежит
 * только шифротекст — ни фраза, ни PIN никуда не уходят.
 *
 * Почему Argon2id, а не PBKDF2.
 *
 * PIN короткий, и вся стойкость держится на том, сколько стоит один перебор.
 * PBKDF2 не требует памяти, поэтому видеокарта считает его тысячами потоков:
 * шесть символов из букв и цифр (36^6 ≈ 2,2 млрд) она перебирает примерно
 * за сутки. Argon2id на каждую попытку занимает 32 МБ, а столько памяти на
 * тысячу параллельных ядер не выдать — перебор замедляется в сотни раз.
 *
 * PBKDF2 остаётся запасным путём: Argon2id живёт в WebAssembly, а в webview
 * с жёстким CSP модуль может не собраться. Тогда шифруем PBKDF2 с удвоенным
 * числом итераций и честно записываем это в самой записи, чтобы расшифровать
 * тем же способом, каким шифровали.
 *
 * Честно о границах: PIN превращает утёкшую копию хранилища в шифротекст,
 * который надо перебирать. От человека, который смотрит через плечо, пока
 * ты вводишь код, он не спасает. Настоящая защита фразы — бумажка.
 *
 * Адрес хранится открытым: он публичен и нужен, чтобы показать экран
 * блокировки осмысленно. После ротации ключа адрес из фразы не выводится,
 * поэтому храним его отдельно и обязательно.
 */

import { argon2id } from "hash-wasm";

const KEY = "gram-wallet:vault:v1";

/** Argon2id: 32 МБ и три прохода — предел, который тянет слабый телефон. */
const ARGON = { memorySize: 32768, iterations: 3, parallelism: 1 };

/** PBKDF2 запасного пути. Вдвое больше рекомендации OWASP: он дешевле в переборе. */
const PBKDF2_ITERATIONS = 1_200_000;

/** Число итераций в записях первой версии — их надо уметь открывать и дальше. */
const PBKDF2_LEGACY_ITERATIONS = 600_000;

const enc = new TextEncoder();
const dec = new TextDecoder();

const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Регистр не учитываем: промахнуться по Caps на телефонной клавиатуре
 * проще, чем забыть сам код, а различие регистра даёт слишком мало.
 */
const normalize = (pin) => String(pin).trim().toLowerCase();

const importAes = (raw) =>
  crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);

async function argonKey(pin, salt, params = ARGON) {
  const raw = await argon2id({
    password: normalize(pin),
    salt,
    ...params,
    hashLength: 32,
    outputType: "binary",
  });
  return importAes(raw);
}

async function pbkdf2Key(pin, salt, iterations) {
  const base = await crypto.subtle.importKey("raw", enc.encode(normalize(pin)), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Ключ для существующей записи — строго тем способом, каким её зашифровали. */
function keyForRecord(v, pin, salt) {
  if (v.kdf === "argon2id") {
    return argonKey(pin, salt, {
      memorySize: v.m ?? ARGON.memorySize,
      iterations: v.t ?? ARGON.iterations,
      parallelism: v.p ?? ARGON.parallelism,
    });
  }
  return pbkdf2Key(pin, salt, v.it ?? PBKDF2_LEGACY_ITERATIONS);
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Есть ли на устройстве сохранённый кошелёк. */
export function hasWallet() {
  const v = read();
  return Boolean(v?.ct && v?.salt && v?.iv);
}

/** Публичные данные, доступные без PIN. */
export function getMeta() {
  const v = read();
  if (!v) return null;
  return { address: v.address ?? null, network: v.network ?? "mainnet", createdAt: v.createdAt ?? null };
}

/** Шифрует фразу PIN-ом и кладёт в localStorage. */
export async function saveWallet({ mnemonic, address, network = "mainnet" }, pin) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Argon2id — основной путь. Если WebAssembly недоступен, отступаем
  // на PBKDF2 и записываем это, иначе расшифровать будет нечем.
  let key;
  let kdf;
  try {
    key = await argonKey(pin, salt);
    kdf = { kdf: "argon2id", m: ARGON.memorySize, t: ARGON.iterations, p: ARGON.parallelism };
  } catch {
    key = await pbkdf2Key(pin, salt, PBKDF2_ITERATIONS);
    kdf = { kdf: "pbkdf2", it: PBKDF2_ITERATIONS };
  }

  const phrase = Array.isArray(mnemonic) ? mnemonic.join(" ") : String(mnemonic);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(phrase));

  localStorage.setItem(
    KEY,
    JSON.stringify({
      v: 2,
      ...kdf,
      salt: toB64(salt),
      iv: toB64(iv),
      ct: toB64(ct),
      address: typeof address === "string" ? address : address.toString({ bounceable: true }),
      network,
      createdAt: Date.now(),
    }),
  );
}

/**
 * Расшифровывает фразу. Неверный PIN даёт исключение в AES-GCM (проверка тега),
 * так что отдельного «пароля для сверки» не нужно.
 */
export async function unlock(pin) {
  const v = read();
  if (!v) throw new Error("На этом устройстве нет сохранённого кошелька.");

  let phrase;
  try {
    const key = await keyForRecord(v, pin, fromB64(v.salt));
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(v.iv) }, key, fromB64(v.ct));
    phrase = dec.decode(pt);
  } catch {
    throw new Error("Неверный PIN.");
  }

  const result = { mnemonic: phrase.split(/\s+/), address: v.address, network: v.network ?? "mainnet" };

  // Кошелёк, сохранённый до перехода на Argon2id, перешифровываем на месте:
  // PIN в руках, фраза расшифрована, второго удобного случая не будет.
  if (v.kdf !== "argon2id") {
    try {
      await saveWallet(result, pin);
    } catch {
      // Не вышло — не беда: запись осталась прежней и по-прежнему читается.
    }
  }

  return result;
}

/** После ротации ключа фраза меняется, адрес — нет. */
export async function replaceMnemonic(newMnemonic, pin) {
  const meta = getMeta();
  if (!meta) throw new Error("Нет сохранённого кошелька.");
  await saveWallet({ mnemonic: newMnemonic, address: meta.address, network: meta.network }, pin);
}

/** Удаляет кошелёк с устройства. Без сохранённой фразы это необратимо. */
export function wipe() {
  localStorage.removeItem(KEY);
}

/** Проверка, что WebCrypto доступен: без него приложение работать не должно. */
export function isCryptoAvailable() {
  return typeof crypto !== "undefined" && Boolean(crypto.subtle) && typeof localStorage !== "undefined";
}
