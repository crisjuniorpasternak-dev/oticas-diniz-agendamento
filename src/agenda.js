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
function horariosLivres(db, { lojaId, data, optometristaId = null, ignorarAgendamentoId = null, agora = new Date() }) {
  const loja = db.prepare('SELECT * FROM lojas WHERE id = ? AND ativa = 1').get(lojaId);
  if (!loja || !dataValida(data)) return [];
  const hoje = hojeISO(agora);
  if (data < hoje || data > somarDias(hoje, DIAS_ANTECEDENCIA_MAX)) return [];

  const disp = db
    .prepare(
      `SELECT d.*, u.nome FROM disponibilidades d
       JOIN usuarios u ON u.id = d.optometrista_id AND u.ativo = 1
       WHERE d.loja_id = ? AND d.dia_semana = ? ${optometristaId ? 'AND d.optometrista_id = ?' : ''}
       ORDER BY u.nome`
    )
    .all(...[lojaId, diaSemana(data), optometristaId].filter((v) => v !== null));

  const agoraMin = data === hoje ? agora.getHours() * 60 + agora.getMinutes() : -1;
  const abre = paraMin(loja.hora_abertura);
  const fecha = paraMin(loja.hora_fechamento);
  const dur = loja.duracao_consulta;

  const ocupadoStmt = db.prepare(
    `SELECT hora, duracao FROM agendamentos
     WHERE optometrista_id = ? AND data = ? AND status IN (${STATUS_ATIVOS.map(() => '?').join(',')})
       AND id IS NOT ?`
  );
  const bloqStmt = db.prepare('SELECT hora_inicio, hora_fim FROM bloqueios WHERE optometrista_id = ? AND data = ?');

  const porHora = new Map();
  for (const d of disp) {
    const ocupados = ocupadoStmt
      .all(d.optometrista_id, data, ...STATUS_ATIVOS, ignorarAgendamentoId)
      .map((a) => [paraMin(a.hora), paraMin(a.hora) + a.duracao]);
    const bloqueios = bloqStmt.all(d.optometrista_id, data).map((b) => [paraMin(b.hora_inicio), paraMin(b.hora_fim)]);
    const inicio = Math.max(paraMin(d.hora_inicio), abre);
    const fim = Math.min(paraMin(d.hora_fim), fecha);
    for (let t = inicio; t + dur <= fim; t += dur) {
      if (t <= agoraMin) continue;
      const conflita = (iv) => t < iv[1] && iv[0] < t + dur;
      if (ocupados.some(conflita) || bloqueios.some(conflita)) continue;
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
