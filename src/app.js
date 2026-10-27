const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { transacao } = require('./db');
const { PERFIS, PERMISSOES, PODE_GERENCIAR, tem } = require('./permissoes');
const agenda = require('./agenda');

const DURACAO_SESSAO_H = 12;
const ANTECEDENCIA_CANCELAMENTO_CLIENTE_MIN = 120;

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}
const falha = (status, msg) => {
  throw new ErroHttp(status, msg);
};

function criarApp(db, { agora = () => new Date() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // Proteção simples contra CSRF: escrita na API só aceita JSON (exige preflight CORS).
  app.use('/api', (req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ erro: 'Envie os dados em JSON.' });
    }
    next();
  });

  const auditar = (usuarioId, acao, entidade, entidadeId, detalhes) =>
    db
      .prepare('INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?,?,?,?,?)')
      .run(usuarioId ?? null, acao, entidade ?? null, entidadeId ?? null, detalhes ? JSON.stringify(detalhes) : null);

  const usuarioPublico = (u) =>
    u && {
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone: u.telefone,
      cpf: u.cpf,
      data_nascimento: u.data_nascimento,
      perfil: u.perfil,
      perfil_rotulo: PERFIS[u.perfil].rotulo,
      loja_id: u.loja_id,
      registro_profissional: u.registro_profissional,
      ativo: !!u.ativo,
      criado_em: u.criado_em,
    };

  // ---------- Autenticação ----------
  app.use((req, res, next) => {
    const token = req.cookies.sessao;
    if (token) {
      const u = db
        .prepare(
          `SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
           WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1`
        )
        .get(token);
      if (u) req.usuario = u;
    }
    next();
  });

  const exigirLogin = (req, res, next) => (req.usuario ? next() : res.status(401).json({ erro: 'Faça login para continuar.' }));
  const exigir = (...permissoes) => [
    exigirLogin,
    (req, res, next) =>
      permissoes.some((p) => tem(req.usuario, p)) ? next() : res.status(403).json({ erro: 'Seu perfil não tem acesso a esta função.' }),
  ];

  const abrirSessao = (res, usuarioId) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare(`INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, datetime('now', '+${DURACAO_SESSAO_H} hours'))`).run(
      token,
      usuarioId
    );
    res.cookie('sessao', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: DURACAO_SESSAO_H * 3600 * 1000,
    });
  };

  const tentativas = new Map(); // e-mail -> { n, ate }
  app.post('/api/auth/login', (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const t = tentativas.get(email);
    if (t && t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (!u || !u.ativo || !bcrypt.compareSync(String(req.body.senha || ''), u.senha_hash)) {
      const n = (t?.n || 0) + 1;
      tentativas.set(email, { n, ate: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }
    tentativas.delete(email);
    db.prepare("DELETE FROM sessoes WHERE expira_em <= datetime('now')").run();
    abrirSessao(res, u.id);
    auditar(u.id, 'login', 'usuario', u.id);
    res.json({ usuario: usuarioPublico(u), permissoes: PERMISSOES[u.perfil] });
  });

  app.post('/api/auth/logout', (req, res) => {
    if (req.cookies.sessao) db.prepare('DELETE FROM sessoes WHERE token = ?').run(req.cookies.sessao);
    res.clearCookie('sessao');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.usuario) return res.json({ usuario: null });
    const loja = req.usuario.loja_id ? db.prepare('SELECT id, nome FROM lojas WHERE id = ?').get(req.usuario.loja_id) : null;
    res.json({ usuario: usuarioPublico(req.usuario), loja, permissoes: PERMISSOES[req.usuario.perfil] });
  });

  // Autocadastro de clientes
  app.post('/api/auth/cadastro', (req, res) => {
    const dados = validarDadosUsuario(req.body, { novo: true });
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(dados.email)) falha(409, 'Já existe uma conta com este e-mail.');
    const id = db
      .prepare('INSERT INTO usuarios (nome, email, senha_hash, telefone, cpf, data_nascimento, perfil) VALUES (?,?,?,?,?,?,?)')
      .run(dados.nome, dados.email, bcrypt.hashSync(dados.senha, 10), dados.telefone, dados.cpf, dados.data_nascimento, 'cliente')
      .lastInsertRowid;
    auditar(id, 'autocadastro', 'usuario', id);
    abrirSessao(res, id);
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    res.status(201).json({ usuario: usuarioPublico(u), permissoes: PERMISSOES.cliente });
  });

  app.put('/api/perfil', exigirLogin, (req, res) => {
    const u = req.usuario;
    const nome = req.body.nome !== undefined ? String(req.body.nome).trim() : u.nome;
    if (!nome) falha(400, 'Informe o nome.');
    const telefone = req.body.telefone !== undefined ? String(req.body.telefone).trim() || null : u.telefone;
    let hash = u.senha_hash;
    if (req.body.nova_senha) {
      if (!bcrypt.compareSync(String(req.body.senha_atual || ''), u.senha_hash)) falha(400, 'Senha atual incorreta.');
      if (String(req.body.nova_senha).length < 8) falha(400, 'A nova senha deve ter ao menos 8 caracteres.');
      hash = bcrypt.hashSync(String(req.body.nova_senha), 10);
    }
    db.prepare('UPDATE usuarios SET nome = ?, telefone = ?, senha_hash = ? WHERE id = ?').run(nome, telefone, hash, u.id);
    auditar(u.id, 'editar_perfil', 'usuario', u.id);
    res.json({ usuario: usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.id)) });
  });

  app.get('/api/perfis', (req, res) => res.json({ perfis: PERFIS, permissoes: PERMISSOES }));

  // ---------- Lojas ----------
  app.get('/api/lojas', (req, res) => {
    const todas = tem(req.usuario, 'lojas.gerenciar') && req.query.todas === '1';
    res.json(db.prepare(`SELECT * FROM lojas ${todas ? '' : 'WHERE ativa = 1'} ORDER BY nome`).all());
  });

  const validarLoja = (b) => {
    const nome = String(b.nome || '').trim();
    if (!nome) falha(400, 'Informe o nome da loja.');
    const abertura = b.hora_abertura || '09:00';
    const fechamento = b.hora_fechamento || '18:00';
    if (!agenda.horaValida(abertura) || !agenda.horaValida(fechamento) || abertura >= fechamento)
      falha(400, 'Horário de funcionamento inválido.');
    const dur = Number(b.duracao_consulta || 30);
    if (!Number.isInteger(dur) || dur < 10 || dur > 180) falha(400, 'A duração da consulta deve ficar entre 10 e 180 minutos.');
    return [nome, b.endereco || null, b.cidade || null, b.telefone || null, abertura, fechamento, dur, b.ativa === false ? 0 : 1];
  };

  app.post('/api/lojas', exigir('lojas.gerenciar'), (req, res) => {
    const id = db
      .prepare(
        'INSERT INTO lojas (nome, endereco, cidade, telefone, hora_abertura, hora_fechamento, duracao_consulta, ativa) VALUES (?,?,?,?,?,?,?,?)'
      )
      .run(...validarLoja(req.body)).lastInsertRowid;
    auditar(req.usuario.id, 'criar', 'loja', id, req.body);
    res.status(201).json(db.prepare('SELECT * FROM lojas WHERE id = ?').get(id));
  });

  app.put('/api/lojas/:id', exigir('lojas.gerenciar'), (req, res) => {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT 1 FROM lojas WHERE id = ?').get(id)) falha(404, 'Loja não encontrada.');
    db.prepare(
      'UPDATE lojas SET nome=?, endereco=?, cidade=?, telefone=?, hora_abertura=?, hora_fechamento=?, duracao_consulta=?, ativa=? WHERE id=?'
    ).run(...validarLoja(req.body), id);
    auditar(req.usuario.id, 'editar', 'loja', id, req.body);
    res.json(db.prepare('SELECT * FROM lojas WHERE id = ?').get(id));
  });

  // ---------- Usuários ----------
  function validarDadosUsuario(b, { novo }) {
    const nome = String(b.nome || '').trim();
    const email = String(b.email || '').trim().toLowerCase();
    if (!nome) falha(400, 'Informe o nome.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) falha(400, 'Informe um e-mail válido.');
    const senha = b.senha ? String(b.senha) : null;
    if (novo && !senha) falha(400, 'Informe uma senha.');
    if (senha && senha.length < 8) falha(400, 'A senha deve ter ao menos 8 caracteres.');
    const cpf = b.cpf ? String(b.cpf).replace(/\D/g, '') : null;
    if (cpf && cpf.length !== 11) falha(400, 'CPF deve ter 11 dígitos.');
    const data_nascimento = b.data_nascimento || null;
    if (data_nascimento && !agenda.dataValida(data_nascimento)) falha(400, 'Data de nascimento inválida.');
    return { nome, email, senha, cpf, data_nascimento, telefone: b.telefone ? String(b.telefone).trim() : null };
  }

  // Um usuário está no escopo de quem o gerencia?
  function noEscopo(eu, alvo) {
    if (!PODE_GERENCIAR[eu.perfil].includes(alvo.perfil)) return false;
    if (eu.perfil === 'admin' || alvo.perfil === 'cliente') return true;
    return alvo.loja_id === eu.loja_id;
  }

  function resolverLojaDoUsuario(eu, perfil, lojaId) {
    if (perfil === 'cliente' || perfil === 'admin') return null;
    const id = eu.perfil === 'admin' ? Number(lojaId) : eu.loja_id;
    if (!id || !db.prepare('SELECT 1 FROM lojas WHERE id = ?').get(id)) falha(400, 'Escolha a loja deste funcionário.');
    return id;
  }

  app.get('/api/usuarios', exigir('usuarios.gerenciar', 'clientes.ver'), (req, res) => {
    const eu = req.usuario;
    const filtros = [];
    const params = [];
    const visiveis = tem(eu, 'usuarios.gerenciar') ? PODE_GERENCIAR[eu.perfil] : ['cliente'];
    let perfis = visiveis;
    if (req.query.perfil) perfis = visiveis.filter((p) => p === req.query.perfil);
    if (!perfis.length) return res.json([]);
    filtros.push(`perfil IN (${perfis.map(() => '?').join(',')})`);
    params.push(...perfis);
    if (eu.perfil !== 'admin') {
      filtros.push("(perfil = 'cliente' OR loja_id = ?)");
      params.push(eu.loja_id);
    } else if (req.query.loja_id) {
      filtros.push('loja_id = ?');
      params.push(Number(req.query.loja_id));
    }
    if (req.query.busca) {
      const termo = `%${String(req.query.busca).trim()}%`;
      filtros.push('(nome LIKE ? OR email LIKE ? OR cpf LIKE ? OR telefone LIKE ?)');
      params.push(termo, termo, termo.replace(/\D/g, '') ? `%${String(req.query.busca).replace(/\D/g, '')}%` : termo, termo);
    }
    const lista = db
      .prepare(`SELECT * FROM usuarios WHERE ${filtros.join(' AND ')} ORDER BY nome LIMIT 200`)
      .all(...params)
      .map(usuarioPublico);
    res.json(lista);
  });

  app.post('/api/usuarios', exigir('usuarios.gerenciar', 'clientes.cadastrar'), (req, res) => {
    const eu = req.usuario;
    const perfil = req.body.perfil || 'cliente';
    if (!PERFIS[perfil]) falha(400, 'Perfil inválido.');
    if (!PODE_GERENCIAR[eu.perfil].includes(perfil)) falha(403, 'Você não pode cadastrar usuários com este perfil.');
    const dados = validarDadosUsuario(req.body, { novo: true });
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(dados.email)) falha(409, 'Já existe um usuário com este e-mail.');
    const lojaId = resolverLojaDoUsuario(eu, perfil, req.body.loja_id);
    const id = db
      .prepare(
        `INSERT INTO usuarios (nome, email, senha_hash, telefone, cpf, data_nascimento, perfil, loja_id, registro_profissional)
         VALUES (?,?,?,?,?,?,?,?,?)`
      )
      .run(
        dados.nome,
        dados.email,
        bcrypt.hashSync(dados.senha, 10),
        dados.telefone,
        dados.cpf,
        dados.data_nascimento,
        perfil,
        lojaId,
        perfil === 'optometrista' ? req.body.registro_profissional || null : null
      ).lastInsertRowid;
    auditar(eu.id, 'criar', 'usuario', id, { perfil, loja_id: lojaId });
    res.status(201).json(usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id)));
  });

  app.put('/api/usuarios/:id', exigir('usuarios.gerenciar', 'clientes.cadastrar'), (req, res) => {
    const eu = req.usuario;
    const alvo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(req.params.id));
    if (!alvo || !noEscopo(eu, alvo)) falha(404, 'Usuário não encontrado.');
    if (alvo.id === eu.id) falha(400, 'Use "Meu perfil" para alterar seus próprios dados.');
    const perfil = req.body.perfil || alvo.perfil;
    if (!PODE_GERENCIAR[eu.perfil].includes(perfil)) falha(403, 'Você não pode atribuir este perfil.');
    const dados = validarDadosUsuario({ ...alvo, ...req.body }, { novo: false });
    const outro = db.prepare('SELECT id FROM usuarios WHERE email = ? AND id <> ?').get(dados.email, alvo.id);
    if (outro) falha(409, 'Já existe um usuário com este e-mail.');
    const lojaId = resolverLojaDoUsuario(eu, perfil, req.body.loja_id ?? alvo.loja_id);
    const ativo = req.body.ativo === undefined ? alvo.ativo : req.body.ativo ? 1 : 0;
    db.prepare(
      `UPDATE usuarios SET nome=?, email=?, telefone=?, cpf=?, data_nascimento=?, perfil=?, loja_id=?, registro_profissional=?, ativo=?,
       senha_hash=? WHERE id=?`
    ).run(
      dados.nome,
      dados.email,
      dados.telefone,
      dados.cpf,
      dados.data_nascimento,
      perfil,
      lojaId,
      perfil === 'optometrista' ? req.body.registro_profissional ?? alvo.registro_profissional : null,
      ativo,
      req.body.senha ? bcrypt.hashSync(dados.senha, 10) : alvo.senha_hash,
      alvo.id
    );
    if (!ativo) db.prepare('DELETE FROM sessoes WHERE usuario_id = ?').run(alvo.id);
    const { senha, ...semSenha } = req.body;
    auditar(eu.id, 'editar', 'usuario', alvo.id, { ...semSenha, senha_alterada: !!senha });
    res.json(usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(alvo.id)));
  });

  // Optometristas visíveis para agendamento (nome apenas)
  app.get('/api/optometristas', exigirLogin, (req, res) => {
    const lojaId = req.query.loja_id ? Number(req.query.loja_id) : null;
    const sql = lojaId
      ? `SELECT DISTINCT u.id, u.nome, u.loja_id FROM usuarios u JOIN disponibilidades d ON d.optometrista_id = u.id
         WHERE u.perfil='optometrista' AND u.ativo=1 AND (d.loja_id = ? OR u.loja_id = ?) ORDER BY u.nome`
      : `SELECT id, nome, loja_id FROM usuarios WHERE perfil='optometrista' AND ativo=1 ORDER BY nome`;
    res.json(lojaId ? db.prepare(sql).all(lojaId, lojaId) : db.prepare(sql).all());
  });

  // ---------- Disponibilidade e bloqueios ----------
  const optometristaNoEscopo = (eu, optId) => {
    const o = db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'optometrista'").get(optId);
    if (!o) return null;
    if (eu.perfil === 'admin') return o;
    if (eu.perfil === 'optometrista') return o.id === eu.id ? o : null;
    if (eu.perfil === 'gerente') {
      const atendeNaLoja = db.prepare('SELECT 1 FROM disponibilidades WHERE optometrista_id = ? AND loja_id = ?').get(o.id, eu.loja_id);
      return o.loja_id === eu.loja_id || atendeNaLoja ? o : null;
    }
    return null;
  };

  app.get('/api/disponibilidades', exigir('agenda.configurar', 'agenda.bloquear_propria'), (req, res) => {
    const eu = req.usuario;
    const f = [];
    const p = [];
    if (eu.perfil === 'gerente') {
      f.push('d.loja_id = ?');
      p.push(eu.loja_id);
    } else if (eu.perfil === 'optometrista') {
      f.push('d.optometrista_id = ?');
      p.push(eu.id);
    }
    if (req.query.loja_id) {
      f.push('d.loja_id = ?');
      p.push(Number(req.query.loja_id));
    }
    if (req.query.optometrista_id) {
      f.push('d.optometrista_id = ?');
      p.push(Number(req.query.optometrista_id));
    }
    res.json(
      db
        .prepare(
          `SELECT d.*, u.nome AS optometrista_nome, l.nome AS loja_nome FROM disponibilidades d
           JOIN usuarios u ON u.id = d.optometrista_id JOIN lojas l ON l.id = d.loja_id
           ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY u.nome, d.dia_semana, d.hora_inicio`
        )
        .all(...p)
    );
  });

  app.post('/api/disponibilidades', exigir('agenda.configurar'), (req, res) => {
    const eu = req.usuario;
    const { optometrista_id, dia_semana, hora_inicio, hora_fim } = req.body;
    const lojaId = eu.perfil === 'admin' ? Number(req.body.loja_id) : eu.loja_id;
    if (!db.prepare('SELECT 1 FROM lojas WHERE id = ?').get(lojaId)) falha(400, 'Loja inválida.');
    const o = db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'optometrista' AND ativo = 1").get(Number(optometrista_id));
    if (!o) falha(400, 'Optometrista inválido.');
    const dia = Number(dia_semana);
    if (!Number.isInteger(dia) || dia < 0 || dia > 6) falha(400, 'Dia da semana inválido.');
    if (!agenda.horaValida(hora_inicio) || !agenda.horaValida(hora_fim) || hora_inicio >= hora_fim) falha(400, 'Horário inválido.');
    const conflito = db
      .prepare('SELECT 1 FROM disponibilidades WHERE optometrista_id = ? AND dia_semana = ? AND hora_inicio < ? AND ? < hora_fim')
      .get(o.id, dia, hora_fim, hora_inicio);
    if (conflito) falha(409, 'Este optometrista já tem horário cadastrado nesse intervalo.');
    const id = db
      .prepare('INSERT INTO disponibilidades (optometrista_id, loja_id, dia_semana, hora_inicio, hora_fim) VALUES (?,?,?,?,?)')
      .run(o.id, lojaId, dia, hora_inicio, hora_fim).lastInsertRowid;
    auditar(eu.id, 'criar', 'disponibilidade', id, req.body);
    res.status(201).json(db.prepare('SELECT * FROM disponibilidades WHERE id = ?').get(id));
  });

  app.delete('/api/disponibilidades/:id', exigir('agenda.configurar'), (req, res) => {
    const d = db.prepare('SELECT * FROM disponibilidades WHERE id = ?').get(Number(req.params.id));
    if (!d || (req.usuario.perfil !== 'admin' && d.loja_id !== req.usuario.loja_id)) falha(404, 'Horário não encontrado.');
    db.prepare('DELETE FROM disponibilidades WHERE id = ?').run(d.id);
    auditar(req.usuario.id, 'excluir', 'disponibilidade', d.id, d);
    res.json({ ok: true });
  });

  app.get('/api/bloqueios', exigir('agenda.configurar', 'agenda.bloquear_propria'), (req, res) => {
    const eu = req.usuario;
    let lista = db
      .prepare(
        `SELECT b.*, u.nome AS optometrista_nome FROM bloqueios b JOIN usuarios u ON u.id = b.optometrista_id
         WHERE b.data >= ? ORDER BY b.data, b.hora_inicio`
      )
      .all(agenda.hojeISO(agora()));
    lista = lista.filter((b) => optometristaNoEscopo(eu, b.optometrista_id));
    res.json(lista);
  });

  app.post('/api/bloqueios', exigir('agenda.configurar', 'agenda.bloquear_propria'), (req, res) => {
    const eu = req.usuario;
    const optId = eu.perfil === 'optometrista' ? eu.id : Number(req.body.optometrista_id);
    if (!optometristaNoEscopo(eu, optId)) falha(400, 'Optometrista inválido.');
    const { data } = req.body;
    const hi = req.body.hora_inicio || '00:00';
    const hf = req.body.hora_fim || '23:59';
    if (!agenda.dataValida(data)) falha(400, 'Data inválida.');
    if (!agenda.horaValida(hi) || !agenda.horaValida(hf) || hi >= hf) falha(400, 'Horário inválido.');
    const id = db
      .prepare('INSERT INTO bloqueios (optometrista_id, data, hora_inicio, hora_fim, motivo) VALUES (?,?,?,?,?)')
      .run(optId, data, hi, hf, req.body.motivo || null).lastInsertRowid;
    auditar(eu.id, 'criar', 'bloqueio', id, req.body);
    // Avisa quais consultas já marcadas caem no bloqueio, para a loja remarcar
    const afetados = db
      .prepare(
        `SELECT a.id, a.hora, c.nome AS cliente_nome FROM agendamentos a JOIN usuarios c ON c.id = a.cliente_id
         WHERE a.optometrista_id = ? AND a.data = ? AND a.status IN ('agendado','confirmado') AND a.hora < ? AND a.hora >= ?`
      )
      .all(optId, data, hf, hi);
    res.status(201).json({ id, agendamentos_afetados: afetados });
  });

  app.delete('/api/bloqueios/:id', exigir('agenda.configurar', 'agenda.bloquear_propria'), (req, res) => {
    const b = db.prepare('SELECT * FROM bloqueios WHERE id = ?').get(Number(req.params.id));
    if (!b || !optometristaNoEscopo(req.usuario, b.optometrista_id)) falha(404, 'Bloqueio não encontrado.');
    db.prepare('DELETE FROM bloqueios WHERE id = ?').run(b.id);
    auditar(req.usuario.id, 'excluir', 'bloqueio', b.id, b);
    res.json({ ok: true });
  });

  // ---------- Horários livres ----------
  app.get('/api/horarios', exigirLogin, (req, res) => {
    const { loja_id, data, optometrista_id } = req.query;
    if (!agenda.dataValida(data)) falha(400, 'Data inválida.');
    res.json(
      agenda.horariosLivres(db, {
        lojaId: Number(loja_id),
        data,
        optometristaId: optometrista_id ? Number(optometrista_id) : null,
        agora: agora(),
      })
    );
  });

  // ---------- Agendamentos ----------
  const SELECT_AG = `SELECT a.*, l.nome AS loja_nome, l.endereco AS loja_endereco, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
      c.email AS cliente_email, o.nome AS optometrista_nome,
      EXISTS(SELECT 1 FROM exames e WHERE e.agendamento_id = a.id) AS tem_exame
    FROM agendamentos a JOIN lojas l ON l.id = a.loja_id JOIN usuarios c ON c.id = a.cliente_id JOIN usuarios o ON o.id = a.optometrista_id`;

  function escopoAgendamentos(eu) {
    switch (eu.perfil) {
      case 'admin':
        return ['1=1', []];
      case 'gerente':
      case 'atendente':
        return ['a.loja_id = ?', [eu.loja_id]];
      case 'optometrista':
        return ['a.optometrista_id = ?', [eu.id]];
      default:
        return ['a.cliente_id = ?', [eu.id]];
    }
  }

  function buscarAgendamento(eu, id) {
    const [cond, p] = escopoAgendamentos(eu);
    const ag = db.prepare(`${SELECT_AG} WHERE a.id = ? AND ${cond}`).get(Number(id), ...p);
    if (!ag) falha(404, 'Agendamento não encontrado.');
    return ag;
  }

  app.get('/api/agendamentos', exigirLogin, (req, res) => {
    const eu = req.usuario;
    const [cond, p] = escopoAgendamentos(eu);
    const f = [cond];
    const params = [...p];
    const q = req.query;
    if (q.data_inicio) f.push('a.data >= ?') && params.push(q.data_inicio);
    if (q.data_fim) f.push('a.data <= ?') && params.push(q.data_fim);
    if (q.loja_id) f.push('a.loja_id = ?') && params.push(Number(q.loja_id));
    if (q.optometrista_id) f.push('a.optometrista_id = ?') && params.push(Number(q.optometrista_id));
    if (q.cliente_id && eu.perfil !== 'cliente') f.push('a.cliente_id = ?') && params.push(Number(q.cliente_id));
    if (q.status) {
      const sts = String(q.status).split(',');
      f.push(`a.status IN (${sts.map(() => '?').join(',')})`);
      params.push(...sts);
    }
    const ordem = q.ordem === 'desc' ? 'DESC' : 'ASC';
    res.json(db.prepare(`${SELECT_AG} WHERE ${f.join(' AND ')} ORDER BY a.data ${ordem}, a.hora ${ordem} LIMIT 500`).all(...params));
  });

  app.get('/api/agendamentos/:id', exigirLogin, (req, res) => res.json(buscarAgendamento(req.usuario, req.params.id)));

  app.post('/api/agendamentos', exigir('agendamentos.criar', 'agendamentos.proprios'), (req, res) => {
    const eu = req.usuario;
    const lojaId = Number(req.body.loja_id);
    const { data, hora } = req.body;
    if (!agenda.dataValida(data) || !agenda.horaValida(hora)) falha(400, 'Escolha data e horário.');
    if (eu.perfil === 'gerente' || eu.perfil === 'atendente') {
      if (lojaId !== eu.loja_id) falha(403, 'Você só pode agendar na sua loja.');
    }
    const clienteId = eu.perfil === 'cliente' ? eu.id : Number(req.body.cliente_id);
    const cliente = db.prepare("SELECT * FROM usuarios WHERE id = ? AND perfil = 'cliente' AND ativo = 1").get(clienteId);
    if (!cliente) falha(400, 'Selecione o cliente.');

    const id = transacao(db, () => {
      const jaTem = db
        .prepare("SELECT 1 FROM agendamentos WHERE cliente_id = ? AND data = ? AND status IN ('agendado','confirmado','em_atendimento')")
        .get(clienteId, data);
      if (jaTem) falha(409, 'Este cliente já tem um exame marcado nesta data.');
      const slot = agenda
        .horariosLivres(db, {
          lojaId,
          data,
          optometristaId: req.body.optometrista_id ? Number(req.body.optometrista_id) : null,
          agora: agora(),
        })
        .find((s) => s.hora === hora);
      if (!slot) falha(409, 'Este horário não está mais disponível. Escolha outro.');
      const loja = db.prepare('SELECT duracao_consulta FROM lojas WHERE id = ?').get(lojaId);
      return db
        .prepare(
          'INSERT INTO agendamentos (loja_id, cliente_id, optometrista_id, data, hora, duracao, observacoes, criado_por) VALUES (?,?,?,?,?,?,?,?)'
        )
        .run(lojaId, clienteId, slot.optometristas[0].id, data, hora, loja.duracao_consulta, req.body.observacoes || null, eu.id)
        .lastInsertRowid;
    });
    auditar(eu.id, 'criar', 'agendamento', id, { loja_id: lojaId, data, hora, cliente_id: clienteId });
    res.status(201).json(buscarAgendamento(eu, id));
  });

  const minutosAte = (ag) => {
    const [a, m, d] = ag.data.split('-').map(Number);
    const [hh, mm] = ag.hora.split(':').map(Number);
    return (new Date(a, m - 1, d, hh, mm) - agora()) / 60000;
  };

  // Quem pode levar um agendamento para cada status, e a partir de quais status
  const TRANSICOES = {
    confirmado: { de: ['agendado'], perfis: ['admin', 'gerente', 'atendente', 'cliente'] },
    cancelado: { de: ['agendado', 'confirmado'], perfis: ['admin', 'gerente', 'atendente', 'cliente'] },
    em_atendimento: { de: ['agendado', 'confirmado'], perfis: ['admin', 'gerente', 'optometrista'] },
    concluido: { de: ['em_atendimento'], perfis: ['admin', 'optometrista'] },
    faltou: { de: ['agendado', 'confirmado'], perfis: ['admin', 'gerente', 'atendente', 'optometrista'] },
  };

  app.patch('/api/agendamentos/:id/status', exigirLogin, (req, res) => {
    const eu = req.usuario;
    const ag = buscarAgendamento(eu, req.params.id);
    const novo = req.body.status;
    const regra = TRANSICOES[novo];
    if (!regra) falha(400, 'Status inválido.');
    if (!regra.perfis.includes(eu.perfil)) falha(403, 'Seu perfil não pode fazer esta alteração.');
    if (!regra.de.includes(ag.status)) falha(409, `Não é possível mudar de "${ag.status}" para "${novo}".`);
    const faltam = minutosAte(ag);
    if (novo === 'cancelado' && eu.perfil === 'cliente' && faltam < ANTECEDENCIA_CANCELAMENTO_CLIENTE_MIN)
      falha(409, 'Cancelamentos pelo site precisam de 2 horas de antecedência. Ligue para a loja.');
    if (novo === 'faltou' && faltam > 0) falha(409, 'Só é possível marcar falta depois do horário da consulta.');
    if (novo === 'em_atendimento' && ag.data !== agenda.hojeISO(agora())) falha(409, 'O atendimento só pode ser iniciado no dia da consulta.');
    db.prepare("UPDATE agendamentos SET status = ?, motivo_cancelamento = ?, atualizado_em = datetime('now') WHERE id = ?").run(
      novo,
      novo === 'cancelado' ? req.body.motivo || null : ag.motivo_cancelamento,
      ag.id
    );
    auditar(eu.id, 'status', 'agendamento', ag.id, { de: ag.status, para: novo, motivo: req.body.motivo });
    res.json(buscarAgendamento(eu, ag.id));
  });

  app.put('/api/agendamentos/:id/remarcar', exigir('agendamentos.alterar', 'agendamentos.proprios'), (req, res) => {
    const eu = req.usuario;
    const ag = buscarAgendamento(eu, req.params.id);
    if (!['agendado', 'confirmado'].includes(ag.status)) falha(409, 'Só consultas agendadas ou confirmadas podem ser remarcadas.');
    if (eu.perfil === 'cliente' && minutosAte(ag) < ANTECEDENCIA_CANCELAMENTO_CLIENTE_MIN)
      falha(409, 'Remarcações pelo site precisam de 2 horas de antecedência. Ligue para a loja.');
    const { data, hora } = req.body;
    if (!agenda.dataValida(data) || !agenda.horaValida(hora)) falha(400, 'Escolha data e horário.');
    transacao(db, () => {
      const slot = agenda
        .horariosLivres(db, {
          lojaId: ag.loja_id,
          data,
          optometristaId: req.body.optometrista_id ? Number(req.body.optometrista_id) : null,
          ignorarAgendamentoId: ag.id,
          agora: agora(),
        })
        .find((s) => s.hora === hora);
      if (!slot) falha(409, 'Este horário não está disponível. Escolha outro.');
      const opt = slot.optometristas.find((o) => o.id === ag.optometrista_id) || slot.optometristas[0];
      db.prepare(
        "UPDATE agendamentos SET data = ?, hora = ?, optometrista_id = ?, status = 'agendado', atualizado_em = datetime('now') WHERE id = ?"
      ).run(data, hora, opt.id, ag.id);
    });
    auditar(eu.id, 'remarcar', 'agendamento', ag.id, { de: `${ag.data} ${ag.hora}`, para: `${data} ${hora}` });
    res.json(buscarAgendamento(eu, ag.id));
  });

  // ---------- Exames (dados clínicos) ----------
  // Visíveis apenas para optometristas, o próprio cliente e o administrador da rede.
  const CAMPOS_EXAME = [
    'od_esferico', 'od_cilindrico', 'od_eixo', 'od_acuidade',
    'oe_esferico', 'oe_cilindrico', 'oe_eixo', 'oe_acuidade',
    'adicao', 'dnp', 'observacoes',
  ];

  app.get('/api/agendamentos/:id/exame', exigir('exames.ver', 'exames.proprios'), (req, res) => {
    const ag = buscarAgendamento(req.usuario, req.params.id);
    res.json(db.prepare('SELECT * FROM exames WHERE agendamento_id = ?').get(ag.id) || null);
  });

  app.put('/api/agendamentos/:id/exame', exigir('exames.registrar'), (req, res) => {
    const ag = buscarAgendamento(req.usuario, req.params.id);
    if (!['em_atendimento', 'concluido'].includes(ag.status)) falha(409, 'Inicie o atendimento antes de registrar o exame.');
    const valores = CAMPOS_EXAME.map((c) => (req.body[c] === undefined || req.body[c] === '' ? null : String(req.body[c]).slice(0, 500)));
    db.prepare(
      `INSERT INTO exames (agendamento_id, ${CAMPOS_EXAME.join(', ')}) VALUES (?, ${CAMPOS_EXAME.map(() => '?').join(', ')})
       ON CONFLICT(agendamento_id) DO UPDATE SET ${CAMPOS_EXAME.map((c) => `${c} = excluded.${c}`).join(', ')}, registrado_em = datetime('now')`
    ).run(ag.id, ...valores);
    auditar(req.usuario.id, 'registrar_exame', 'agendamento', ag.id);
    res.json(db.prepare('SELECT * FROM exames WHERE agendamento_id = ?').get(ag.id));
  });

  app.get('/api/clientes/:id/exames', exigir('exames.ver', 'exames.proprios'), (req, res) => {
    const eu = req.usuario;
    const clienteId = Number(req.params.id);
    if (eu.perfil === 'cliente' && clienteId !== eu.id) falha(404, 'Cliente não encontrado.');
    if (eu.perfil === 'optometrista' && !db.prepare('SELECT 1 FROM agendamentos WHERE cliente_id = ? AND optometrista_id = ?').get(clienteId, eu.id))
      falha(404, 'Cliente não encontrado.');
    res.json(
      db
        .prepare(
          `SELECT e.*, a.data, a.hora, l.nome AS loja_nome, o.nome AS optometrista_nome, o.registro_profissional
           FROM exames e JOIN agendamentos a ON a.id = e.agendamento_id JOIN lojas l ON l.id = a.loja_id
           JOIN usuarios o ON o.id = a.optometrista_id
           WHERE a.cliente_id = ? ORDER BY a.data DESC, a.hora DESC`
        )
        .all(clienteId)
    );
  });

  // ---------- Relatórios ----------
  app.get('/api/relatorios/resumo', exigir('relatorios.ver'), (req, res) => {
    const eu = req.usuario;
    const hoje = agenda.hojeISO(agora());
    const inicio = agenda.dataValida(req.query.inicio) ? req.query.inicio : agenda.somarDias(hoje, -30);
    const fim = agenda.dataValida(req.query.fim) ? req.query.fim : hoje;
    const lojaId = eu.perfil === 'admin' ? (req.query.loja_id ? Number(req.query.loja_id) : null) : eu.loja_id;
    const filtro = `a.data BETWEEN ? AND ? ${lojaId ? 'AND a.loja_id = ?' : ''}`;
    const p = lojaId ? [inicio, fim, lojaId] : [inicio, fim];
    const porStatus = Object.fromEntries(
      db.prepare(`SELECT status, COUNT(*) n FROM agendamentos a WHERE ${filtro} GROUP BY status`).all(...p).map((r) => [r.status, r.n])
    );
    const resumo = (sql) => db.prepare(sql).all(...p);
    const contagens = `COUNT(*) total,
        SUM(a.status = 'concluido') concluidos, SUM(a.status = 'faltou') faltas, SUM(a.status = 'cancelado') cancelados`;
    res.json({
      inicio,
      fim,
      loja_id: lojaId,
      por_status: porStatus,
      por_loja: resumo(`SELECT l.id, l.nome, ${contagens} FROM agendamentos a JOIN lojas l ON l.id = a.loja_id WHERE ${filtro} GROUP BY l.id ORDER BY total DESC`),
      por_optometrista: resumo(
        `SELECT o.id, o.nome, ${contagens} FROM agendamentos a JOIN usuarios o ON o.id = a.optometrista_id WHERE ${filtro} GROUP BY o.id ORDER BY total DESC`
      ),
    });
  });

  app.get('/api/auditoria', exigir('auditoria.ver'), (req, res) => {
    res.json(
      db
        .prepare(
          `SELECT x.*, u.nome AS usuario_nome FROM auditoria x LEFT JOIN usuarios u ON u.id = x.usuario_id ORDER BY x.id DESC LIMIT 300`
        )
        .all()
    );
  });

  // ---------- Front-end ----------
  app.use(express.static(path.join(__dirname, '..', 'public')));
  app.use('/api', (req, res) => res.status(404).json({ erro: 'Rota não encontrada.' }));

  app.use((err, req, res, next) => {
    if (err instanceof ErroHttp) return res.status(err.status).json({ erro: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erro: 'JSON inválido.' });
    console.error(err);
    res.status(500).json({ erro: 'Erro interno. Tente novamente.' });
  });

  return app;
}

module.exports = { criarApp };
