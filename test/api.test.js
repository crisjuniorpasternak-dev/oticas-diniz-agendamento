process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert');
const { abrir, popularDemo } = require('../src/db');
const { criarApp } = require('../src/rotas');

// Relógio fixo: segunda-feira, 02/11/2026, 09:00
let relogio = new Date(2026, 10, 2, 9, 0);
const enviados = []; // eventos que o sistema mandou para o "CRM"
const fetchFalso = async (url, op) => {
  enviados.push({ url, headers: op.headers, corpo: JSON.parse(op.body) });
  return new Response('ok', { status: 200 });
};
let db;
let base;
let servidor;

test.before(async () => {
  db = await abrir(':memory:');
  await popularDemo(db, relogio);
  servidor = criarApp(db, { agora: () => relogio, fetchImpl: fetchFalso }).listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});
test.after(() => servidor.close());

async function entrar(email, senha = 'diniz123') {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, senha }),
  });
  assert.strictEqual(r.status, 200, `login ${email}`);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  return async (metodo, url, corpo) => {
    const resp = await fetch(base + url, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    return { status: resp.status, corpo: await resp.json() };
  };
}

const ids = {};

test('login inválido, acesso sem login e escrita só em JSON', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@diniz.com', senha: 'x' }),
  });
  assert.strictEqual(r.status, 401);
  assert.strictEqual((await fetch(`${base}/api/agendamentos`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/auth/login`, { method: 'POST', body: 'email=a' })).status, 415);
});

test('cada unidade só vê os próprios dados', async () => {
  const adm = await entrar('admin@diniz.com');
  const lojas = (await adm('GET', '/api/lojas')).corpo;
  assert.strictEqual(lojas.length, 3);
  ids.centro = lojas.find((l) => l.nome.includes('Centro')).id;
  ids.aventureiro = lojas.find((l) => l.nome.includes('Aventureiro')).id;

  const av = await entrar('aventureiro@diniz.com');
  const minhas = (await av('GET', '/api/lojas')).corpo;
  assert.deepStrictEqual(minhas.map((l) => l.id), [ids.aventureiro]);
  const ags = (await av('GET', '/api/agendamentos')).corpo;
  assert.ok(ags.length > 0 && ags.every((a) => a.loja_id === ids.aventureiro));
  const deOutra = (await adm('GET', `/api/agendamentos?loja_id=${ids.centro}`)).corpo[0];
  assert.strictEqual((await av('GET', `/api/agendamentos/${deOutra.id}`)).status, 404);
  assert.strictEqual((await av('GET', `/api/agendamentos?loja_id=${ids.centro}`)).corpo.every((a) => a.loja_id === ids.aventureiro), true);
  assert.strictEqual((await av('GET', '/api/auditoria')).status, 403);
});

test('criar agendamento depende de liberação do administrador', async () => {
  const rec = await entrar('recepcao.centro@diniz.com');
  const novo = { cliente: { nome: 'Maria Silva', telefone: '(98) 98888-1111' }, data: '2026-11-03', hora: '17:00' };
  assert.strictEqual((await rec('POST', '/api/agendamentos', novo)).status, 403);

  const g = await entrar('centro@diniz.com');
  const equipe = (await g('GET', '/api/usuarios')).corpo;
  ids.recepcao = equipe.find((u) => u.email === 'recepcao.centro@diniz.com').id;
  await g('PUT', `/api/usuarios/${ids.recepcao}`, { pode_agendar: true });
  assert.strictEqual((await rec('POST', '/api/agendamentos', novo)).status, 403, 'gerente não libera');

  const adm = await entrar('admin@diniz.com');
  assert.strictEqual((await adm('PUT', `/api/usuarios/${ids.recepcao}`, { pode_agendar: true })).corpo.pode_agendar, true);
  const r = await rec('POST', '/api/agendamentos', novo);
  assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.loja_id, ids.centro);
  ids.maria = r.corpo.cliente_id;
  ids.ag1 = r.corpo.id;
});

test('vagas por horário e encaixe', async () => {
  const g = await entrar('centro@diniz.com');
  // Centro tem 2 vagas por horário; Maria já ocupa uma às 17:00
  const segundo = await g('POST', '/api/agendamentos', { cliente: { nome: 'João Pereira', telefone: '98 97777-2222' }, data: '2026-11-03', hora: '17:00' });
  assert.strictEqual(segundo.status, 201);
  const terceiro = { cliente: { nome: 'Paula Reis', telefone: '98 96666-3333' }, data: '2026-11-03', hora: '17:00' };
  assert.strictEqual((await g('POST', '/api/agendamentos', terceiro)).status, 409);
  assert.strictEqual((await g('POST', '/api/agendamentos', { ...terceiro, encaixe: true })).status, 201);
  const livres = (await g('GET', `/api/horarios?loja_id=${ids.centro}&data=2026-11-03`)).corpo;
  assert.ok(!livres.some((s) => s.hora === '17:00'));
  // Cliente existente é reaproveitado pelo telefone
  const dup = await g('POST', '/api/agendamentos', { cliente: { nome: 'Maria S.', telefone: '98988881111' }, data: '2026-11-03', hora: '17:30' });
  assert.strictEqual(dup.status, 409, 'um agendamento por cliente por dia');
});

test('presença: compareceu e faltou respeitam a data e a hora', async () => {
  const rec = await entrar('recepcao.centro@diniz.com');
  assert.strictEqual((await rec('PATCH', `/api/agendamentos/${ids.ag1}/status`, { status: 'compareceu' })).status, 409);
  const hoje = await rec('POST', '/api/agendamentos', { cliente_id: ids.maria, data: '2026-11-02', hora: '17:30' });
  assert.strictEqual(hoje.status, 201, JSON.stringify(hoje.corpo));
  assert.strictEqual((await rec('PATCH', `/api/agendamentos/${hoje.corpo.id}/status`, { status: 'faltou' })).status, 409);
  assert.strictEqual((await rec('PATCH', `/api/agendamentos/${hoje.corpo.id}/status`, { status: 'compareceu' })).corpo.status, 'compareceu');
  // Correção: recepção não reabre, gerente reabre
  assert.strictEqual((await rec('PATCH', `/api/agendamentos/${hoje.corpo.id}/status`, { status: 'agendado' })).status, 403);
  const g = await entrar('centro@diniz.com');
  assert.strictEqual((await g('PATCH', `/api/agendamentos/${hoje.corpo.id}/status`, { status: 'agendado' })).status, 200);
});

test('contagem para o calendário e para a seleção de unidades', async () => {
  const adm = await entrar('admin@diniz.com');
  const dias = (await adm('GET', '/api/agendamentos/contagem?data_inicio=2026-11-01&data_fim=2026-11-30')).corpo;
  const dia3 = dias.find((d) => d.data === '2026-11-03');
  assert.ok(dia3.total >= 3);
  const unid = (await adm('GET', '/api/agendamentos/contagem?por=unidade&data_inicio=2026-11-02&data_fim=2026-11-02')).corpo;
  assert.ok(unid.length >= 1 && unid.every((u) => u.loja_id));
  const av = await entrar('aventureiro@diniz.com');
  const soMinha = (await av('GET', '/api/agendamentos/contagem?por=unidade&data_inicio=2026-10-01&data_fim=2026-12-31')).corpo;
  assert.deepStrictEqual(soMinha.map((u) => u.loja_id), [ids.aventureiro]);
});

test('nova unidade exige e-mail e senha de acesso', async () => {
  const adm = await entrar('admin@diniz.com');
  assert.strictEqual((await adm('POST', '/api/lojas', { nome: 'Óticas Diniz Norte' })).status, 400);
  const r = await adm('POST', '/api/lojas', { nome: 'Óticas Diniz Norte', acesso_email: 'norte@diniz.com', acesso_senha: 'norte12345' });
  assert.strictEqual(r.status, 201);
  ids.norte = r.corpo.id;
  const norte = await entrar('norte@diniz.com', 'norte12345');
  const me = (await norte('GET', '/api/auth/me')).corpo;
  assert.strictEqual(me.usuario.perfil, 'gerente');
  assert.strictEqual(me.loja.id, ids.norte);
  assert.strictEqual(me.permissoes.agendar, false);
  assert.strictEqual((await norte('GET', '/api/agendamentos')).corpo.length, 0);
  const h = (await norte('GET', `/api/lojas/${ids.norte}/horarios`)).corpo;
  assert.strictEqual(h.horarios.length, 6);
  assert.strictEqual((await norte('GET', `/api/lojas/${ids.centro}/horarios`)).status, 403);
});

test('webhook de entrada do CRM', async () => {
  const adm = await entrar('admin@diniz.com');
  const cfg = (await adm('GET', '/api/integracao')).corpo;
  const url = new URL(cfg.url_entrada);
  const caminho = url.pathname + url.search;
  const enviar = (corpo, tipo = 'json', rota = caminho) =>
    fetch(base + rota, {
      method: 'POST',
      headers: { 'Content-Type': tipo === 'json' ? 'application/json' : 'application/x-www-form-urlencoded' },
      body: tipo === 'json' ? JSON.stringify(corpo) : new URLSearchParams(corpo).toString(),
    }).then(async (r) => ({ status: r.status, corpo: await r.json() }));

  assert.strictEqual((await enviar({}, 'json', url.pathname + '?token=errado')).status, 401);
  const r = await enviar({ id: 'neg-1', lead: { id: 'lead-9', name: 'Rita Oliveira', phone: '+55 47 99999-1234' }, unidade: 'aventureiro', data_hora: '2026-11-04T15:30:00-03:00' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
  ids.crm = r.corpo.agendamento_id;
  const repetido = await enviar({ id: 'neg-1', lead: { id: 'lead-9', name: 'Rita Oliveira' }, unidade: 'aventureiro', data: '05/11/2026', hora: '10:00' });
  assert.strictEqual(repetido.status, 200);
  assert.strictEqual(repetido.corpo.agendamento_id, ids.crm, 'mesmo id do CRM atualiza, não duplica');

  const av = await entrar('aventureiro@diniz.com');
  const ag = (await av('GET', `/api/agendamentos/${ids.crm}`)).corpo;
  assert.strictEqual(ag.origem, 'crm');
  assert.strictEqual(ag.data, '2026-11-05');
  assert.strictEqual(ag.hora, '10:00');
  assert.strictEqual(ag.cliente_nome, 'Rita Oliveira');

  const form = await enviar({ id: 'neg-2', 'lead[name]': 'Sérgio Dias', 'lead[phone]': '47988887777', unidade: 'Óticas Diniz Aventureiro', data: '2026-11-06', hora: '9:00' }, 'form');
  assert.strictEqual(form.status, 201, JSON.stringify(form.corpo));
  assert.strictEqual((await enviar({ id: 'neg-3', name: 'X', unidade: 'Inexistente', data: '2026-11-06', hora: '09:00' })).status, 422);
  assert.strictEqual((await enviar({ id: 'neg-2', status: 'cancelado' })).corpo.status, 'cancelado');

  const eventos = (await adm('GET', '/api/integracao')).corpo.eventos;
  assert.ok(eventos.filter((e) => e.direcao === 'entrada').length >= 4);
});

test('webhook de saída avisa o CRM sobre presença', async () => {
  const adm = await entrar('admin@diniz.com');
  assert.strictEqual((await adm('PUT', '/api/integracao', { saida_url: 'http://inseguro.com' })).status, 400);
  await adm('PUT', '/api/integracao', { saida_url: 'https://crm.exemplo.com/webhook', saida_token: 'segredo' });
  relogio = new Date(2026, 10, 5, 11, 0);
  const av = await entrar('aventureiro@diniz.com');
  assert.strictEqual((await av('PATCH', `/api/agendamentos/${ids.crm}/status`, { status: 'compareceu' })).status, 200);
  const ultimo = enviados.at(-1);
  assert.strictEqual(ultimo.url, 'https://crm.exemplo.com/webhook');
  assert.strictEqual(ultimo.headers['X-Webhook-Token'], 'segredo');
  assert.strictEqual(ultimo.corpo.evento, 'agendamento.compareceu');
  assert.strictEqual(ultimo.corpo.agendamento.compareceu, true);
  assert.strictEqual(ultimo.corpo.agendamento.id_externo, 'neg-1');
  assert.strictEqual(ultimo.corpo.cliente.crm_id, 'lead-9');
});

test('logs e administradores: só o administrador principal', async () => {
  const adm = await entrar('admin@diniz.com');
  assert.strictEqual((await adm('GET', '/api/auditoria')).status, 200);
  const r = await adm('POST', '/api/usuarios', { nome: 'Admin 2', email: 'admin2@diniz.com', senha: 'admin2345', perfil: 'admin' });
  assert.strictEqual(r.status, 201);
  const adm2 = await entrar('admin2@diniz.com', 'admin2345');
  assert.strictEqual((await adm2('GET', '/api/auditoria')).status, 403);
  assert.strictEqual((await adm2('POST', '/api/usuarios', { nome: 'A3', email: 'a3@diniz.com', senha: 'admin2345', perfil: 'admin' })).status, 403);
  assert.strictEqual((await adm2('GET', '/api/agendamentos')).status, 200);
  const g = await entrar('centro@diniz.com');
  const rel = await g('GET', `/api/relatorios/resumo?inicio=2026-10-01&fim=2026-11-30&loja_id=${ids.aventureiro}`);
  assert.strictEqual(rel.corpo.loja_id, ids.centro, 'gerente só vê relatório da própria unidade');
});

test('usuário desativado perde acesso', async () => {
  const rec = await entrar('recepcao.centro@diniz.com');
  const adm = await entrar('admin@diniz.com');
  assert.strictEqual((await adm('PUT', `/api/usuarios/${ids.recepcao}`, { ativo: false })).status, 200);
  assert.strictEqual((await rec('GET', '/api/agendamentos')).status, 401);
});
