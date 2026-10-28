const express = require('express');
const cookieParser = require('cookie-parser');
const crypto = require('crypto');
const path = require('path');
const bcrypt = require('bcryptjs');
const { criarUnidade, configuracao, definirConfiguracao, novoToken } = require('./db');
const { PERFIS, ehAdmin, ehPrincipal, podeAgendar, perfisGerenciaveis, permissoes } = require('./permissoes');
const agenda = require('./agenda');
const integracao = require('./integracao');

const DURACAO_SESSAO_H = 12;
const STATUS = ['agendado', 'confirmado', 'compareceu', 'faltou', 'cancelado'];

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}
const falha = (status, msg) => {
  throw new ErroHttp(status, msg);
};

function criarApp(db, { agora = () => new Date(), fetchImpl = fetch } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const WEBHOOK = '/api/integracoes/crm/webhook';

  // Proteção simples contra CSRF: escrita na API só aceita JSON (exige preflight CORS).
  // O webhook do CRM é autenticado por token e pode vir como formulário.
  app.use('/api', (req, res, next) => {
    if (req.originalUrl.startsWith(WEBHOOK)) return next();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ erro: 'Envie os dados em JSON.' });
    }
    next();
  });

  const auditar = async (usuarioId, acao, entidade, entidadeId, detalhes) =>
    db.run(
      'INSERT INTO auditoria (usuario_id, acao, entidade, entidade_id, detalhes) VALUES (?,?,?,?,?)',
      usuarioId ?? null,
      acao,
      entidade ?? null,
      entidadeId ?? null,
      detalhes ? JSON.stringify(detalhes) : null
    );

  const usuarioPublico = (u) =>
    u && {
      id: u.id,
      nome: u.nome,
      email: u.email,
      telefone: u.telefone,
      perfil: u.perfil,
      perfil_rotulo: ehPrincipal(u) ? 'Administrador principal' : PERFIS[u.perfil]?.rotulo,
      loja_id: u.loja_id,
      pode_agendar: podeAgendar(u),
      principal: !!u.principal,
      ativo: !!u.ativo,
      criado_em: u.criado_em,
    };

  // ---------- Autenticação ----------
  app.use(async (req, res, next) => {
    const token = req.cookies.sessao;
    if (token) {
      const u = await db.get(
        `SELECT u.* FROM sessoes s JOIN usuarios u ON u.id = s.usuario_id
         WHERE s.token = ? AND s.expira_em > datetime('now') AND u.ativo = 1`,
        token
      );
      if (u) req.usuario = u;
    }
    next();
  });

  const exigirLogin = (req, res, next) => (req.usuario ? next() : res.status(401).json({ erro: 'Faça login para continuar.' }));
  const exigir = (permissao) => [
    exigirLogin,
    (req, res, next) =>
      permissoes(req.usuario)[permissao] ? next() : res.status(403).json({ erro: 'Seu perfil não tem acesso a esta função.' }),
  ];

  const abrirSessao = async (res, usuarioId) => {
    const token = crypto.randomBytes(32).toString('hex');
    await db.run(
      `INSERT INTO sessoes (token, usuario_id, expira_em) VALUES (?, ?, datetime('now', '+${DURACAO_SESSAO_H} hours'))`,
      token,
      usuarioId
    );
    res.cookie('sessao', token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production' || !!process.env.VERCEL,
      maxAge: DURACAO_SESSAO_H * 3600 * 1000,
    });
  };

  const tentativas = new Map(); // e-mail -> { n, ate }
  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body.email || '').trim().toLowerCase();
    const t = tentativas.get(email);
    if (t && t.ate > Date.now()) return res.status(429).json({ erro: 'Muitas tentativas. Aguarde alguns minutos.' });
    const u = await db.get('SELECT * FROM usuarios WHERE email = ?', email);
    if (!u || !u.ativo || !bcrypt.compareSync(String(req.body.senha || ''), u.senha_hash)) {
      const n = (t?.n || 0) + 1;
      tentativas.set(email, { n, ate: n >= 5 ? Date.now() + 5 * 60 * 1000 : 0 });
      return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
    }
    tentativas.delete(email);
    await db.run("DELETE FROM sessoes WHERE expira_em <= datetime('now')");
    await abrirSessao(res, u.id);
    await auditar(u.id, 'login', 'usuario', u.id);
    res.json({ usuario: usuarioPublico(u), permissoes: permissoes(u) });
  });

  app.post('/api/auth/logout', async (req, res) => {
    if (req.cookies.sessao) await db.run('DELETE FROM sessoes WHERE token = ?', req.cookies.sessao);
    res.clearCookie('sessao');
    res.json({ ok: true });
  });

  app.get('/api/auth/me', async (req, res) => {
    if (!req.usuario) {
      // Mostra os acessos de demonstração na tela de login só quando o banco é o de demonstração
      const demo = !!(await db.get("SELECT 1 FROM usuarios WHERE email = 'admin@diniz.com'")) && !process.env.VERCEL;
      return res.json({ usuario: null, demo });
    }
    const loja = req.usuario.loja_id ? await db.get('SELECT id, nome FROM lojas WHERE id = ?', req.usuario.loja_id) : null;
    res.json({ usuario: usuarioPublico(req.usuario), loja, permissoes: permissoes(req.usuario) });
  });

  app.put('/api/perfil', exigirLogin, async (req, res) => {
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
    await db.run('UPDATE usuarios SET nome = ?, telefone = ?, senha_hash = ? WHERE id = ?', nome, telefone, hash, u.id);
    await auditar(u.id, 'editar_perfil', 'usuario', u.id);
    res.json({ usuario: usuarioPublico(await db.get('SELECT * FROM usuarios WHERE id = ?', u.id)) });
  });

  app.get('/api/saude', (req, res) => res.json({ ok: true }));

  // ---------- Escopo por unidade ----------
  // Administrador escolhe a unidade (ou todas); os demais ficam presos à sua.
  const lojaDoEscopo = (u, lojaPedida) => (ehAdmin(u) ? (lojaPedida ? Number(lojaPedida) : null) : u.loja_id);
  const garantirLoja = (u, lojaId) => {
    if (!ehAdmin(u) && Number(lojaId) !== u.loja_id) falha(403, 'Você só tem acesso à sua unidade.');
  };

  // ---------- Unidades ----------
  app.get('/api/lojas', exigirLogin, async (req, res) => {
    const u = req.usuario;
    if (!ehAdmin(u)) return res.json(await db.all('SELECT * FROM lojas WHERE id = ?', u.loja_id));
    const todas = req.query.todas === '1';
    res.json(await db.all(`SELECT * FROM lojas ${todas ? '' : 'WHERE ativa = 1'} ORDER BY nome`));
  });

  const validarLoja = (b, atual = {}) => {
    const nome = String(b.nome ?? atual.nome ?? '').trim();
    if (!nome) falha(400, 'Informe o nome da unidade.');
    const dur = Number(b.duracao_consulta ?? atual.duracao_consulta ?? 30);
    if (!Number.isInteger(dur) || dur < 5 || dur > 240) falha(400, 'A duração do atendimento deve ficar entre 5 e 240 minutos.');
    const vagas = Number(b.vagas_por_horario ?? atual.vagas_por_horario ?? 1);
    if (!Number.isInteger(vagas) || vagas < 1 || vagas > 50) falha(400, 'Vagas por horário deve ficar entre 1 e 50.');
    const abre = b.hora_abertura ?? atual.hora_abertura ?? '09:00';
    const fecha = b.hora_fechamento ?? atual.hora_fechamento ?? '18:00';
    if (!agenda.horaValida(abre) || !agenda.horaValida(fecha) || abre >= fecha) falha(400, 'Horário de funcionamento inválido.');
    return {
      nome,
      endereco: b.endereco ?? atual.endereco ?? null,
      cidade: b.cidade ?? atual.cidade ?? null,
      telefone: b.telefone ?? atual.telefone ?? null,
      hora_abertura: abre,
      hora_fechamento: fecha,
      duracao_consulta: dur,
      vagas_por_horario: vagas,
      ativa: b.ativa === undefined ? (atual.ativa ?? 1) !== 0 : !!b.ativa,
    };
  };

  const validarEmail = (email) => {
    const e = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) falha(400, 'Informe um e-mail válido.');
    return e;
  };
  const validarSenha = (senha) => {
    if (!senha || String(senha).length < 8) falha(400, 'A senha deve ter ao menos 8 caracteres.');
    return String(senha);
  };

  // Criar uma unidade exige o e-mail e a senha de acesso dela
  app.post('/api/lojas', exigir('unidades'), async (req, res) => {
    const loja = validarLoja(req.body);
    const email = validarEmail(req.body.acesso_email);
    const senha = validarSenha(req.body.acesso_senha);
    if (await db.get('SELECT 1 FROM usuarios WHERE email = ?', email)) falha(409, 'Já existe um usuário com o e-mail de acesso informado.');
    const { lojaId } = await db.transacao((tx) =>
      criarUnidade(tx, loja, { email, senha, nome: req.body.acesso_nome, pode_agendar: !!req.body.acesso_pode_agendar })
    );
    await auditar(req.usuario.id, 'criar', 'unidade', lojaId, { ...loja, acesso_email: email });
    res.status(201).json(await db.get('SELECT * FROM lojas WHERE id = ?', lojaId));
  });

  app.put('/api/lojas/:id', exigir('unidades'), async (req, res) => {
    const atual = await db.get('SELECT * FROM lojas WHERE id = ?', Number(req.params.id));
    if (!atual) falha(404, 'Unidade não encontrada.');
    const l = validarLoja(req.body, atual);
    await db.run(
      'UPDATE lojas SET nome=?, endereco=?, cidade=?, telefone=?, hora_abertura=?, hora_fechamento=?, duracao_consulta=?, vagas_por_horario=?, ativa=? WHERE id=?',
      l.nome, l.endereco, l.cidade, l.telefone, l.hora_abertura, l.hora_fechamento, l.duracao_consulta, l.vagas_por_horario, l.ativa ? 1 : 0, atual.id
    );
    await auditar(req.usuario.id, 'editar', 'unidade', atual.id, req.body);
    res.json(await db.get('SELECT * FROM lojas WHERE id = ?', atual.id));
  });

  // Horários de atendimento da unidade (substitui a lista inteira)
  app.get('/api/lojas/:id/horarios', exigir('horarios'), async (req, res) => {
    garantirLoja(req.usuario, req.params.id);
    const loja = await db.get('SELECT * FROM lojas WHERE id = ?', Number(req.params.id));
    if (!loja) falha(404, 'Unidade não encontrada.');
    const horarios = await db.all('SELECT dia_semana, hora_inicio, hora_fim FROM horarios_loja WHERE loja_id = ? ORDER BY dia_semana, hora_inicio', loja.id);
    res.json({ loja, horarios });
  });

  app.put('/api/lojas/:id/horarios', exigir('horarios'), async (req, res) => {
    garantirLoja(req.usuario, req.params.id);
    const loja = await db.get('SELECT * FROM lojas WHERE id = ?', Number(req.params.id));
    if (!loja) falha(404, 'Unidade não encontrada.');
    const horarios = Array.isArray(req.body.horarios) ? req.body.horarios : falha(400, 'Envie a lista de horários.');
    for (const h of horarios) {
      const d = Number(h.dia_semana);
      if (!Number.isInteger(d) || d < 0 || d > 6) falha(400, 'Dia da semana inválido.');
      if (!agenda.horaValida(h.hora_inicio) || !agenda.horaValida(h.hora_fim) || h.hora_inicio >= h.hora_fim)
        falha(400, `Horário inválido na ${['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'][d]}.`);
    }
    const l = validarLoja({ duracao_consulta: req.body.duracao_consulta, vagas_por_horario: req.body.vagas_por_horario }, loja);
    await db.transacao(async (tx) => {
      await tx.run('DELETE FROM horarios_loja WHERE loja_id = ?', loja.id);
      for (const h of horarios)
        await tx.run('INSERT INTO horarios_loja (loja_id, dia_semana, hora_inicio, hora_fim) VALUES (?,?,?,?)', loja.id, Number(h.dia_semana), h.hora_inicio, h.hora_fim);
      await tx.run('UPDATE lojas SET duracao_consulta = ?, vagas_por_horario = ? WHERE id = ?', l.duracao_consulta, l.vagas_por_horario, loja.id);
    });
    await auditar(req.usuario.id, 'editar_horarios', 'unidade', loja.id, req.body);
    res.json({ ok: true });
  });

  app.get('/api/bloqueios', exigir('horarios'), async (req, res) => {
    const lojaId = lojaDoEscopo(req.usuario, req.query.loja_id);
    res.json(
      await db.all(
        `SELECT b.*, l.nome AS loja_nome FROM bloqueios_loja b JOIN lojas l ON l.id = b.loja_id
         WHERE b.data >= ? ${lojaId ? 'AND b.loja_id = ?' : ''} ORDER BY b.data, b.hora_inicio`,
        ...[agenda.hojeISO(agora()), lojaId].filter((v) => v !== null)
      )
    );
  });

  app.post('/api/bloqueios', exigir('horarios'), async (req, res) => {
    const lojaId = ehAdmin(req.usuario) ? Number(req.body.loja_id) : req.usuario.loja_id;
    if (!(await db.get('SELECT 1 FROM lojas WHERE id = ?', lojaId))) falha(400, 'Escolha a unidade.');
    const { data } = req.body;
    const hi = req.body.hora_inicio || '00:00';
    const hf = req.body.hora_fim || '23:59';
    if (!agenda.dataValida(data)) falha(400, 'Data inválida.');
    if (!agenda.horaValida(hi) || !agenda.horaValida(hf) || hi >= hf) falha(400, 'Horário inválido.');
    const id = (
      await db.run('INSERT INTO bloqueios_loja (loja_id, data, hora_inicio, hora_fim, motivo) VALUES (?,?,?,?,?)', lojaId, data, hi, hf, req.body.motivo || null)
    ).lastInsertRowid;
    await auditar(req.usuario.id, 'criar', 'bloqueio', id, req.body);
    const afetados = await db.all(
      `SELECT a.id, a.hora, c.nome AS cliente_nome FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id
       WHERE a.loja_id = ? AND a.data = ? AND a.status IN ('agendado','confirmado') AND a.hora >= ? AND a.hora < ?`,
      lojaId, data, hi, hf
    );
    res.status(201).json({ id, agendamentos_afetados: afetados });
  });

  app.delete('/api/bloqueios/:id', exigir('horarios'), async (req, res) => {
    const b = await db.get('SELECT * FROM bloqueios_loja WHERE id = ?', Number(req.params.id));
    if (!b || (!ehAdmin(req.usuario) && b.loja_id !== req.usuario.loja_id)) falha(404, 'Bloqueio não encontrado.');
    await db.run('DELETE FROM bloqueios_loja WHERE id = ?', b.id);
    await auditar(req.usuario.id, 'excluir', 'bloqueio', b.id, b);
    res.json({ ok: true });
  });

  // ---------- Usuários ----------
  // Usuário alvo está no escopo de quem o gerencia?
  const noEscopo = (eu, alvo) =>
    perfisGerenciaveis(eu).includes(alvo.perfil) && (ehAdmin(eu) || alvo.loja_id === eu.loja_id);

  app.get('/api/usuarios', exigir('usuarios'), async (req, res) => {
    const eu = req.usuario;
    const f = [];
    const p = [];
    if (!ehAdmin(eu)) {
      f.push('loja_id = ?');
      p.push(eu.loja_id);
    } else if (req.query.loja_id) {
      f.push('loja_id = ?');
      p.push(Number(req.query.loja_id));
    }
    if (req.query.perfil) {
      f.push('perfil = ?');
      p.push(req.query.perfil);
    }
    if (req.query.busca) {
      f.push('(nome LIKE ? OR email LIKE ?)');
      p.push(`%${req.query.busca}%`, `%${req.query.busca}%`);
    }
    const lista = await db.all(
      `SELECT * FROM usuarios ${f.length ? 'WHERE ' + f.join(' AND ') : ''} ORDER BY perfil = 'admin' DESC, nome LIMIT 500`,
      ...p
    );
    res.json(lista.map((u) => ({ ...usuarioPublico(u), editavel: u.id !== eu.id && noEscopo(eu, u) })));
  });

  const resolverLoja = async (eu, perfil, lojaId) => {
    if (perfil === 'admin') return null;
    const id = ehAdmin(eu) ? Number(lojaId) : eu.loja_id;
    if (!id || !(await db.get('SELECT 1 FROM lojas WHERE id = ?', id))) falha(400, 'Escolha a unidade deste usuário.');
    return id;
  };

  app.post('/api/usuarios', exigir('usuarios'), async (req, res) => {
    const eu = req.usuario;
    const perfil = req.body.perfil || 'atendente';
    if (!perfisGerenciaveis(eu).includes(perfil)) falha(403, 'Você não pode cadastrar usuários com este perfil.');
    const nome = String(req.body.nome || '').trim() || falha(400, 'Informe o nome.');
    const email = validarEmail(req.body.email);
    const senha = validarSenha(req.body.senha);
    if (await db.get('SELECT 1 FROM usuarios WHERE email = ?', email)) falha(409, 'Já existe um usuário com este e-mail.');
    const lojaId = await resolverLoja(eu, perfil, req.body.loja_id);
    const pode = ehAdmin(eu) ? !!req.body.pode_agendar : false;
    const id = (
      await db.run(
        'INSERT INTO usuarios (nome, email, senha_hash, telefone, perfil, loja_id, pode_agendar) VALUES (?,?,?,?,?,?,?)',
        nome, email, bcrypt.hashSync(senha, 10), req.body.telefone || null, perfil, lojaId, pode ? 1 : 0
      )
    ).lastInsertRowid;
    await auditar(eu.id, 'criar', 'usuario', id, { perfil, loja_id: lojaId, pode_agendar: pode });
    res.status(201).json(usuarioPublico(await db.get('SELECT * FROM usuarios WHERE id = ?', id)));
  });

  app.put('/api/usuarios/:id', exigir('usuarios'), async (req, res) => {
    const eu = req.usuario;
    const alvo = await db.get('SELECT * FROM usuarios WHERE id = ?', Number(req.params.id));
    if (!alvo || !noEscopo(eu, alvo)) falha(404, 'Usuário não encontrado.');
    if (alvo.id === eu.id) falha(400, 'Use "Meu perfil" para alterar seus próprios dados.');
    const perfil = req.body.perfil || alvo.perfil;
    if (!perfisGerenciaveis(eu).includes(perfil)) falha(403, 'Você não pode atribuir este perfil.');
    const nome = String(req.body.nome ?? alvo.nome).trim() || falha(400, 'Informe o nome.');
    const email = validarEmail(req.body.email ?? alvo.email);
    if (await db.get('SELECT 1 FROM usuarios WHERE email = ? AND id <> ?', email, alvo.id)) falha(409, 'Já existe um usuário com este e-mail.');
    const lojaId = await resolverLoja(eu, perfil, req.body.loja_id ?? alvo.loja_id);
    const ativo = req.body.ativo === undefined ? alvo.ativo : req.body.ativo ? 1 : 0;
    const pode = ehAdmin(eu) && req.body.pode_agendar !== undefined ? (req.body.pode_agendar ? 1 : 0) : alvo.pode_agendar;
    const hash = req.body.senha ? bcrypt.hashSync(validarSenha(req.body.senha), 10) : alvo.senha_hash;
    await db.run(
      'UPDATE usuarios SET nome=?, email=?, telefone=?, perfil=?, loja_id=?, pode_agendar=?, ativo=?, senha_hash=? WHERE id=?',
      nome, email, req.body.telefone ?? alvo.telefone, perfil, lojaId, pode, ativo, hash, alvo.id
    );
    if (!ativo || req.body.senha) await db.run('DELETE FROM sessoes WHERE usuario_id = ?', alvo.id);
    const { senha, ...semSenha } = req.body;
    await auditar(eu.id, 'editar', 'usuario', alvo.id, { ...semSenha, senha_alterada: !!senha });
    res.json(usuarioPublico(await db.get('SELECT * FROM usuarios WHERE id = ?', alvo.id)));
  });

  // ---------- Clientes ----------
  const exigirAgendar = [exigirLogin, (req, res, next) => (podeAgendar(req.usuario) ? next() : res.status(403).json({ erro: 'O administrador ainda não liberou a criação de agendamentos para você.' }))];

  app.get('/api/clientes', exigirAgendar, async (req, res) => {
    const termo = String(req.query.busca || '').trim();
    if (termo.length < 2) return res.json([]);
    const digitos = termo.replace(/\D/g, '');
    const porNumero = "OR replace(replace(replace(replace(telefone, '(', ''), ')', ''), ' ', ''), '-', '') LIKE ? OR cpf LIKE ?";
    res.json(
      await db.all(
        `SELECT * FROM clientes WHERE nome LIKE ? OR email LIKE ? ${digitos.length >= 4 ? porNumero : ''}
         ORDER BY nome LIMIT 30`,
        ...[`%${termo}%`, `%${termo}%`, ...(digitos.length >= 4 ? [`%${digitos}%`, `%${digitos}%`] : [])]
      )
    );
  });

  async function obterCliente(dbx, dados) {
    if (dados.crm_id) {
      const c = await dbx.get('SELECT * FROM clientes WHERE crm_id = ?', String(dados.crm_id));
      if (c) return c.id;
    }
    const digitos = String(dados.telefone || '').replace(/\D/g, '');
    if (digitos.length >= 8) {
      const final = digitos.slice(-8);
      const candidatos = await dbx.all('SELECT * FROM clientes WHERE telefone IS NOT NULL');
      const achado = candidatos.find((c) => String(c.telefone).replace(/\D/g, '').endsWith(final));
      if (achado) {
        if (dados.crm_id && !achado.crm_id) await dbx.run('UPDATE clientes SET crm_id = ? WHERE id = ?', String(dados.crm_id), achado.id);
        return achado.id;
      }
    }
    const nome = String(dados.nome || '').trim();
    if (!nome) falha(400, 'Informe o nome do cliente.');
    return (
      await dbx.run(
        'INSERT INTO clientes (nome, telefone, email, cpf, crm_id) VALUES (?,?,?,?,?)',
        nome, dados.telefone || null, dados.email || null, dados.cpf ? String(dados.cpf).replace(/\D/g, '') : null, dados.crm_id ? String(dados.crm_id) : null
      )
    ).lastInsertRowid;
  }

  // ---------- Horários livres ----------
  app.get('/api/horarios', exigirLogin, async (req, res) => {
    const { loja_id, data } = req.query;
    garantirLoja(req.usuario, loja_id);
    if (!agenda.dataValida(data)) falha(400, 'Data inválida.');
    res.json(await agenda.horariosLivres(db, { lojaId: Number(loja_id), data, agora: agora() }));
  });

  // ---------- Agendamentos ----------
  const SELECT_AG = `SELECT a.*, l.nome AS loja_nome, c.nome AS cliente_nome, c.telefone AS cliente_telefone,
      c.email AS cliente_email, c.crm_id AS cliente_crm_id, u.nome AS criado_por_nome
    FROM agendamentos a JOIN lojas l ON l.id = a.loja_id JOIN clientes c ON c.id = a.cliente_id
    LEFT JOIN usuarios u ON u.id = a.criado_por`;

  const escopo = (eu) => (ehAdmin(eu) ? ['1=1', []] : ['a.loja_id = ?', [eu.loja_id]]);

  async function buscarAgendamento(eu, id) {
    const [cond, p] = escopo(eu);
    const ag = await db.get(`${SELECT_AG} WHERE a.id = ? AND ${cond}`, Number(id), ...p);
    if (!ag) falha(404, 'Agendamento não encontrado.');
    return ag;
  }

  async function notificarCrm(evento, ag) {
    const url = await configuracao(db, 'saida_url');
    if (!url) return;
    await integracao.enviarEvento(db, evento, ag, { url, token: await configuracao(db, 'saida_token'), fetchImpl });
  }

  function filtrosAgendamento(eu, q) {
    const [cond, p] = escopo(eu);
    const f = [cond];
    const params = [...p];
    if (q.data_inicio) f.push('a.data >= ?') && params.push(q.data_inicio);
    if (q.data_fim) f.push('a.data <= ?') && params.push(q.data_fim);
    if (q.loja_id && ehAdmin(eu)) f.push('a.loja_id = ?') && params.push(Number(q.loja_id));
    if (q.origem) f.push('a.origem = ?') && params.push(q.origem);
    if (q.status) {
      const sts = String(q.status).split(',').filter((s) => STATUS.includes(s));
      if (sts.length) {
        f.push(`a.status IN (${sts.map(() => '?').join(',')})`);
        params.push(...sts);
      }
    }
    if (q.busca) {
      f.push('(c.nome LIKE ? OR c.telefone LIKE ?)');
      params.push(`%${q.busca}%`, `%${q.busca}%`);
    }
    return [f.join(' AND '), params];
  }

  app.get('/api/agendamentos', exigirLogin, async (req, res) => {
    const [where, params] = filtrosAgendamento(req.usuario, req.query);
    const ordem = req.query.ordem === 'desc' ? 'DESC' : 'ASC';
    res.json(await db.all(`${SELECT_AG} WHERE ${where} ORDER BY a.data ${ordem}, a.hora ${ordem}, a.id LIMIT 1000`, ...params));
  });

  // Contagem por dia (calendário) e por unidade (tela de seleção)
  const SOMAS = `COUNT(*) total, SUM(a.status = 'agendado') agendado, SUM(a.status = 'confirmado') confirmado,
      SUM(a.status = 'compareceu') compareceu, SUM(a.status = 'faltou') faltou, SUM(a.status = 'cancelado') cancelado`;

  app.get('/api/agendamentos/contagem', exigirLogin, async (req, res) => {
    const [where, params] = filtrosAgendamento(req.usuario, req.query);
    const por = req.query.por === 'unidade' ? 'unidade' : 'dia';
    const sql =
      por === 'dia'
        ? `SELECT a.data, ${SOMAS} FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id WHERE ${where} GROUP BY a.data ORDER BY a.data`
        : `SELECT a.loja_id, ${SOMAS} FROM agendamentos a JOIN clientes c ON c.id = a.cliente_id WHERE ${where} GROUP BY a.loja_id`;
    res.json(await db.all(sql, ...params));
  });

  app.get('/api/agendamentos/:id', exigirLogin, async (req, res) => res.json(await buscarAgendamento(req.usuario, req.params.id)));

  app.post('/api/agendamentos', exigirAgendar, async (req, res) => {
    const eu = req.usuario;
    const lojaId = ehAdmin(eu) ? Number(req.body.loja_id) : eu.loja_id;
    if (!(await db.get('SELECT 1 FROM lojas WHERE id = ? AND ativa = 1', lojaId))) falha(400, 'Escolha a unidade.');
    const { data, hora } = req.body;
    if (!agenda.dataValida(data) || !agenda.horaValida(hora)) falha(400, 'Escolha data e horário.');
    const encaixe = !!req.body.encaixe && (ehAdmin(eu) || eu.perfil === 'gerente');

    const id = await db.transacao(async (tx) => {
      const clienteId = req.body.cliente_id
        ? (await tx.get('SELECT id FROM clientes WHERE id = ?', Number(req.body.cliente_id)))?.id ?? falha(400, 'Cliente não encontrado.')
        : await obterCliente(tx, req.body.cliente || {});
      const jaTem = await tx.get(
        "SELECT 1 FROM agendamentos WHERE cliente_id = ? AND data = ? AND status IN ('agendado','confirmado')",
        clienteId, data
      );
      if (jaTem) falha(409, 'Este cliente já tem um agendamento nesta data.');
      if (!encaixe) {
        const livres = await agenda.horariosLivres(tx, { lojaId, data, agora: agora() });
        if (!livres.some((s) => s.hora === hora)) falha(409, 'Este horário não está disponível. Escolha outro.');
      }
      return (
        await tx.run(
          'INSERT INTO agendamentos (loja_id, cliente_id, data, hora, observacoes, origem, criado_por) VALUES (?,?,?,?,?,?,?)',
          lojaId, clienteId, data, hora, req.body.observacoes || null, 'sistema', eu.id
        )
      ).lastInsertRowid;
    });
    await auditar(eu.id, 'criar', 'agendamento', id, { loja_id: lojaId, data, hora, encaixe });
    const ag = await buscarAgendamento(eu, id);
    await notificarCrm('agendamento.criado', ag);
    res.status(201).json(ag);
  });

  const minutosAte = (ag) => {
    const [a, m, d] = ag.data.split('-').map(Number);
    const [hh, mm] = ag.hora.split(':').map(Number);
    return (new Date(a, m - 1, d, hh, mm) - agora()) / 60000;
  };

  // Para cada status: de quais status pode vir e quem pode aplicar
  const TRANSICOES = {
    confirmado: { de: ['agendado'], pode: () => true },
    compareceu: { de: ['agendado', 'confirmado', 'faltou'], pode: () => true },
    faltou: { de: ['agendado', 'confirmado', 'compareceu'], pode: () => true },
    cancelado: { de: ['agendado', 'confirmado'], pode: podeAgendar },
    agendado: { de: ['compareceu', 'faltou', 'cancelado'], pode: (u) => ehAdmin(u) || u.perfil === 'gerente' },
  };

  app.patch('/api/agendamentos/:id/status', exigirLogin, async (req, res) => {
    const eu = req.usuario;
    const ag = await buscarAgendamento(eu, req.params.id);
    const novo = req.body.status;
    const regra = TRANSICOES[novo] || falha(400, 'Status inválido.');
    if (!regra.pode(eu)) falha(403, 'Seu usuário não pode fazer esta alteração.');
    if (!regra.de.includes(ag.status)) falha(409, 'Não é possível fazer esta alteração no status atual.');
    if (novo === 'compareceu' && ag.data > agenda.hojeISO(agora())) falha(409, 'Só é possível marcar presença no dia do agendamento.');
    if (novo === 'faltou' && minutosAte(ag) > 0) falha(409, 'Só é possível marcar falta depois do horário agendado.');
    await db.run(
      "UPDATE agendamentos SET status = ?, motivo_cancelamento = ?, atualizado_em = datetime('now') WHERE id = ?",
      novo, novo === 'cancelado' ? req.body.motivo || null : ag.motivo_cancelamento, ag.id
    );
    await auditar(eu.id, 'status', 'agendamento', ag.id, { de: ag.status, para: novo, motivo: req.body.motivo });
    const atualizado = await buscarAgendamento(eu, ag.id);
    await notificarCrm(`agendamento.${novo}`, atualizado);
    res.json(atualizado);
  });

  app.put('/api/agendamentos/:id/remarcar', exigirAgendar, async (req, res) => {
    const eu = req.usuario;
    const ag = await buscarAgendamento(eu, req.params.id);
    if (!['agendado', 'confirmado'].includes(ag.status)) falha(409, 'Só agendamentos em aberto podem ser remarcados.');
    const { data, hora } = req.body;
    if (!agenda.dataValida(data) || !agenda.horaValida(hora)) falha(400, 'Escolha data e horário.');
    const encaixe = !!req.body.encaixe && (ehAdmin(eu) || eu.perfil === 'gerente');
    await db.transacao(async (tx) => {
      if (!encaixe) {
        const livres = await agenda.horariosLivres(tx, { lojaId: ag.loja_id, data, ignorarAgendamentoId: ag.id, agora: agora() });
        if (!livres.some((s) => s.hora === hora)) falha(409, 'Este horário não está disponível. Escolha outro.');
      }
      await tx.run("UPDATE agendamentos SET data = ?, hora = ?, status = 'agendado', atualizado_em = datetime('now') WHERE id = ?", data, hora, ag.id);
    });
    await auditar(eu.id, 'remarcar', 'agendamento', ag.id, { de: `${ag.data} ${ag.hora}`, para: `${data} ${hora}` });
    const atualizado = await buscarAgendamento(eu, ag.id);
    await notificarCrm('agendamento.remarcado', atualizado);
    res.json(atualizado);
  });

  // ---------- Relatórios ----------
  app.get('/api/relatorios/resumo', exigir('relatorios'), async (req, res) => {
    const eu = req.usuario;
    const hoje = agenda.hojeISO(agora());
    const inicio = agenda.dataValida(req.query.inicio) ? req.query.inicio : agenda.somarDias(hoje, -30);
    const fim = agenda.dataValida(req.query.fim) ? req.query.fim : hoje;
    const lojaId = lojaDoEscopo(eu, req.query.loja_id);
    const filtro = `a.data BETWEEN ? AND ? ${lojaId ? 'AND a.loja_id = ?' : ''}`;
    const p = lojaId ? [inicio, fim, lojaId] : [inicio, fim];
    res.json({
      inicio,
      fim,
      loja_id: lojaId,
      geral: await db.get(`SELECT ${SOMAS} FROM agendamentos a WHERE ${filtro}`, ...p),
      por_unidade: await db.all(
        `SELECT l.id, l.nome, ${SOMAS} FROM agendamentos a JOIN lojas l ON l.id = a.loja_id WHERE ${filtro} GROUP BY l.id ORDER BY total DESC`,
        ...p
      ),
      por_origem: await db.all(`SELECT a.origem, ${SOMAS} FROM agendamentos a WHERE ${filtro} GROUP BY a.origem`, ...p),
    });
  });

  // ---------- Integração com o CRM ----------
  const tokenEntrada = () => configuracao(db, 'entrada_token', novoToken);

  app.get('/api/integracao', exigir('integracao'), async (req, res) => {
    const origem = `${req.protocol}://${req.get('host')}`;
    res.json({
      url_entrada: `${origem}${WEBHOOK}?token=${await tokenEntrada()}`,
      saida_url: (await configuracao(db, 'saida_url')) || '',
      saida_token_definido: !!(await configuracao(db, 'saida_token')),
      eventos: await db.all('SELECT * FROM integracao_eventos ORDER BY id DESC LIMIT 50'),
    });
  });

  app.put('/api/integracao', exigir('integracao'), async (req, res) => {
    const url = String(req.body.saida_url || '').trim();
    if (url && !/^https:\/\/[^\s]+$/i.test(url)) falha(400, 'A URL de envio deve começar com https://');
    await definirConfiguracao(db, 'saida_url', url || null);
    if (req.body.saida_token !== undefined) await definirConfiguracao(db, 'saida_token', String(req.body.saida_token).trim() || null);
    await auditar(req.usuario.id, 'editar', 'integracao', null, { saida_url: url, token_alterado: req.body.saida_token !== undefined });
    res.json({ ok: true });
  });

  app.post('/api/integracao/novo-token', exigir('integracao'), async (req, res) => {
    await definirConfiguracao(db, 'entrada_token', novoToken());
    await auditar(req.usuario.id, 'novo_token', 'integracao');
    res.json({ ok: true });
  });

  app.post('/api/integracao/testar', exigir('integracao'), async (req, res) => {
    const url = await configuracao(db, 'saida_url');
    if (!url) falha(400, 'Configure a URL de envio primeiro.');
    const exemplo = {
      id: 0, id_externo: null, origem: 'sistema', status: 'agendado', data: agenda.hojeISO(agora()), hora: '10:00',
      loja_id: 0, loja_nome: 'Teste', cliente_id: 0, cliente_nome: 'Cliente de teste', cliente_telefone: '(00) 00000-0000',
    };
    res.json(await integracao.enviarEvento(db, 'teste', exemplo, { url, token: await configuracao(db, 'saida_token'), fetchImpl }));
  });

  // Recebe agendamentos feitos no CRM. Autenticado pelo token da URL (ou cabeçalho X-Webhook-Token).
  app.post(WEBHOOK, express.urlencoded({ extended: true }), async (req, res) => {
    const token = req.query.token || req.get('x-webhook-token');
    const esperado = await tokenEntrada();
    const ok = token && token.length === esperado.length && crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado));
    if (!ok) return res.status(401).json({ erro: 'Token inválido.' });

    const d = integracao.interpretarEntrada(req.body);
    const responder = async (status, corpo, sucesso) => {
      await integracao.registrar(db, 'entrada', d.cancelar ? 'cancelamento' : 'agendamento', sucesso, JSON.stringify({ resposta: corpo, recebido: req.body }));
      res.status(status).json(corpo);
    };
    try {
      const existente = d.id_externo
        ? await db.get("SELECT * FROM agendamentos WHERE origem = 'crm' AND id_externo = ?", String(d.id_externo))
        : null;

      if (d.cancelar) {
        if (!existente) return responder(404, { erro: 'Agendamento não encontrado para cancelar.' }, false);
        await db.run("UPDATE agendamentos SET status = 'cancelado', motivo_cancelamento = 'Cancelado no CRM', atualizado_em = datetime('now') WHERE id = ?", existente.id);
        return responder(200, { ok: true, agendamento_id: existente.id, status: 'cancelado' }, true);
      }

      if (!d.data || !d.hora) return responder(422, { erro: 'Envie data e hora do agendamento.' }, false);
      const lojas = await db.all('SELECT id, nome FROM lojas WHERE ativa = 1');
      const u = d.unidade !== undefined ? String(d.unidade).trim().toLowerCase() : null;
      const loja = u
        ? lojas.find((l) => String(l.id) === u) ||
          lojas.find((l) => l.nome.toLowerCase() === u) ||
          lojas.find((l) => l.nome.toLowerCase().includes(u))
        : lojas.length === 1
          ? lojas[0]
          : null;
      if (!loja) return responder(422, { erro: 'Unidade não encontrada. Envie "unidade" com o nome ou o código da unidade.' }, false);

      const id = await db.transacao(async (tx) => {
        const clienteId = await obterCliente(tx, d.cliente);
        if (existente) {
          await tx.run(
            `UPDATE agendamentos SET loja_id = ?, cliente_id = ?, data = ?, hora = ?, observacoes = COALESCE(?, observacoes),
             status = CASE WHEN status = 'cancelado' THEN 'agendado' ELSE status END, atualizado_em = datetime('now') WHERE id = ?`,
            loja.id, clienteId, d.data, d.hora, d.observacoes || null, existente.id
          );
          return existente.id;
        }
        return (
          await tx.run(
            "INSERT INTO agendamentos (loja_id, cliente_id, data, hora, observacoes, origem, id_externo) VALUES (?,?,?,?,?,'crm',?)",
            loja.id, clienteId, d.data, d.hora, d.observacoes || null, d.id_externo ? String(d.id_externo) : null
          )
        ).lastInsertRowid;
      });
      await auditar(null, existente ? 'atualizar_crm' : 'criar_crm', 'agendamento', id, { id_externo: d.id_externo });
      return responder(existente ? 200 : 201, { ok: true, agendamento_id: id, unidade: loja.nome, data: d.data, hora: d.hora }, true);
    } catch (e) {
      if (e instanceof ErroHttp) return responder(e.status === 400 ? 422 : e.status, { erro: e.message }, false);
      throw e;
    }
  });

  // ---------- Logs (somente administrador principal) ----------
  app.get('/api/auditoria', exigir('logs'), async (req, res) => {
    res.json(
      await db.all(
        `SELECT x.*, u.nome AS usuario_nome FROM auditoria x LEFT JOIN usuarios u ON u.id = x.usuario_id ORDER BY x.id DESC LIMIT 500`
      )
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
