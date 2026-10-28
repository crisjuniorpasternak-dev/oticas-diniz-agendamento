const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS lojas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  endereco TEXT,
  cidade TEXT,
  telefone TEXT,
  hora_abertura TEXT NOT NULL DEFAULT '09:00',
  hora_fechamento TEXT NOT NULL DEFAULT '18:00',
  duracao_consulta INTEGER NOT NULL DEFAULT 30,
  vagas_por_horario INTEGER NOT NULL DEFAULT 1,
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  telefone TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','supervisor','gerente','atendente')),
  loja_id INTEGER REFERENCES lojas(id),
  pode_agendar INTEGER NOT NULL DEFAULT 0,
  principal INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Unidades acompanhadas por cada supervisor
CREATE TABLE IF NOT EXISTS usuario_lojas (
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  PRIMARY KEY (usuario_id, loja_id)
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

-- Horário de atendimento de cada unidade por dia da semana
CREATE TABLE IF NOT EXISTS horarios_loja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL
);

-- Feriados, folgas e outros fechamentos pontuais da unidade
CREATE TABLE IF NOT EXISTS bloqueios_loja (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja_id INTEGER NOT NULL REFERENCES lojas(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  hora_inicio TEXT NOT NULL DEFAULT '00:00',
  hora_fim TEXT NOT NULL DEFAULT '23:59',
  motivo TEXT
);

CREATE TABLE IF NOT EXISTS clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  telefone TEXT,
  email TEXT,
  cpf TEXT,
  crm_id TEXT UNIQUE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_cli_tel ON clientes(telefone);

CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  cliente_id INTEGER NOT NULL REFERENCES clientes(id),
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','confirmado','compareceu','faltou','cancelado')),
  observacoes TEXT,
  motivo_cancelamento TEXT,
  origem TEXT NOT NULL DEFAULT 'sistema' CHECK (origem IN ('sistema','crm')),
  id_externo TEXT,
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ag_loja_data ON agendamentos(loja_id, data);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ag_externo ON agendamentos(origem, id_externo) WHERE id_externo IS NOT NULL;

CREATE TABLE IF NOT EXISTS configuracoes (
  chave TEXT PRIMARY KEY,
  valor TEXT
);

-- Histórico das chamadas de integração (entrada e saída)
CREATE TABLE IF NOT EXISTS integracao_eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  direcao TEXT NOT NULL,
  evento TEXT,
  sucesso INTEGER NOT NULL,
  detalhe TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auditoria (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario_id INTEGER,
  acao TEXT NOT NULL,
  entidade TEXT,
  entidade_id INTEGER,
  detalhes TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Interface única (get/all/run) sobre o cliente libSQL, usada tanto no banco
// principal quanto dentro de transações.
function envolver(executar) {
  const normalizar = (v) => (v === undefined ? null : typeof v === 'boolean' ? Number(v) : v);
  const all = async (sql, ...args) => {
    const r = await executar({ sql, args: args.map(normalizar) });
    return r.rows.map((linha) => Object.fromEntries(r.columns.map((c, i) => [c, linha[i]])));
  };
  return {
    all,
    get: async (sql, ...args) => (await all(sql, ...args))[0],
    run: async (sql, ...args) => {
      const r = await executar({ sql, args: args.map(normalizar) });
      return { lastInsertRowid: r.lastInsertRowid === undefined ? undefined : Number(r.lastInsertRowid), changes: r.rowsAffected };
    },
  };
}

// Adapta bancos criados pela primeira versão (com optometristas e portal do cliente).
async function migrar(db) {
  const colunas = async (tabela) => (await db.all(`PRAGMA table_info(${tabela})`)).map((c) => c.name);
  const vazia = async (tabela) => !(await db.get(`SELECT 1 FROM ${tabela} LIMIT 1`));

  const ag = await colunas('agendamentos');
  if (ag.includes('optometrista_id')) {
    if (!(await vazia('agendamentos'))) throw new Error('Banco com agendamentos da versão antiga: migração manual necessária.');
    for (const t of ['exames', 'agendamentos', 'disponibilidades', 'bloqueios']) await db.run(`DROP TABLE IF EXISTS ${t}`);
  }
  const us = await colunas('usuarios');
  if (us.length && !us.includes('pode_agendar')) {
    await db.run("DELETE FROM sessoes WHERE usuario_id IN (SELECT id FROM usuarios WHERE perfil NOT IN ('admin','gerente','atendente'))");
    await db.run("DELETE FROM usuarios WHERE perfil NOT IN ('admin','gerente','atendente')");
    await db.run('ALTER TABLE usuarios ADD COLUMN pode_agendar INTEGER NOT NULL DEFAULT 0');
    await db.run('ALTER TABLE usuarios ADD COLUMN principal INTEGER NOT NULL DEFAULT 0');
  }
  const lj = await colunas('lojas');
  if (lj.length && !lj.includes('vagas_por_horario')) {
    await db.run('ALTER TABLE lojas ADD COLUMN vagas_por_horario INTEGER NOT NULL DEFAULT 1');
  }
}

// Bancos anteriores ao perfil Supervisor têm a restrição antiga em usuarios.perfil.
// O SQLite não altera CHECK, então a tabela é recriada (procedimento oficial, numa conexão só).
async function permitirSupervisor(cliente, db) {
  const t = await db.get("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'usuarios'");
  if (!t || t.sql.includes("'supervisor'")) return;
  const fk = (await db.get('PRAGMA foreign_keys'))?.foreign_keys ? 'ON' : 'OFF';
  const nova = SCHEMA.match(/CREATE TABLE IF NOT EXISTS usuarios \(([\s\S]*?)\n\);/)[1];
  const cols = 'id, nome, email, senha_hash, telefone, perfil, loja_id, pode_agendar, principal, ativo, criado_em';
  await cliente.executeMultiple(`
    PRAGMA foreign_keys = OFF;
    BEGIN;
    CREATE TABLE usuarios_novo (${nova}\n);
    INSERT INTO usuarios_novo (${cols}) SELECT ${cols} FROM usuarios;
    DROP TABLE usuarios;
    ALTER TABLE usuarios_novo RENAME TO usuarios;
    COMMIT;
    PRAGMA foreign_keys = ${fk};`);
}

// url: "file:caminho.db" ou ":memory:" localmente; "libsql://..." no Turso (produção).
async function abrir(url, authToken) {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const cliente = createClient({ url, authToken });
  const db = envolver((q) => cliente.execute(q));
  await migrar(db);
  await permitirSupervisor(cliente, db);
  await cliente.executeMultiple(SCHEMA);
  // Garante um administrador principal (o mais antigo) quando houver administradores
  if (!(await db.get("SELECT 1 FROM usuarios WHERE perfil = 'admin' AND principal = 1"))) {
    await db.run("UPDATE usuarios SET principal = 1 WHERE id = (SELECT MIN(id) FROM usuarios WHERE perfil = 'admin')");
  }
  db.transacao = async (fn) => {
    const tx = await cliente.transaction('write');
    try {
      const r = await fn(envolver((q) => tx.execute(q)));
      await tx.commit();
      return r;
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    } finally {
      tx.close();
    }
  };
  db.fechar = () => cliente.close();
  return db;
}

// Cria a unidade, seus horários padrão (segunda a sábado no horário da loja)
// e o acesso da unidade (usuário gerente).
async function criarUnidade(tx, loja, acesso) {
  const lojaId = (
    await tx.run(
      'INSERT INTO lojas (nome, endereco, cidade, telefone, hora_abertura, hora_fechamento, duracao_consulta, vagas_por_horario, ativa) VALUES (?,?,?,?,?,?,?,?,?)',
      loja.nome,
      loja.endereco ?? null,
      loja.cidade ?? null,
      loja.telefone ?? null,
      loja.hora_abertura || '09:00',
      loja.hora_fechamento || '18:00',
      loja.duracao_consulta || 30,
      loja.vagas_por_horario || 1,
      loja.ativa === false ? 0 : 1
    )
  ).lastInsertRowid;
  for (let d = 1; d <= 6; d++) {
    await tx.run(
      'INSERT INTO horarios_loja (loja_id, dia_semana, hora_inicio, hora_fim) VALUES (?,?,?,?)',
      lojaId,
      d,
      loja.hora_abertura || '09:00',
      loja.hora_fechamento || '18:00'
    );
  }
  const usuarioId = (
    await tx.run(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, loja_id, pode_agendar) VALUES (?,?,?,'gerente',?,?)",
      acesso.nome || `Acesso ${loja.nome}`,
      acesso.email.trim().toLowerCase(),
      bcrypt.hashSync(acesso.senha, 10),
      lojaId,
      acesso.pode_agendar ? 1 : 0
    )
  ).lastInsertRowid;
  return { lojaId, usuarioId };
}

// Dados para demonstração local: 3 unidades, usuários de cada perfil e agendamentos.
async function popularDemo(db, hoje = new Date()) {
  if ((await db.get('SELECT COUNT(*) n FROM usuarios')).n > 0) return false;
  const senha = 'diniz123';
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  await db.transacao(async (tx) => {
    await tx.run(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_agendar, principal) VALUES ('Administrador da Rede', 'admin@diniz.com', ?, 'admin', 1, 1)",
      bcrypt.hashSync(senha, 10)
    );
    const unidades = [
      [{ nome: 'Óticas Diniz Centro', endereco: 'Rua Principal, 100', cidade: 'São Luís - MA', hora_abertura: '08:00', hora_fechamento: '18:00', vagas_por_horario: 2 }, 'centro@diniz.com', true],
      [{ nome: 'Óticas Diniz Aventureiro', endereco: 'Rua Dona Francisca, 2000', cidade: 'Joinville - SC', hora_abertura: '09:00', hora_fechamento: '19:00' }, 'aventureiro@diniz.com', false],
      [{ nome: 'Óticas Diniz Shopping', endereco: 'Av. dos Holandeses, 2000', cidade: 'São Luís - MA', hora_abertura: '10:00', hora_fechamento: '22:00' }, 'shopping@diniz.com', false],
    ];
    const ids = [];
    for (const [loja, email, pode] of unidades) ids.push((await criarUnidade(tx, loja, { email, senha, pode_agendar: pode })).lojaId);
    await tx.run(
      "INSERT INTO usuarios (nome, email, senha_hash, perfil, loja_id, pode_agendar) VALUES ('Recepção Centro', 'recepcao.centro@diniz.com', ?, 'atendente', ?, 0)",
      bcrypt.hashSync(senha, 10),
      ids[0]
    );
    // Supervisor regional que acompanha Centro e Shopping
    const sup = (
      await tx.run(
        "INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_agendar) VALUES ('Supervisão São Luís', 'supervisor@diniz.com', ?, 'supervisor', 1)",
        bcrypt.hashSync(senha, 10)
      )
    ).lastInsertRowid;
    for (const id of [ids[0], ids[2]]) await tx.run('INSERT INTO usuario_lojas (usuario_id, loja_id) VALUES (?,?)', sup, id);

    const nomes = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Rocha', 'Elaine Castro', 'Fábio Nunes', 'Gabriela Pires', 'Henrique Alves'];
    const cli = [];
    for (const [i, n] of nomes.entries())
      cli.push((await tx.run('INSERT INTO clientes (nome, telefone) VALUES (?, ?)', n, `(98) 9${8000 + i}-${1000 + i * 7}`)).lastInsertRowid);
    const horas = ['09:00', '09:30', '10:00', '11:00', '14:00', '15:30', '16:00'];
    let k = 0;
    for (let dia = -6; dia <= 10; dia++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + dia);
      if (d.getDay() === 0) continue;
      const qtd = 2 + ((dia + 7) % 3);
      for (let j = 0; j < qtd; j++, k++) {
        const status = dia < 0 ? (k % 4 === 0 ? 'faltou' : k % 7 === 0 ? 'cancelado' : 'compareceu') : dia === 0 && j === 0 ? 'confirmado' : 'agendado';
        await tx.run(
          'INSERT INTO agendamentos (loja_id, cliente_id, data, hora, status, origem, id_externo) VALUES (?,?,?,?,?,?,?)',
          ids[k % 3],
          cli[k % cli.length],
          iso(d),
          horas[(k + j) % horas.length],
          status,
          k % 3 === 1 ? 'crm' : 'sistema',
          k % 3 === 1 ? `demo-${k}` : null
        );
      }
    }
  });
  return true;
}

