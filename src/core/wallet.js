/**
 * Кошелёк WalletTg для браузера. Ни одной node-зависимости:
 * ни файлов, ни переменных окружения — только ключи и сеть.
 */

import { Address, Cell, beginCell, contractAddress, external, storeMessage } from "@ton/core";
import { mnemonicToPrivateKey, signVerify } from "@ton/crypto";

import {
  DEFAULT_TTL_SECONDS,
  DEPLOY_PING_VALUE,
  SEND_MODE,
  SUBWALLET_ID,
  TRAMPOLINE_BOC,
} from "./constants.js";
import { Providers, explainError, sleep } from "./client.js";
import {
  buildChangeKeyRequest,
  buildKeyRotationProof,
  buildSendRequest,
  buildStorage,
  signRequest,
  toMessageToSend,
} from "./serialize.js";

export class TgWallet {
  constructor({ keyPair, network = "mainnet", subwalletId, workchain = 0, address = null }) {
    this.keyPair = keyPair;
    this.network = network;
    this.workchain = workchain;
    this.subwalletId = subwalletId ?? SUBWALLET_ID[network];
    if (this.subwalletId === undefined) {
      throw new Error(`Неизвестная сеть "${network}".`);
    }

    this.init = {
      code: Cell.fromBase64(TRAMPOLINE_BOC),
      data: buildStorage(keyPair.publicKey, this.subwalletId),
    };

    // Адрес в TON — это хеш начального stateInit, куда входит ПЕРВЫЙ публичный
    // ключ. Смена storage.publicKey адрес не меняет, но и вывести его из нового
    // ключа уже нельзя: получится другой, никогда не существовавший аккаунт.
    // Поэтому ротированный кошелёк обязан хранить свой адрес явно.
    this.derivedAddress = contractAddress(workchain, this.init);
    this.address = address
      ? typeof address === "string"
        ? Address.parse(address)
        : address
      : this.derivedAddress;

    /** Деплой возможен, только если адрес всё ещё выводится из текущего ключа. */
    this.canDeploy = this.address.equals(this.derivedAddress);

    this.providers = new Providers(network);
  }

  static async fromMnemonic(mnemonic, { network = "mainnet", address = null } = {}) {
    const words = Array.isArray(mnemonic) ? mnemonic : String(mnemonic).trim().split(/\s+/);
    const keyPair = await mnemonicToPrivateKey(words);
    return new TgWallet({ keyPair, network, address });
  }

  get publicKeyHex() {
    return this.keyPair.publicKey.toString("hex");
  }

  /**
   * Состояние аккаунта одним запросом.
   *
   * Публичные ноды периодически отдают уже задеплоенный аккаунт как
   * uninitialized с нулевым балансом. Ошибиться в эту сторону дорого:
   * send() прицепил бы stateInit и взял seqno 0. Поэтому «не задеплоен»
   * принимаем, только если это подтвердили несколько разных нод.
   */
  async getState({ confirmations = 3 } = {}) {
    let last;
    for (let i = 0; i < confirmations; i++) {
      last = await this.providers.call((c) => c.getContractState(this.address));
      if (last.state === "active") return last;
      if (i < confirmations - 1) await this.providers.connect({ next: true });
    }
    return last;
  }

  async isDeployed() {
    return (await this.getState()).state === "active";
  }

  async getBalance() {
    return (await this.getState()).balance;
  }

  async runGetter(name) {
    const { stack } = await this.providers.call((c) => c.runMethod(this.address, name));
    return stack;
  }

  /** Ещё не задеплоенный кошелёк логично считать нулевым, а не падать. */
  async getSeqno() {
    try {
      return (await this.runGetter("seqno")).readNumber();
    } catch {
      if (!(await this.isDeployed())) return 0;
      return (await this.runGetter("seqno")).readNumber();
    }
  }

  async getRevision() {
    return (await this.runGetter("revision")).readNumber();
  }

  async getSubwalletId() {
    return (await this.runGetter("get_subwallet_id")).readNumber();
  }

  async getPublicKey() {
    return (await this.runGetter("get_public_key")).readBigNumber();
  }

  /** Ждёт, пока seqno доедет до target. Единственный честный признак «прошло». */
  async waitForSeqno(target, { timeoutMs = 90000, pollMs = 3000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await sleep(pollMs);
      try {
        if ((await this.getSeqno()) >= target) return true;
      } catch {
        // нода моргнула — пробуем ещё
      }
    }
    return false;
  }

