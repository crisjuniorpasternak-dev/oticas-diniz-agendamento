process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const path = require('path');
const { abrir, popularDemo } = require('./db');
const { criarApp } = require('./app');

const arquivo = process.env.DB_FILE || path.join(__dirname, '..', 'dados', 'agendamentos.db');
const db = abrir(arquivo);
if (process.env.SEM_DEMO !== '1' && popularDemo(db)) {
  console.log('Banco criado com dados de demonstração (senha de todos os usuários: diniz123).');
}

const porta = Number(process.env.PORT || 3000);
criarApp(db).listen(porta, () => console.log(`Óticas Diniz – Agendamentos rodando em http://localhost:${porta}`));
