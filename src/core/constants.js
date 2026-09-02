/**
 * Константы контракта WalletTg.
 * Источник: https://github.com/ton-blockchain/tg-wallet-contract
 */

/** Исходники контракта: на них ссылается экран с предупреждениями. */
export const REPO_URL = "https://github.com/ton-blockchain/tg-wallet-contract";

/** Исходники самого приложения. */
export const APP_REPO_URL = "https://github.com/daniilganiev/gramwallet";

/** Обозначение монеты. Toncoin переименован в Gram 15.06.2026; сеть по-прежнему TON. */
export const COIN = "GRAM";

/** contracts/WalletTrampoline.boc — байт-в-байт из репозитория, меняться не будет. */
export const TRAMPOLINE_BOC = "te6cckEBAQEAGgAAMP8AIJgh10mDCLnyQN+Ahfgz0O0eIO1T2WlCfjk=";

/** Дефолты из contracts/WalletTg/storage.tolk. */
export const SUBWALLET_ID = { mainnet: 0x7fff7f11, testnet: 0x7fff7ffd };

/** Запасной провайдер на случай, если ton-access залип на кривой ноде. */
export const PUBLIC_ENDPOINT = {
  mainnet: "https://toncenter.com/api/v2/jsonRPC",
  testnet: "https://testnet.toncenter.com/api/v2/jsonRPC",
};

/**
 * Опкоды из contracts/WalletTg/messages.tolk.
 * Internal и external разведены намеренно: подписанный для газлесса internal
 * не должен приниматься как external, иначе релеер сольёт баланс на комиссиях.
 */
export const OP = {
  SEND_ONE_I: 0x63896e74,
  SEND_ONE_E: 0x63896e75,
  SEND_BULK_I: 0x73896e74,
  SEND_BULK_E: 0x73896e75,
  CHANGE_KEY_I: 0xfbba99c7,
  CHANGE_KEY_E: 0xfbba99c8,
};

export const SEND_MODE = {
  PAY_FEES_SEPARATELY: 1,
  IGNORE_ERRORS: 2,
  DESTROY_IF_ZERO: 32,
  CARRY_REMAINING_VALUE: 64,
  CARRY_ALL_BALANCE: 128,
};

/** External-путь контракта требует IGNORE_ERRORS, иначе exit 137. */
export const DEFAULT_SEND_MODE = SEND_MODE.PAY_FEES_SEPARATELY | SEND_MODE.IGNORE_ERRORS;

/** contracts/WalletTg/errors.tolk. */
export const ERRORS = {
  7: "Байткод WalletTg не найден в config[-123]",
  133: "seqno не совпал со storage",
  134: "Не тот subwallet id для этой сети",
  135: "Подпись не сошлась с ключом в контракте",
  136: "Срок действия запроса истёк",
  137: "В sendMode нет флага IGNORE_ERRORS",
  147: "Пустой массив или длина не совпала с числом сообщений",
  148: "Новый ключ совпадает с текущим",
  149: "Доказательство подписано не тем ключом",
  65535: "Контракт не знает такой опкод",
};

/** Ограничение из parseArrayAndSend: len — uint8, пустой массив запрещён. */
export const MAX_MESSAGES = 255;

/** Тег доказательства смены ключа: ASCII "KEY_ROTATION", ровно 12 байт = uint96. */
export const KEY_ROTATION_TAG = BigInt("0x4B45595F524F544154494F4E");

export const DEFAULT_TTL_SECONDS = 180;

/** Сколько приложить к деплою: сам деплой платится с кошелька. */
export const MIN_DEPLOY_BALANCE = "0.02";
export const DEPLOY_PING_VALUE = "0.001";
