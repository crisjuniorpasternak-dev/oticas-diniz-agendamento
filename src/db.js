const { createClient } = require('@libsql/client');
const path = require('path');
const fs = require('fs');
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
  ativa INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  senha_hash TEXT NOT NULL,
  telefone TEXT,
  cpf TEXT,
  data_nascimento TEXT,
  perfil TEXT NOT NULL CHECK (perfil IN ('admin','gerente','atendente','optometrista','cliente')),
  loja_id INTEGER REFERENCES lojas(id),
  registro_profissional TEXT,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessoes (
  token TEXT PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira_em TEXT NOT NULL
);

-- Horários semanais em que cada optometrista atende em cada loja
CREATE TABLE IF NOT EXISTS disponibilidades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  optometrista_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  dia_semana INTEGER NOT NULL CHECK (dia_semana BETWEEN 0 AND 6),
  hora_inicio TEXT NOT NULL,
  hora_fim TEXT NOT NULL
);

-- Folgas, férias e outros bloqueios pontuais de agenda
CREATE TABLE IF NOT EXISTS bloqueios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  optometrista_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  data TEXT NOT NULL,
  hora_inicio TEXT NOT NULL DEFAULT '00:00',
  hora_fim TEXT NOT NULL DEFAULT '23:59',
  motivo TEXT
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loja_id INTEGER NOT NULL REFERENCES lojas(id),
  cliente_id INTEGER NOT NULL REFERENCES usuarios(id),
  optometrista_id INTEGER NOT NULL REFERENCES usuarios(id),
  data TEXT NOT NULL,
  hora TEXT NOT NULL,
  duracao INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'agendado'
    CHECK (status IN ('agendado','confirmado','em_atendimento','concluido','cancelado','faltou')),
  observacoes TEXT,
  motivo_cancelamento TEXT,
  criado_por INTEGER REFERENCES usuarios(id),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  atualizado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ag_data ON agendamentos(loja_id, data);
CREATE INDEX IF NOT EXISTS idx_ag_opt ON agendamentos(optometrista_id, data);
CREATE INDEX IF NOT EXISTS idx_ag_cli ON agendamentos(cliente_id);

