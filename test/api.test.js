process.env.TZ = 'America/Sao_Paulo';
const test = require('node:test');
const assert = require('node:assert');
const { abrir, popularDemo } = require('../src/db');
const { criarApp } = require('../src/app');

// Relógio fixo: segunda-feira, 02/11/2026, 09:00
let relogio = new Date(2026, 10, 2, 9, 0);
let db;
let base;
let servidor;

test.before(async () => {
  db = await abrir(':memory:');
  await popularDemo(db);
  servidor = criarApp(db, { agora: () => relogio }).listen(0);
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

test('login inválido e acesso sem login', async () => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@diniz.com', senha: 'x' }),
  });
  assert.strictEqual(r.status, 401);
  assert.strictEqual((await fetch(`${base}/api/agendamentos`)).status, 401);
});

test('escrita exige JSON (proteção CSRF)', async () => {
  const r = await fetch(`${base}/api/auth/login`, { method: 'POST', body: 'email=a' });
  assert.strictEqual(r.status, 415);
});

test('cliente vê horários e agenda exame', async () => {
  const cli = await entrar('cliente@exemplo.com');
  const lojas = (await cli('GET', '/api/lojas')).corpo;
  ids.centro = lojas.find((l) => l.nome.includes('Centro')).id;
  ids.shopping = lojas.find((l) => l.nome.includes('Shopping')).id;

  const hoje = (await cli('GET', `/api/horarios?loja_id=${ids.centro}&data=2026-11-02`)).corpo;
  assert.ok(hoje.length > 0);
  assert.ok(hoje.every((s) => s.hora > '09:00'), 'não oferece horários passados');

  const dom = (await cli('GET', `/api/horarios?loja_id=${ids.centro}&data=2026-11-08`)).corpo;
  assert.strictEqual(dom.length, 0, 'domingo sem expediente');

  const r = await cli('POST', '/api/agendamentos', { loja_id: ids.centro, data: '2026-11-03', hora: '10:00' });
  assert.strictEqual(r.status, 201, JSON.stringify(r.corpo));
  assert.strictEqual(r.corpo.optometrista_nome, 'Dra. Ana Optometrista');
  ids.ag1 = r.corpo.id;

  const livres = (await cli('GET', `/api/horarios?loja_id=${ids.centro}&data=2026-11-03`)).corpo;
  assert.ok(!livres.some((s) => s.hora === '10:00'), 'horário some depois de marcado');

  const dup = await cli('POST', '/api/agendamentos', { loja_id: ids.centro, data: '2026-11-03', hora: '11:00' });
  assert.strictEqual(dup.status, 409, 'um exame por dia por cliente');
});

test('não permite marcar no mesmo horário duas vezes', async () => {
  const at = await entrar('atendente.centro@diniz.com');
  const novo = await at('POST', '/api/usuarios', { nome: 'Maria Silva', email: 'maria@ex.com', senha: 'senha1234', telefone: '98 9888-1111' });
  assert.strictEqual(novo.status, 201);
  ids.maria = novo.corpo.id;
  const r = await at('POST', '/api/agendamentos', { loja_id: ids.centro, cliente_id: ids.maria, data: '2026-11-03', hora: '10:00' });
  assert.strictEqual(r.status, 409);
  const ok = await at('POST', '/api/agendamentos', { loja_id: ids.centro, cliente_id: ids.maria, data: '2026-11-02', hora: '10:30' });
  assert.strictEqual(ok.status, 201);
  ids.ag2 = ok.corpo.id;
});

test('atendente fica restrito à própria loja', async () => {
  const at = await entrar('atendente.centro@diniz.com');
  const r = await at('POST', '/api/agendamentos', { loja_id: ids.shopping, cliente_id: ids.maria, data: '2026-11-04', hora: '11:00' });
  assert.strictEqual(r.status, 403);
  const atS = await entrar('atendente.shopping@diniz.com');
  assert.strictEqual((await atS('GET', `/api/agendamentos/${ids.ag1}`)).status, 404);
  assert.strictEqual((await at('POST', '/api/usuarios', { nome: 'X', email: 'x@ex.com', senha: 'senha1234', perfil: 'gerente' })).status, 403);
  assert.strictEqual((await at('GET', '/api/relatorios/resumo')).status, 403);
});

