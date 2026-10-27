const { DatabaseSync } = require('node:sqlite');
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

function abrir(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

function transacao(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// Dados iniciais para demonstração: 3 lojas e um usuário de cada perfil.
function popularDemo(db) {
  if (db.prepare('SELECT COUNT(*) n FROM usuarios').get().n > 0) return false;
  const hash = (s) => bcrypt.hashSync(s, 10);
  const senha = hash('diniz123');

  transacao(db, () => {
    const insLoja = db.prepare(
      'INSERT INTO lojas (nome, endereco, cidade, telefone, hora_abertura, hora_fechamento, duracao_consulta) VALUES (?,?,?,?,?,?,?)'
    );
    const l1 = insLoja.run('Óticas Diniz Centro', 'Rua Principal, 100', 'São Luís - MA', '(98) 3000-0001', '08:00', '18:00', 30).lastInsertRowid;
    const l2 = insLoja.run('Óticas Diniz Shopping', 'Av. dos Holandeses, 2000 - Loja 45', 'São Luís - MA', '(98) 3000-0002', '10:00', '22:00', 30).lastInsertRowid;
    const l3 = insLoja.run('Óticas Diniz Cohama', 'Av. Daniel de La Touche, 500', 'São Luís - MA', '(98) 3000-0003', '09:00', '19:00', 40).lastInsertRowid;

    const insU = db.prepare(
      'INSERT INTO usuarios (nome, email, senha_hash, telefone, perfil, loja_id, registro_profissional) VALUES (?,?,?,?,?,?,?)'
    );
    insU.run('Administrador da Rede', 'admin@diniz.com', senha, null, 'admin', null, null);
    insU.run('Gerente Centro', 'gerente.centro@diniz.com', senha, null, 'gerente', l1, null);
    insU.run('Gerente Shopping', 'gerente.shopping@diniz.com', senha, null, 'gerente', l2, null);
    insU.run('Atendente Centro', 'atendente.centro@diniz.com', senha, null, 'atendente', l1, null);
    insU.run('Atendente Shopping', 'atendente.shopping@diniz.com', senha, null, 'atendente', l2, null);
    const o1 = insU.run('Dra. Ana Optometrista', 'ana@diniz.com', senha, null, 'optometrista', l1, 'CBOO 12345').lastInsertRowid;
    const o2 = insU.run('Dr. Bruno Optometrista', 'bruno@diniz.com', senha, null, 'optometrista', l2, 'CBOO 67890').lastInsertRowid;
    const o3 = insU.run('Dra. Carla Optometrista', 'carla@diniz.com', senha, null, 'optometrista', l3, 'CBOO 11223').lastInsertRowid;
    insU.run('Cliente Exemplo', 'cliente@exemplo.com', senha, '(98) 99999-0000', 'cliente', null, null);

    const insD = db.prepare(
      'INSERT INTO disponibilidades (optometrista_id, loja_id, dia_semana, hora_inicio, hora_fim) VALUES (?,?,?,?,?)'
    );
    for (let d = 1; d <= 6; d++) {
      insD.run(o1, l1, d, '08:00', d === 6 ? '12:00' : '17:00');
      insD.run(o2, l2, d, '10:00', '19:00');
      insD.run(o3, l3, d, '09:00', '18:20');
    }
    // A Dra. Ana também atende no Shopping às sextas à noite
    insD.run(o1, l2, 5, '18:00', '21:00');
  });
  return true;
}

module.exports = { abrir, transacao, popularDemo };
