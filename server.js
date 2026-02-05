const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const CARTOLA_BASE = "https://api.cartolafc.globo.com";

async function fetchJson(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} - ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function safeSend(res, data) {
  res.set("Cache-Control", "public, max-age=30");
  res.json(data);
}

app.get("/health", (req, res) => safeSend(res, { ok: true }));

app.get("/rodada", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/mercado/status`);
    safeSend(res, {
      rodada_atual: data.rodada_atual ?? null,
      status_mercado: data.status_mercado ?? null,
      temporada: data.temporada ?? null,
      bola_rolando: data.bola_rolando ?? null,
      nome_rodada: data.nome_rodada ?? null,
      fechamento: data.fechamento ?? null
    });
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /mercado/status", error: String(err.message || err) });
  }
});

app.get("/partidas", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/partidas`);
    const partidas = Array.isArray(data.partidas) ? data.partidas : (Array.isArray(data) ? data : []);
    safeSend(res, {
      partidas: partidas.map((p) => ({
        partida_id: p.partida_id ?? null,
        partida_data: p.partida_data ?? null,
        local: p.local ?? null,
        clube_casa_id: p.clube_casa_id ?? null,
        clube_visitante_id: p.clube_visitante_id ?? null,
        placar_oficial_mandante: p.placar_oficial_mandante ?? null,
        placar_oficial_visitante: p.placar_oficial_visitante ?? null,
        status_transmissao_tr: p.status_transmissao_tr ?? null,
        periodo_tr: p.periodo_tr ?? null,
        valida: p.valida ?? null
      }))
    });
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /partidas", error: String(err.message || err) });
  }
});

app.get("/clubes", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/clubes`);
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      out[k] = {
        id: v.id ?? null,
        nome: v.nome ?? null,
        abreviacao: v.abreviacao ?? null,
        nome_fantasia: v.nome_fantasia ?? null
      };
    }
    safeSend(res, out);
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /clubes", error: String(err.message || err) });
  }
});

app.get("/atletas/mercado-resumo", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/atletas/mercado`);
    const atletas = Array.isArray(data.atletas) ? data.atletas : [];
    safeSend(res, {
      rodada: data.rodada_atual ?? null,
      atletas: atletas.map((a) => ({
        atleta_id: a.atleta_id ?? null,
        apelido: a.apelido ?? null,
        nome: a.nome ?? null,
        clube_id: a.clube_id ?? null,
        posicao_id: a.posicao_id ?? null,
        status_id: a.status_id ?? null,
        preco_num: a.preco_num ?? null,
        media_num: a.media_num ?? null,
        jogos_num: a.jogos_num ?? null
      })),
      posicoes: data.posicoes ?? null,
      status: data.status ?? null
    });
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /atletas/mercado", error: String(err.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