  async #sendBoc(boc) {
    try {
      await this.providers.call((c) => c.sendFile(boc));
    } catch (e) {
      throw new Error(explainError(e));
    }
  }

  /**
   * Подписывает и отправляет external-запрос на 1..255 сообщений.
   * seqno читается из контракта, руками его подставлять не надо.
   */
  async send(items, { deploy = false, ttl = DEFAULT_TTL_SECONDS, wait = true, timeoutMs = 90000 } = {}) {
    const messages = (Array.isArray(items) ? items : [items]).map(toMessageToSend);
    if (messages.length === 0) throw new Error("Нечего отправлять.");

    for (const [i, m] of messages.entries()) {
      if ((m.sendMode & SEND_MODE.IGNORE_ERRORS) === 0) {
        throw new Error(`Сообщение №${i + 1}: без флага IGNORE_ERRORS контракт откинет запрос.`);
      }
    }

    const deployed = await this.isDeployed();
    if (!deployed && !deploy) throw new Error("Кошелёк ещё не задеплоен.");
    if (!deployed && !this.canDeploy) {
      throw new Error("Адрес не выводится из текущего ключа — ключ был ротирован, деплой невозможен.");
    }

    const seqno = deployed ? await this.getSeqno() : 0;
    const request = buildSendRequest({
      messages,
      subwalletId: this.subwalletId,
      seqno,
      validUntil: Math.floor(Date.now() / 1000) + ttl,
      isExternal: true,
    });

    const ext = external({
      to: this.address,
      init: deployed ? null : this.init,
      body: signRequest(request, this.keyPair.secretKey),
    });
    await this.#sendBoc(beginCell().store(storeMessage(ext)).endCell().toBoc());

    if (!wait) return { seqno, confirmed: false, delivered: null };

    const confirmed = await this.waitForSeqno(seqno + 1, { timeoutMs });
    if (!confirmed) return { seqno, confirmed: false, delivered: null };
    return { seqno, confirmed: true, delivered: await this.#delivered(messages.length) };
  }

  /**
   * Ушли ли сообщения на самом деле.
   *
   * Рост seqno доказывает только то, что контракт принял запрос и подпись
   * верна. Слать сообщения он обязан с флагом IGNORE_ERRORS, а тот означает
   * буквально следующее: если денег на сумму вместе с комиссией не хватило,
   * действие молча пропускается. Транзакция при этом успешна, seqno растёт,
   * перевода нет — и мы говорили «Отправлено».
   *
   * Возвращает null, если проверить не удалось: врать в другую сторону тоже
   * нельзя.
   */
  async #delivered(expected) {
    try {
      const txs = await this.providers.call((c) => c.getTransactions(this.address, { limit: 2 }));
      const tx = txs.find((t) => t.inMessage?.info?.type === "external-in");
      const action = tx?.description?.type === "generic" ? tx.description.actionPhase : null;
      if (!action) return null;
      if (Number(action.skippedActions ?? 0) > 0) return false;
      return Number(action.messagesCreated ?? 0) >= expected;
    } catch {
      return null;
    }
  }

  /**
   * Сколько сеть возьмёт за этот запрос.
   *
   * Считает нода: собираем ровно то сообщение, которое отправим, и просим
   * оценить. Показывать цифру до подписи важнее, чем экономить запрос —
   * человек должен знать цену до того, как нажмёт «Отправить», а не после.
   *
   * Возвращает наногромы. Ошибку не глотаем молча: пусть экран решает,
   * показывать «не удалось оценить» или запрещать отправку.
   */
  async estimateFee(items, { deploy = false, ttl = DEFAULT_TTL_SECONDS } = {}) {
    const messages = (Array.isArray(items) ? items : [items]).map(toMessageToSend);
    const deployed = await this.isDeployed();
    const seqno = deployed ? await this.getSeqno() : 0;

    const request = buildSendRequest({
      messages,
      subwalletId: this.subwalletId,
      seqno,
      validUntil: Math.floor(Date.now() / 1000) + ttl,
      isExternal: true,
    });

    const body = signRequest(request, this.keyPair.secretKey);
    const init = deployed ? null : this.init;

    const res = await this.providers.call((c) =>
      c.estimateExternalMessageFee(this.address, {
        body,
        initCode: init?.code ?? null,
        initData: init?.data ?? null,
        ignoreSignature: false,
      }),
    );

    const f = res.source_fees ?? {};
    return BigInt(
      Math.ceil((f.in_fwd_fee ?? 0) + (f.storage_fee ?? 0) + (f.gas_fee ?? 0) + (f.fwd_fee ?? 0)),
    );
  }

  /** Деплой — обычный подписанный запрос с приложенным stateInit. */
  async deploy(options = {}) {
    return this.send(
      { to: this.address, amount: DEPLOY_PING_VALUE, comment: "deploy" },
      { deploy: true, ...options },
    );
  }

  /**
   * Меняет публичный ключ. Адрес при этом НЕ меняется.
   *
   * Запрос подписывается двумя ключами: текущим — сам запрос, новым —
   * доказательство. Повторять можно сколько угодно раз: контракт сверяет
   * новый ключ только с текущим.
   *
   * После успеха кошельком управляет только новый ключ, отката нет.
   */
  async changePublicKey(newKeyPair, { ttl = DEFAULT_TTL_SECONDS, timeoutMs = 90000 } = {}) {
    if (newKeyPair.publicKey.equals(this.keyPair.publicKey)) {
      throw new Error("Новый ключ совпадает с текущим.");
    }
    if (!(await this.isDeployed())) throw new Error("Кошелёк не задеплоен.");

    const seqno = await this.getSeqno();
    const proof = buildKeyRotationProof(this.address, newKeyPair.secretKey);

    // Проверяем доказательство ровно так же, как это сделает контракт: если тут
    // не сойдётся, не сойдётся и на цепочке, только уже за наши деньги.
    if (!signVerify(proof.payload.hash(), proof.signature, newKeyPair.publicKey)) {
      throw new Error("Доказательство не проходит локальную проверку.");
    }

    const request = buildChangeKeyRequest({
      newPublicKey: newKeyPair.publicKey,
      rotationSignature: proof.signature,
      subwalletId: this.subwalletId,
      seqno,
      validUntil: Math.floor(Date.now() / 1000) + ttl,
      isExternal: true,
    });

    const ext = external({
      to: this.address,
      body: signRequest(request, this.keyPair.secretKey),
    });
    await this.#sendBoc(beginCell().store(storeMessage(ext)).endCell().toBoc());

    const confirmed = await this.waitForSeqno(seqno + 1, { timeoutMs });
    if (!confirmed) return { seqno, confirmed: false, keyChanged: false };

    // seqno растёт при любом принятом запросе, так что ключ проверяем отдельно.
    const onchain = (await this.getPublicKey()).toString(16).padStart(64, "0");
    const keyChanged = onchain === newKeyPair.publicKey.toString("hex");
    if (keyChanged) this.keyPair = newKeyPair;
    return { seqno, confirmed: true, keyChanged, onchainPublicKey: onchain };
  }
}