// Cria o administrador principal (produção), se ainda não houver nenhum administrador.
async function criarAdminInicial(db, email, senha) {
  if (await db.get("SELECT 1 FROM usuarios WHERE perfil = 'admin'")) return false;
  if (senha.length < 8) throw new Error('ADMIN_SENHA deve ter ao menos 8 caracteres.');
  await db.run(
    "INSERT INTO usuarios (nome, email, senha_hash, perfil, pode_agendar, principal) VALUES ('Administrador principal', ?, ?, 'admin', 1, 1)",
    email.trim().toLowerCase(),
    bcrypt.hashSync(senha, 10)
  );
  return true;
}

async function configuracao(db, chave, padrao) {
  const r = await db.get('SELECT valor FROM configuracoes WHERE chave = ?', chave);
  if (r) return r.valor;
  if (padrao === undefined) return null;
  const valor = typeof padrao === 'function' ? padrao() : padrao;
  await db.run('INSERT OR IGNORE INTO configuracoes (chave, valor) VALUES (?, ?)', chave, valor);
  return (await db.get('SELECT valor FROM configuracoes WHERE chave = ?', chave)).valor;
}
const definirConfiguracao = (db, chave, valor) =>
  db.run('INSERT INTO configuracoes (chave, valor) VALUES (?, ?) ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor', chave, valor);
