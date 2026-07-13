// Normalização de telefone brasileiro.
//
// O problema clássico do "9º dígito": números de celular no Brasil têm um 9
// depois do DDD, mas bases antigas e alguns provedores gravam sem ele. O
// WhatsApp, por sua vez, às vezes devolve o JID sem o 9 pra certos DDDs.
//
// Regra de ouro adotada aqui:
//  - Pra RESPONDER uma mensagem recebida, sempre reaproveitamos o remoteJid
//    exato que o Evolution mandou (ver webhooks.js). Isso elimina o problema.
//  - Pra PRIMEIRO CONTATO (lead), normalizamos a entrada garantindo o 55 e o 9.

// Remove tudo que não for dígito.
export function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

// Recebe qualquer coisa (com máscara, com/sem 55, com/sem 9) e devolve
// o número no formato que o Evolution espera: 55 + DDD + numero.
export function normalizarBR(raw) {
  let n = digits(raw);
  if (!n) return "";

  // Tira zeros de operadora / DDI 0055
  n = n.replace(/^0+/, "");
  if (n.startsWith("550")) n = "55" + n.slice(3);

  // Se já veio com 55, separa pra reprocessar DDD + assinante.
  let temDDI = n.startsWith("55") && n.length >= 12;
  if (temDDI) n = n.slice(2);

  // Agora n deve ser DDD (2) + assinante (8 ou 9).
  if (n.length === 10) {
    // DDD + 8 dígitos -> insere o 9 (celular sem o nono dígito)
    const ddd = n.slice(0, 2);
    const resto = n.slice(2);
    // Só adiciona o 9 se o primeiro dígito do assinante for de celular (6-9).
    if (/[6-9]/.test(resto[0])) {
      n = ddd + "9" + resto;
    }
  }

  return "55" + n;
}

// Extrai só a parte de número de um JID do WhatsApp (5511999999999@s.whatsapp.net)
export function numeroDoJid(jid) {
  return digits(String(jid || "").split("@")[0].split(":")[0]);
}

// Chave canônica pra casar conversas independente do 9º dígito.
// Reduz DDD+assinante a "DDD + últimos 8 dígitos".
export function chaveConversa(numeroOuJid) {
  let n = numeroDoJid(numeroOuJid);
  if (n.startsWith("55")) n = n.slice(2);
  const ddd = n.slice(0, 2);
  const assinante = n.slice(2).slice(-8); // últimos 8 ignora o 9 opcional
  return ddd + assinante;
}
