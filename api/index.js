// Entrada da Vercel: todas as rotas /api/* chegam aqui (ver vercel.json).
process.env.TZ = process.env.TZ || 'America/Sao_Paulo';
const { prepararBanco } = require('../src/db');
const { criarApp } = require('../src/rotas');

let pronto;
module.exports = async (req, res) => {
  pronto ||= prepararBanco().then((db) => criarApp(db).set('trust proxy', 1));
  try {
    const app = await pronto;
    return app(req, res);
  } catch (e) {
    pronto = null;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ erro: 'Banco de dados indisponível. Verifique a configuração do Turso.' }));
  }
};
