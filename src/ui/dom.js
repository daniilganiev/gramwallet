/** Минимальные хелперы вместо фреймворка: экранов мало, стейт простой. */

import { fromNano } from "@ton/core";
import { COIN } from "../core/constants.js";

/**
 * el("div.glass", { onclick }, [child, "текст"])
 * Тег вида "button.btn.btn--primary" разворачивается в классы.
 */
export function el(spec, props = {}, children = []) {
  const [tag, ...classes] = spec.split(".");
  const node = document.createElement(tag || "div");
  if (classes.length) node.className = classes.join(" ");

  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") node.className = [node.className, v].filter(Boolean).join(" ");
    else if (k === "html") node.innerHTML = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k in node && k !== "list") node[k] = v;
    else node.setAttribute(k, v);
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
};

/** Красивая сумма: без хвостовых нулей, но и без потери точности. */
export function fmtCoins(nano, { withCoin = true } = {}) {
  const raw = fromNano(nano ?? 0n);
  const trimmed = raw.includes(".") ? raw.replace(/0+$/, "").replace(/\.$/, "") : raw;
  return withCoin ? `${trimmed} ${COIN}` : trimmed;
}

export function shortAddress(address, head = 6, tail = 6) {
  const s = typeof address === "string" ? address : address.toString({ bounceable: true });
  return s.length > head + tail + 3 ? `${s.slice(0, head)}…${s.slice(-tail)}` : s;
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // В некоторых webview clipboard API закрыт — падаем на старый способ.
    try {
      const ta = el("textarea", { value: text, style: "position:fixed;opacity:0" });
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}