test('gerente cadastra equipe só na própria loja', async () => {
  const g = await entrar('gerente.centro@diniz.com');
  const r = await g('POST', '/api/usuarios', {
    nome: 'Nova Atendente', email: 'nova@diniz.com', senha: 'senha1234', perfil: 'atendente', loja_id: ids.shopping,
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.corpo.loja_id, ids.centro, 'loja forçada para a do gerente');
  assert.strictEqual((await g('POST', '/api/usuarios', { nome: 'A', email: 'a2@diniz.com', senha: 'senha1234', perfil: 'admin' })).status, 403);
  const equipe = (await g('GET', '/api/usuarios?perfil=atendente')).corpo;
  assert.ok(equipe.every((u) => u.loja_id === ids.centro));
  assert.strictEqual((await g('POST', '/api/lojas', { nome: 'Nova' })).status, 403);
});

test('fluxo do optometrista: atendimento e exame', async () => {
  const ana = await entrar('ana@diniz.com');
  const lista = (await ana('GET', '/api/agendamentos?data_inicio=2026-11-02&data_fim=2026-11-02')).corpo;
  assert.ok(lista.some((a) => a.id === ids.ag2));
  assert.strictEqual((await ana('PUT', `/api/agendamentos/${ids.ag2}/exame`, { od_esferico: '-1.00' })).status, 409);
  assert.strictEqual((await ana('PATCH', `/api/agendamentos/${ids.ag1}/status`, { status: 'em_atendimento' })).status, 409, 'só no dia');
  assert.strictEqual((await ana('PATCH', `/api/agendamentos/${ids.ag2}/status`, { status: 'em_atendimento' })).status, 200);
  const ex = await ana('PUT', `/api/agendamentos/${ids.ag2}/exame`, { od_esferico: '-1.25', oe_esferico: '-1.00', dnp: '62' });
  assert.strictEqual(ex.status, 200);
  assert.strictEqual((await ana('PATCH', `/api/agendamentos/${ids.ag2}/status`, { status: 'concluido' })).status, 200);

  const bruno = await entrar('bruno@diniz.com');
  assert.strictEqual((await bruno('GET', `/api/agendamentos/${ids.ag2}/exame`)).status, 404, 'outro optometrista não vê');
  const at = await entrar('atendente.centro@diniz.com');
  assert.strictEqual((await at('GET', `/api/agendamentos/${ids.ag2}/exame`)).status, 403, 'recepção não vê dados clínicos');
  const maria = await entrar('maria@ex.com', 'senha1234');
  assert.strictEqual((await maria('GET', `/api/agendamentos/${ids.ag2}/exame`)).corpo.od_esferico, '-1.25');
  assert.strictEqual((await maria('GET', `/api/agendamentos/${ids.ag1}`)).status, 404, 'cliente só vê o que é seu');
});

test('cliente cancela com antecedência e remarca', async () => {
  const cli = await entrar('cliente@exemplo.com');
  const rem = await cli('PUT', `/api/agendamentos/${ids.ag1}/remarcar`, { data: '2026-11-04', hora: '14:00' });
  assert.strictEqual(rem.status, 200, JSON.stringify(rem.corpo));
  assert.strictEqual(rem.corpo.data, '2026-11-04');
  assert.strictEqual((await cli('PATCH', `/api/agendamentos/${ids.ag1}/status`, { status: 'em_atendimento' })).status, 403);
  const c = await cli('PATCH', `/api/agendamentos/${ids.ag1}/status`, { status: 'cancelado', motivo: 'imprevisto' });
  assert.strictEqual(c.status, 200);
  assert.strictEqual((await cli('PATCH', `/api/agendamentos/${ids.ag1}/status`, { status: 'confirmado' })).status, 409);
});

test('cliente não cancela em cima da hora', async () => {
  const cli = await entrar('cliente@exemplo.com');
  const r = await cli('POST', '/api/agendamentos', { loja_id: ids.centro, data: '2026-11-02', hora: '10:00' });
  assert.strictEqual(r.status, 201);
  assert.strictEqual((await cli('PATCH', `/api/agendamentos/${r.corpo.id}/status`, { status: 'cancelado' })).status, 409);
  const at = await entrar('atendente.centro@diniz.com');
  assert.strictEqual((await at('PATCH', `/api/agendamentos/${r.corpo.id}/status`, { status: 'faltou' })).status, 409, 'falta só depois do horário');
  relogio = new Date(2026, 10, 2, 10, 45);
  assert.strictEqual((await at('PATCH', `/api/agendamentos/${r.corpo.id}/status`, { status: 'faltou' })).status, 200);
});

test('bloqueio de agenda remove horários', async () => {
  const ana = await entrar('ana@diniz.com');
  const b = await ana('POST', '/api/bloqueios', { data: '2026-11-05', hora_inicio: '08:00', hora_fim: '12:00', motivo: 'Curso' });
  assert.strictEqual(b.status, 201);
  const cli = await entrar('cliente@exemplo.com');
  const livres = (await cli('GET', `/api/horarios?loja_id=${ids.centro}&data=2026-11-05`)).corpo;
  assert.ok(livres.length > 0 && livres.every((s) => s.hora >= '12:00'));
});

test('admin vê relatório da rede e auditoria', async () => {
  const adm = await entrar('admin@diniz.com');
  const rel = await adm('GET', '/api/relatorios/resumo?inicio=2026-11-01&fim=2026-11-30');
  assert.strictEqual(rel.status, 200);
  assert.strictEqual(rel.corpo.por_status.concluido, 1);
  assert.strictEqual(rel.corpo.por_status.faltou, 1);
  const aud = await adm('GET', '/api/auditoria');
  assert.ok(aud.corpo.length > 5);
  const g = await entrar('gerente.centro@diniz.com');
  assert.strictEqual((await g('GET', '/api/auditoria')).status, 403);
});

test('usuário desativado perde acesso', async () => {
  const adm = await entrar('admin@diniz.com');
  const maria = await entrar('maria@ex.com', 'senha1234');
  assert.strictEqual((await adm('PUT', `/api/usuarios/${ids.maria}`, { ativo: false })).status, 200);
  assert.strictEqual((await maria('GET', '/api/auth/me')).corpo.usuario, null);
  assert.strictEqual((await maria('GET', '/api/agendamentos')).status, 401);
});
