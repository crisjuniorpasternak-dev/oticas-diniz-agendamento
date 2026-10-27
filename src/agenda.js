// Regras de agenda: geração de horários livres e validação de marcação.

const DIAS_ANTECEDENCIA_MAX = 60;
const STATUS_ATIVOS = ['agendado', 'confirmado', 'em_atendimento'];

const paraMin = (h) => {
  const [hh, mm] = h.split(':').map(Number);
  return hh * 60 + mm;
};
const paraHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function hojeISO(agora = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}`;
}

function diaSemana(dataISO) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return new Date(a, m - 1, d).getDay();
}

function dataValida(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
  const [a, m, d] = s.split('-').map(Number);
  const dt = new Date(a, m - 1, d);
  return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
}

const horaValida = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s || '');

function somarDias(dataISO, dias) {
  const [a, m, d] = dataISO.split('-').map(Number);
  return hojeISO(new Date(a, m - 1, d + dias));
}

// Retorna [{ hora, optometristas: [{id, nome}] }] com os horários livres de uma loja num dia.
async function horariosLivres(db, { lojaId, data, optometristaId = null, ignorarAgendamentoId = null, agora = new Date() }) {
  const loja = await db.get('SELECT * FROM lojas WHERE id = ? AND ativa = 1', lojaId);
  if (!loja || !dataValida(data)) return [];
  const hoje = hojeISO(agora);
  if (data < hoje || data > somarDias(hoje, DIAS_ANTECEDENCIA_MAX)) return [];

  const disp = await db.all(
    `SELECT d.*, u.nome FROM disponibilidades d
     JOIN usuarios u ON u.id = d.optometrista_id AND u.ativo = 1
     WHERE d.loja_id = ? AND d.dia_semana = ? ${optometristaId ? 'AND d.optometrista_id = ?' : ''}
     ORDER BY u.nome`,
    ...[lojaId, diaSemana(data), optometristaId].filter((v) => v !== null)
  );
  if (!disp.length) return [];

  // Consultas e bloqueios do dia de todos os optometristas envolvidos, em duas consultas só
  const ids = [...new Set(disp.map((d) => d.optometrista_id))];
  const marcas = ids.map(() => '?').join(',');
  const ocupados = await db.all(
    `SELECT optometrista_id, hora AS inicio, duracao FROM agendamentos
     WHERE optometrista_id IN (${marcas}) AND data = ? AND status IN (${STATUS_ATIVOS.map(() => '?').join(',')})
       AND id IS NOT ?`,
    ...ids, data, ...STATUS_ATIVOS, ignorarAgendamentoId
  );
  const bloqueios = await db.all(
    `SELECT optometrista_id, hora_inicio, hora_fim FROM bloqueios WHERE optometrista_id IN (${marcas}) AND data = ?`,
    ...ids, data
  );
  const intervalos = (optId) => [
    ...ocupados.filter((a) => a.optometrista_id === optId).map((a) => [paraMin(a.inicio), paraMin(a.inicio) + a.duracao]),
    ...bloqueios.filter((b) => b.optometrista_id === optId).map((b) => [paraMin(b.hora_inicio), paraMin(b.hora_fim)]),
  ];

  const agoraMin = data === hoje ? agora.getHours() * 60 + agora.getMinutes() : -1;
  const abre = paraMin(loja.hora_abertura);
  const fecha = paraMin(loja.hora_fechamento);
  const dur = loja.duracao_consulta;

  const porHora = new Map();
  for (const d of disp) {
    const ocupado = intervalos(d.optometrista_id);
    const inicio = Math.max(paraMin(d.hora_inicio), abre);
    const fim = Math.min(paraMin(d.hora_fim), fecha);
    for (let t = inicio; t + dur <= fim; t += dur) {
      if (t <= agoraMin) continue;
      if (ocupado.some((iv) => t < iv[1] && iv[0] < t + dur)) continue;
      const h = paraHora(t);
      if (!porHora.has(h)) porHora.set(h, []);
      const lista = porHora.get(h);
      if (!lista.some((o) => o.id === d.optometrista_id)) lista.push({ id: d.optometrista_id, nome: d.nome });
    }
  }
  return [...porHora.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hora, optometristas]) => ({ hora, optometristas }));
}

module.exports = {
  STATUS_ATIVOS,
  DIAS_ANTECEDENCIA_MAX,
  horariosLivres,
  hojeISO,
  dataValida,
  horaValida,
  paraMin,
  somarDias,
};