-- Resultado do exame, preenchido pelo optometrista
CREATE TABLE IF NOT EXISTS exames (
  agendamento_id INTEGER PRIMARY KEY REFERENCES agendamentos(id),
  od_esferico TEXT, od_cilindrico TEXT, od_eixo TEXT, od_acuidade TEXT,
  oe_esferico TEXT, oe_cilindrico TEXT, oe_eixo TEXT, oe_acuidade TEXT,
  adicao TEXT, dnp TEXT,
  observacoes TEXT,
  registrado_em TEXT NOT NULL DEFAULT (datetime('now'))
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

// url: "file:caminho.db" ou ":memory:" localmente; "libsql://..." no Turso (produção).
async function abrir(url, authToken) {
  if (url.startsWith('file:')) fs.mkdirSync(path.dirname(url.slice(5)), { recursive: true });
  const cliente = createClient({ url, authToken });
  await cliente.executeMultiple(SCHEMA);
  const db = envolver((q) => cliente.execute(q));
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

// Dados iniciais para demonstração: 3 lojas e um usuário de cada perfil.
async function popularDemo(db) {
  if ((await db.get('SELECT COUNT(*) n FROM usuarios')).n > 0) return false;
  const senha = bcrypt.hashSync('diniz123', 10);

  await db.transacao(async (tx) => {
    const loja = async (...v) =>
      (
        await tx.run(
          'INSERT INTO lojas (nome, endereco, cidade, telefone, hora_abertura, hora_fechamento, duracao_consulta) VALUES (?,?,?,?,?,?,?)',
          ...v
        )
      ).lastInsertRowid;
    const l1 = await loja('Óticas Diniz Centro', 'Rua Principal, 100', 'São Luís - MA', '(98) 3000-0001', '08:00', '18:00', 30);
    const l2 = await loja('Óticas Diniz Shopping', 'Av. dos Holandeses, 2000 - Loja 45', 'São Luís - MA', '(98) 3000-0002', '10:00', '22:00', 30);
    const l3 = await loja('Óticas Diniz Cohama', 'Av. Daniel de La Touche, 500', 'São Luís - MA', '(98) 3000-0003', '09:00', '19:00', 40);

    const usuario = async (...v) =>
      (
        await tx.run(
          'INSERT INTO usuarios (nome, email, senha_hash, telefone, perfil, loja_id, registro_profissional) VALUES (?,?,?,?,?,?,?)',
          ...v
        )
      ).lastInsertRowid;
    await usuario('Administrador da Rede', 'admin@diniz.com', senha, null, 'admin', null, null);
    await usuario('Gerente Centro', 'gerente.centro@diniz.com', senha, null, 'gerente', l1, null);
    await usuario('Gerente Shopping', 'gerente.shopping@diniz.com', senha, null, 'gerente', l2, null);
    await usuario('Atendente Centro', 'atendente.centro@diniz.com', senha, null, 'atendente', l1, null);
    await usuario('Atendente Shopping', 'atendente.shopping@diniz.com', senha, null, 'atendente', l2, null);
    const o1 = await usuario('Dra. Ana Optometrista', 'ana@diniz.com', senha, null, 'optometrista', l1, 'CBOO 12345');
    const o2 = await usuario('Dr. Bruno Optometrista', 'bruno@diniz.com', senha, null, 'optometrista', l2, 'CBOO 67890');
    const o3 = await usuario('Dra. Carla Optometrista', 'carla@diniz.com', senha, null, 'optometrista', l3, 'CBOO 11223');
    await usuario('Cliente Exemplo', 'cliente@exemplo.com', senha, '(98) 99999-0000', 'cliente', null, null);

    const disp = (...v) =>
      tx.run('INSERT INTO disponibilidades (optometrista_id, loja_id, dia_semana, hora_inicio, hora_fim) VALUES (?,?,?,?,?)', ...v);
    for (let d = 1; d <= 6; d++) {
      await disp(o1, l1, d, '08:00', d === 6 ? '12:00' : '17:00');
      await disp(o2, l2, d, '10:00', '19:00');
      await disp(o3, l3, d, '09:00', '18:20');
    }
    // A Dra. Ana também atende no Shopping às sextas à noite
    await disp(o1, l2, 5, '18:00', '21:00');
  });
  return true;
}

// Cria o administrador inicial (produção), se ainda não houver nenhum.
async function criarAdminInicial(db, email, senha) {
  if (await db.get("SELECT 1 FROM usuarios WHERE perfil = 'admin'")) return false;
  if (senha.length < 8) throw new Error('ADMIN_SENHA deve ter ao menos 8 caracteres.');
  await db.run(
    "INSERT INTO usuarios (nome, email, senha_hash, perfil) VALUES ('Administrador da rede', ?, ?, 'admin')",
    email.trim().toLowerCase(),
    bcrypt.hashSync(senha, 10)
  );
  return true;
}

// Abre o banco conforme as variáveis de ambiente e aplica os dados iniciais.
async function prepararBanco(env = process.env) {
  const remoto = env.TURSO_DATABASE_URL || env.DATABASE_URL;
  const producao = !!env.VERCEL || env.NODE_ENV === 'production';
  if (env.VERCEL && !remoto) throw new Error('Na Vercel é preciso conectar o banco Turso (TURSO_DATABASE_URL).');
  const url = remoto || `file:${env.DB_FILE || path.join(__dirname, '..', 'dados', 'agendamentos.db')}`;
  const db = await abrir(url, env.TURSO_AUTH_TOKEN || env.DATABASE_AUTH_TOKEN);
  if (env.ADMIN_EMAIL && env.ADMIN_SENHA) {
    if (await criarAdminInicial(db, env.ADMIN_EMAIL, env.ADMIN_SENHA)) console.log(`Administrador inicial criado: ${env.ADMIN_EMAIL}`);
  } else if (producao) {
    // Em produção nunca cria usuários de demonstração com senha conhecida
    if (!(await db.get("SELECT 1 FROM usuarios WHERE perfil = 'admin'")))
      console.warn('Nenhum administrador cadastrado: defina ADMIN_EMAIL e ADMIN_SENHA e faça um novo deploy.');
  } else if (env.SEM_DEMO !== '1' && (await popularDemo(db))) {
    console.log('Banco criado com dados de demonstração (senha de todos os usuários: diniz123).');
  }
  return db;
}

module.exports = { abrir, popularDemo, prepararBanco };
