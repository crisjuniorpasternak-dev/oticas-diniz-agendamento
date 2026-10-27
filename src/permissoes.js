// Hierarquia de acessos. Cada perfil tem um conjunto fixo de permissões;
// o escopo (rede inteira, uma loja ou só os próprios dados) é aplicado nas rotas.

const PERFIS = {
  admin: { nivel: 5, rotulo: 'Administrador da rede', escopo: 'rede' },
  gerente: { nivel: 4, rotulo: 'Gerente de loja', escopo: 'loja' },
  atendente: { nivel: 3, rotulo: 'Atendente / recepção', escopo: 'loja' },
  optometrista: { nivel: 2, rotulo: 'Optometrista', escopo: 'proprio' },
  cliente: { nivel: 1, rotulo: 'Cliente', escopo: 'proprio' },
};

const PERMISSOES = {
  admin: [
    'lojas.gerenciar',
    'usuarios.gerenciar',
    'agenda.configurar',
    'agendamentos.ver',
    'agendamentos.criar',
    'agendamentos.alterar',
    'exames.ver',
    'clientes.ver',
    'clientes.cadastrar',
    'relatorios.ver',
    'auditoria.ver',
  ],
  gerente: [
    'usuarios.gerenciar',
    'agenda.configurar',
    'agendamentos.ver',
    'agendamentos.criar',
    'agendamentos.alterar',
    'clientes.ver',
    'clientes.cadastrar',
    'relatorios.ver',
  ],
  atendente: [
    'agendamentos.ver',
    'agendamentos.criar',
    'agendamentos.alterar',
    'clientes.ver',
    'clientes.cadastrar',
  ],
  optometrista: ['agendamentos.ver', 'agenda.bloquear_propria', 'exames.registrar', 'exames.ver'],
  cliente: ['agendamentos.proprios', 'exames.proprios'],
};

// Perfis que cada perfil pode criar/editar
const PODE_GERENCIAR = {
  admin: ['admin', 'gerente', 'atendente', 'optometrista', 'cliente'],
  gerente: ['atendente', 'optometrista', 'cliente'],
  atendente: ['cliente'],
  optometrista: [],
  cliente: [],
};

const tem = (usuario, permissao) => !!usuario && (PERMISSOES[usuario.perfil] || []).includes(permissao);

module.exports = { PERFIS, PERMISSOES, PODE_GERENCIAR, tem };