const novoToken = () => crypto.randomBytes(24).toString('hex');

// Abre o banco conforme as variáveis de ambiente e aplica os dados iniciais.
async function prepararBanco(env = process.env) {
  const remoto = env.TURSO_DATABASE_URL || env.DATABASE_URL;
  const producao = !!env.VERCEL || env.NODE_ENV === 'production';
  if (env.VERCEL && !remoto) throw new Error('Na Vercel é preciso conectar o banco Turso (TURSO_DATABASE_URL).');
  const url = remoto || `file:${env.DB_FILE || path.join(__dirname, '..', 'dados', 'agendamentos.db')}`;
  const db = await abrir(url, env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN);
  if (env.ADMIN_EMAIL && env.ADMIN_SENHA) {
    if (await criarAdminInicial(db, env.ADMIN_EMAIL, env.ADMIN_SENHA)) console.log(`Administrador principal criado: ${env.ADMIN_EMAIL}`);
  } else if (producao) {
    // Em produção nunca cria usuários de demonstração com senha conhecida
    if (!(await db.get("SELECT 1 FROM usuarios WHERE perfil = 'admin'")))
      console.warn('Nenhum administrador cadastrado: defina ADMIN_EMAIL e ADMIN_SENHA e faça um novo deploy.');
  } else if (env.SEM_DEMO !== '1' && (await popularDemo(db))) {
    console.log('Banco criado com dados de demonstração (senha de todos os usuários: diniz123).');
  }
  return db;
}

module.exports = { abrir, popularDemo, prepararBanco, criarUnidade, configuracao, definirConfiguracao, novoToken };
