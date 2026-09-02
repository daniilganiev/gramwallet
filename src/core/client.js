/**
 * Работа с публичными нодами TON.
 *
 * Здесь собрана вся боль, вылезшая при обкатке CLI на мейннете:
 * ноды отвечают 429, иногда падают с out of gas на нормальном гет-методе,
 * а иногда отдают живой аккаунт как uninitialized с нулевым балансом.
 */

import { TonClient } from "@ton/ton";
import { getHttpEndpoint } from "@orbs-network/ton-access";

import { ERRORS, PUBLIC_ENDPOINT } from "./constants.js";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function isRetriable(e) {
  // Toncenter в бесключевом режиме держит 1 RPS, так что 429 — норма жизни.
  const status = e?.response?.status;
  if (status === 429 || (status >= 500 && status < 600)) return true;
  if (["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"].includes(e?.code)) return true;
  if (e?.name === "TypeError" && /fetch|network/i.test(String(e.message))) return true;
  // Часть публичных нод отдаёт -13/-14 (out of gas) на совершенно нормальный
  // get-метод. Это про ноду, а не про контракт, и лечится сменой эндпоинта.
  return /exit_code:\s*-1[34]\b/.test(String(e?.message ?? ""));
}

export async function withRetry(fn, { attempts = 5, baseDelayMs = 1200, onRetry = null } = {}) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetriable(e) || i === attempts - 1) throw e;
      if (onRetry) await onRetry(e, i);
      await sleep(baseDelayMs * (i + 1));
    }
  }
  throw lastError;
}

/** Вытаскивает exit code из текста ошибки ноды и переводит на человеческий. */
export function explainError(e) {
  const raw = e?.response?.data?.error ?? e?.response?.data ?? e?.message ?? String(e);
  const text = typeof raw === "string" ? raw : JSON.stringify(raw);
  const match = text.match(/exit[_ ]?code[=: ]+(-?\d+)/i);
  if (match) {
    const code = Number(match[1]);
    if (ERRORS[code]) return ERRORS[code];
  }
  if (/429|rate ?limit/i.test(text)) return "Публичная нода ограничивает частоту запросов. Попробуй ещё раз.";
  if (/network|fetch|timeout/i.test(text)) return "Нет связи с сетью TON. Проверь интернет.";
  return text;
}

/**
 * Пул провайдеров. Ton-access залипает на одной ноде надолго, поэтому вторым
 * держим toncenter напрямую: смена эндпоинта должна реально менять источник,
 * иначе повторная проверка спросит ту же самую кривую ноду.
 */
export class Providers {
  constructor(network = "mainnet") {
    this.network = network;
    this.index = 0;
    this.factories = [
      () => getHttpEndpoint({ network }),
      async () => PUBLIC_ENDPOINT[network],
    ];
    this.endpoint = null;
    this.client = null;
  }

  async connect({ next = false } = {}) {
    if (next) this.index = (this.index + 1) % this.factories.length;
    this.endpoint = await this.factories[this.index]();
    this.client = new TonClient({ endpoint: this.endpoint });
    return this.client;
  }

  /** Любой запрос к ноде: с ретраями и переездом на другого провайдера. */
  async call(fn) {
    if (!this.client) await this.connect();
    return withRetry(() => fn(this.client), {
      onRetry: () => this.connect({ next: true }),
    });
  }
}
