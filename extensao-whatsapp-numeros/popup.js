const $ = (id) => document.getElementById(id);
const STORAGE_KEY = "contatos"; // { [numero]: { numero, grupos: string[], capturadoEm: ISO } }

async function getTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.url && tab.url.startsWith("https://web.whatsapp.com") ? tab : null;
}

async function loadContatos() {
  const data = await chrome.storage.local.get(STORAGE_KEY);
  return data[STORAGE_KEY] || {};
}

const saveContatos = (contatos) => chrome.storage.local.set({ [STORAGE_KEY]: contatos });

function formatar(n) {
  // +55 (11) 91234-5678 para números brasileiros; demais ficam com "+" e dígitos
  const m = n.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
  return m ? `+55 (${m[1]}) ${m[2]}-${m[3]}` : `+${n}`;
}

function filtrados(contatos) {
  const g = $("filtroGrupo").value;
  return Object.values(contatos)
    .filter((c) => !g || c.grupos.includes(g))
    .sort((a, b) => a.numero.localeCompare(b.numero));
}

async function render() {
  const contatos = await loadContatos();
  const select = $("filtroGrupo");
  const atual = select.value;
  const grupos = [...new Set(Object.values(contatos).flatMap((c) => c.grupos))].sort();
  select.innerHTML = '<option value="">Todos os grupos</option>';
  for (const g of grupos) select.add(new Option(g, g, false, g === atual));

  const lista = filtrados(contatos);
  $("total").textContent = lista.length;
  const ul = $("lista");
  ul.innerHTML = "";
  for (const c of lista) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = formatar(c.numero);
    const small = document.createElement("small");
    small.textContent = c.grupos.join(", ");
    small.title = small.textContent;
    li.append(span, small);
    ul.append(li);
  }
}

async function capturar() {
  const tab = await getTab();
  if (!tab) return ($("status").textContent = "Abra https://web.whatsapp.com nesta aba.");

  $("btnCapturar").disabled = true;
  $("status").textContent = "Captando… (não mexa na lista enquanto rola)";
  try {
    const res = await chrome.tabs.sendMessage(tab.id, {
      type: "CAPTURE",
      options: {
        participants: $("optParticipants").checked,
        autoScroll: $("optAutoScroll").checked,
        header: $("optHeader").checked,
        messages: $("optMessages").checked,
      },
    });
    if (!res?.ok) throw new Error(res?.error || "sem resposta");

    const grupo = res.groupName || "Sem nome";
    const contatos = await loadContatos();
    let novos = 0;
    for (const numero of res.numbers) {
      const c = contatos[numero];
      if (!c) {
        contatos[numero] = { numero, grupos: [grupo], capturadoEm: new Date().toISOString() };
        novos++;
      } else if (!c.grupos.includes(grupo)) {
        c.grupos.push(grupo);
      }
    }
    await saveContatos(contatos);

    let msg = `${res.numbers.length} número(s) encontrados, ${novos} novo(s) em "${grupo}".`;
    if ($("optParticipants").checked && !res.panelFound) {
      msg += " Dica: abra os dados do grupo e clique em \"Ver todos\" para captar todos os participantes.";
    }
    $("status").textContent = msg;
    await render();
  } catch (e) {
    $("status").textContent =
      "Não foi possível falar com a página. Recarregue o WhatsApp Web (F5) e tente de novo. " + e.message;
  } finally {
    $("btnCapturar").disabled = false;
  }
}

async function exportarCsv() {
  const lista = filtrados(await loadContatos());
  const esc = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const linhas = [["numero", "numero_formatado", "grupos", "capturado_em"].join(";")];
  for (const c of lista) {
    linhas.push([c.numero, formatar(c.numero), c.grupos.join(" | "), c.capturadoEm].map(esc).join(";"));
  }
  // BOM para o Excel abrir com acentuação correta
  const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `numeros-whatsapp-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copiar() {
  const lista = filtrados(await loadContatos());
  await navigator.clipboard.writeText(lista.map((c) => c.numero).join("\n"));
  $("status").textContent = `${lista.length} número(s) copiados.`;
}

async function limpar() {
  const g = $("filtroGrupo").value;
  if (!confirm(g ? `Apagar os números do grupo "${g}"?` : "Apagar todos os números salvos?")) return;
  const contatos = await loadContatos();
  for (const [n, c] of Object.entries(contatos)) {
    if (!g) delete contatos[n];
    else {
      c.grupos = c.grupos.filter((x) => x !== g);
      if (!c.grupos.length) delete contatos[n];
    }
  }
  await saveContatos(contatos);
  $("filtroGrupo").value = "";
  await render();
}

async function init() {
  $("btnCapturar").onclick = capturar;
  $("btnCsv").onclick = exportarCsv;
  $("btnCopiar").onclick = copiar;
  $("btnLimpar").onclick = limpar;
  $("filtroGrupo").onchange = render;
  $("optParticipants").onchange = () => ($("optAutoScroll").disabled = !$("optParticipants").checked);

  const tab = await getTab();
  if (tab) {
    try {
      const res = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
      $("grupo").textContent = res?.groupName ? `Conversa aberta: ${res.groupName}` : "Abra um grupo no WhatsApp Web…";
    } catch {
      $("grupo").textContent = "Recarregue o WhatsApp Web (F5) para ativar a extensão.";
    }
  } else {
    $("grupo").textContent = "Esta aba não é o WhatsApp Web.";
  }
  await render();
}

init();
