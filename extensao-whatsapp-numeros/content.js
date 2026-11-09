// Content script executado dentro do WhatsApp Web.
// Lê o DOM da página (não usa APIs internas do WhatsApp) e devolve os números encontrados.

(() => {
  // Números no formato internacional exibidos na tela: "+55 11 91234-5678"
  const PHONE_TEXT_RE = /\+\d{1,3}[\s\d().-]{6,20}\d/g;
  // IDs internos das mensagens: "..._5511912345678@c.us"
  const JID_RE = /(\d{10,15})@c\.us/g;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function normalize(raw) {
    const digits = String(raw).replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 15 ? digits : null;
  }

  function addFromText(text, set) {
    if (!text) return;
    for (const m of text.matchAll(PHONE_TEXT_RE)) {
      const n = normalize(m[0]);
      if (n) set.add(n);
    }
  }

  function getGroupName() {
    const header = document.querySelector("#main header");
    if (!header) return null;
    const span =
      header.querySelector('span[dir="auto"][title]') ||
      header.querySelector('span[dir="auto"]');
    return span ? (span.getAttribute("title") || span.textContent || "").trim() : null;
  }

  // 1) Subtítulo do cabeçalho do grupo (lista "Fulano, +55 11 ..., Você")
  function fromHeader(set) {
    const header = document.querySelector("#main header");
    if (!header) return;
    header.querySelectorAll("span[title]").forEach((el) => addFromText(el.getAttribute("title"), set));
    addFromText(header.innerText, set);
  }

  // 2) Remetentes das mensagens carregadas na conversa (atributo data-id)
  function fromMessages(set) {
    document.querySelectorAll("#main [data-id]").forEach((el) => {
      const id = el.getAttribute("data-id") || "";
      for (const m of id.matchAll(JID_RE)) {
        const n = normalize(m[1]);
        if (n) set.add(n);
      }
    });
  }

  // 3) Painel "Dados do grupo" / modal "Ver todos os participantes"
  function getParticipantsRoot() {
    const dialog = document.querySelector('[role="dialog"]');
    if (dialog) return dialog;
    // Painel lateral direito aberto ao clicar no cabeçalho do grupo
    const main = document.querySelector("#main");
    const candidates = [...document.querySelectorAll("#app div")].filter((d) => {
      if (main && (main.contains(d) || d.contains(main))) return false;
      const r = d.getBoundingClientRect();
      return r.left > window.innerWidth * 0.5 && r.height > window.innerHeight * 0.6;
    });
    return candidates[0] || null;
  }

  function findScrollable(root) {
    const all = [root, ...root.querySelectorAll("div")];
    let best = null;
    for (const el of all) {
      const st = getComputedStyle(el);
      if (
        /(auto|scroll)/.test(st.overflowY) &&
        el.scrollHeight > el.clientHeight + 20 &&
        (!best || el.scrollHeight > best.scrollHeight)
      ) {
        best = el;
      }
    }
    return best;
  }

  function scanRoot(root, set) {
    addFromText(root.innerText, set);
    root.querySelectorAll("span[title]").forEach((el) => addFromText(el.getAttribute("title"), set));
  }

  async function fromParticipants(set, autoScroll) {
    const root = getParticipantsRoot();
    if (!root) return false;
    scanRoot(root, set);
    if (!autoScroll) return true;

    const scroller = findScrollable(root);
    if (!scroller) return true;

    scroller.scrollTop = 0;
    await sleep(400);
    let lastTop = -1;
    // A lista é virtualizada: rola aos poucos e lê o que aparece em cada passo.
    for (let i = 0; i < 500 && scroller.scrollTop !== lastTop; i++) {
      scanRoot(root, set);
      lastTop = scroller.scrollTop;
      scroller.scrollTop += Math.max(200, scroller.clientHeight * 0.7);
      await sleep(350);
    }
    scanRoot(root, set);
    return true;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true, groupName: getGroupName() });
      return;
    }
    if (msg?.type !== "CAPTURE") return;

    (async () => {
      try {
        const set = new Set();
        const opts = msg.options || {};
        if (opts.header !== false) fromHeader(set);
        if (opts.messages !== false) fromMessages(set);
        const panelFound = opts.participants !== false
          ? await fromParticipants(set, opts.autoScroll !== false)
          : false;
        sendResponse({
          ok: true,
          groupName: getGroupName(),
          panelFound,
          numbers: [...set],
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e?.message || e) });
      }
    })();
    return true; // resposta assíncrona
  });
})();
