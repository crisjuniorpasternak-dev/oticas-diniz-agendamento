// Integração com o CRM (Datacrazy ou qualquer sistema que envie/receba webhooks).
// Entrada: o CRM chama POST /api/integracoes/crm/webhook?token=... com os dados do agendamento.
// Saída: a cada agendamento criado, alterado ou com presença marcada, o sistema envia
// um POST para a URL configurada em Configurações > Integração.

const { dataValida, horaValida } = require('./agenda');

// Busca o primeiro valor preenchido entre vários caminhos ("lead.phone", "telefone"...)
function pegar(obj, ...caminhos) {
  for (const c of caminhos) {
    const v = c.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v !== undefined && v !== null && String(v).trim() !== '') return typeof v === 'string' ? v.trim() : v;
  }
  return undefined;
}

// Aceita "2026-10-29", "29/10/2026", "2026-10-29T14:30:00-03:00" e "29/10/2026 14:30".
// Datas com fuso (Z ou -03:00) são convertidas para o horário de Brasília.
const FUSO = 'America/Sao_Paulo';
function noFusoLocal(instante) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(instante)
      .map((x) => [x.type, x.value])
  );
  return { data: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}

function lerDataHora(textoData, textoHora) {
  let data;
  let hora = textoHora ? String(textoHora).trim().slice(0, 5) : undefined;
  const t = String(textoData || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m && m[6] && !Number.isNaN(Date.parse(t))) {
    const local = noFusoLocal(new Date(t));
    data = local.data;
    if (!hora) hora = local.hora;
  } else if (m) {
    data = `${m[1]}-${m[2]}-${m[3]}`;
    if (m[4] && !hora) hora = `${m[4]}:${m[5]}`;
  } else if ((m = t.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?/))) {
    data = `${m[3]}-${m[2]}-${m[1]}`;
    if (m[4] && !hora) hora = `${m[4]}:${m[5]}`;
  }
  if (hora && /^\d:\d{2}$/.test(hora)) hora = '0' + hora;
  return { data: dataValida(data) ? data : null, hora: horaValida(hora) ? hora : null };
}

const CANCELAMENTO = /^(cancel|desmarc|excluid|removid|perdid)/i;

function interpretarEntrada(corpo) {
  const b = corpo || {};
  const data_recebida = pegar(b, 'data_hora', 'datahora', 'agendamento.data_hora', 'scheduledAt', 'data', 'date', 'agendamento.data');
  const hora_recebida = pegar(b, 'hora', 'time', 'agendamento.hora');
  const { data, hora } = lerDataHora(data_recebida, hora_recebida);
  return {
    data_recebida,
    hora_recebida,
    id_externo: pegar(b, 'id_externo', 'agendamento.id', 'business.id', 'negocio.id', 'deal.id', 'id'),
    cliente: {
      crm_id: pegar(b, 'cliente.id', 'lead.id', 'lead_id', 'contact.id'),
      nome: pegar(b, 'cliente.nome', 'nome', 'name', 'lead.name', 'contact.name', 'cliente_nome'),
      telefone: pegar(b, 'cliente.telefone', 'telefone', 'phone', 'lead.phone', 'lead.rawPhone', 'contact.phone', 'whatsapp'),
      email: pegar(b, 'cliente.email', 'email', 'lead.email', 'contact.email'),
    },
    unidade: pegar(b, 'unidade_id', 'loja_id', 'unidade', 'loja', 'store', 'agendamento.unidade'),
    data,
    hora,
    observacoes: pegar(b, 'observacoes', 'obs', 'notes', 'observacao'),
    cancelar: CANCELAMENTO.test(String(pegar(b, 'status', 'acao', 'action', 'evento') || '')),
  };
}

// Formato enviado para o CRM
function payloadSaida(evento, a) {
  return {
    evento,
    enviado_em: new Date().toISOString(),
    agendamento: {
      id: a.id,
      id_externo: a.id_externo,
      origem: a.origem,
      status: a.status,
      compareceu: a.status === 'compareceu' ? true : a.status === 'faltou' ? false : null,
      data: a.data,
      hora: a.hora,
      observacoes: a.observacoes,
      motivo_cancelamento: a.motivo_cancelamento,
      unidade: { id: a.loja_id, nome: a.loja_nome },
    },
    cliente: { id: a.cliente_id, crm_id: a.cliente_crm_id, nome: a.cliente_nome, telefone: a.cliente_telefone, email: a.cliente_email },
  };
}

async function registrar(db, direcao, evento, sucesso, detalhe) {
  await db.run(
    'INSERT INTO integracao_eventos (direcao, evento, sucesso, detalhe) VALUES (?,?,?,?)',
    direcao,
    evento,
    sucesso ? 1 : 0,
    String(detalhe ?? '').slice(0, 2000)
  );
}

// Envia o evento ao CRM, se houver URL configurada. Nunca derruba a operação principal.
async function enviarEvento(db, evento, agendamento, { url, token, fetchImpl = fetch } = {}) {
  if (!url) return { enviado: false };
  try {
    const r = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Webhook-Token': token } : {}) },
      body: JSON.stringify(payloadSaida(evento, agendamento)),
      signal: AbortSignal.timeout(6000),
    });
    const texto = await r.text().catch(() => '');
    await registrar(db, 'saida', evento, r.ok, `HTTP ${r.status} · agendamento ${agendamento.id} · ${texto.slice(0, 300)}`);
    return { enviado: r.ok, status: r.status };
  } catch (e) {
    await registrar(db, 'saida', evento, false, `agendamento ${agendamento.id} · ${e.message}`);
    return { enviado: false, erro: e.message };
  }
}

module.exports = { interpretarEntrada, enviarEvento, registrar, payloadSaida, lerDataHora };
