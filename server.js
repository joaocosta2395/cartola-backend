const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// Base oficial
const CARTOLA_BASE = "https://api.cartolafc.globo.com";

// Helper: fetch com timeout
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

// Helper: resposta segura + cache curto
function safeSend(res, data) {
  res.set("Cache-Control", "public, max-age=30"); // 30s
  res.json(data);
}

// 1) health
app.get("/health", (req, res) => safeSend(res, { ok: true }));

// 2) rodada (compacto)
app.get("/rodada", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/mercado/status`);
    safeSend(res, {
      rodada_atual: data.rodada_atual ?? null,
      status_mercado: data.status_mercado ?? null,
      temporada: data.temporada ?? null,
      bola_rolando: data.bola_rolando ?? null,
      nome_rodada: data.nome_rodada ?? null,
      fechamento: data.fechamento ?? null,
    });
  } catch (err) {
    res.status(502).json({
      message: "Falha ao buscar /mercado/status",
      error: String(err?.message || err),
    });
  }
});

// 3) partidas (compacto)
app.get("/partidas", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/partidas`);
    const partidas = Array.isArray(data?.partidas)
      ? data.partidas
      : Array.isArray(data)
      ? data
      : [];

    const compact = partidas.map((p) => ({
      partida_id: p.partida_id ?? null,
      partida_data: p.partida_data ?? null,
      local: p.local ?? null,
      clube_casa_id: p.clube_casa_id ?? null,
      clube_visitante_id: p.clube_visitante_id ?? null,
      placar_oficial_mandante: p.placar_oficial_mandante ?? null,
      placar_oficial_visitante: p.placar_oficial_visitante ?? null,
      status_transmissao_tr: p.status_transmissao_tr ?? null,
      periodo_tr: p.periodo_tr ?? null,
      valida: p.valida ?? null,
    }));

    safeSend(res, { partidas: compact });
  } catch (err) {
    res.status(502).json({
      message: "Falha ao buscar /partidas",
      error: String(err?.message || err),
    });
  }
});

// 4) clubes (compacto)
app.get("/clubes", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/clubes`);
    const out = {};

    for (const [k, v] of Object.entries(data || {})) {
      out[k] = {
        id: v?.id ?? null,
        nome: v?.nome ?? null,
        abreviacao: v?.abreviacao ?? null,
        nome_fantasia: v?.nome_fantasia ?? null,
      };
    }

    safeSend(res, out);
  } catch (err) {
    res.status(502).json({
      message: "Falha ao buscar /clubes",
      error: String(err?.message || err),
    });
  }
});

/**
 * 5) atletas/mercado-resumo (PAGINADO + FILTRÁVEL) -> NÃO ESTOURA MAIS
 *
 * Query params:
 * - limit (default 100, max 200)
 * - offset (default 0)
 * - posicao_id (opcional)
 * - status_id (opcional)
 *
 * Exemplos:
 * /atletas/mercado-resumo?limit=50
 * /atletas/mercado-resumo?posicao_id=5&limit=100
 * /atletas/mercado-resumo?posicao_id=1&status_id=7&limit=80
 */
app.get("/atletas/mercado-resumo", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/atletas/mercado`);
    const atletas = Array.isArray(data?.atletas) ? data.atletas : [];

    const posicaoId = req.query.posicao_id ? Number(req.query.posicao_id) : null;
    const statusId = req.query.status_id ? Number(req.query.status_id) : null;

    let filtrados = atletas;
    if (posicaoId) filtrados = filtrados.filter((a) => a.posicao_id === posicaoId);
    if (statusId) filtrados = filtrados.filter((a) => a.status_id === statusId);

    const limitRaw = req.query.limit ? Number(req.query.limit) : 100;
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 100;

    const offsetRaw = req.query.offset ? Number(req.query.offset) : 0;
    const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;

    const page = filtrados.slice(offset, offset + limit);

    safeSend(res, {
      rodada: data?.rodada_atual ?? null,
      total: filtrados.length,
      limit,
      offset,
      atletas: page.map((a) => ({
        atleta_id: a?.atleta_id ?? null,
        apelido: a?.apelido ?? null,
        nome: a?.nome ?? null,
        clube_id: a?.clube_id ?? null,
        posicao_id: a?.posicao_id ?? null,
        status_id: a?.status_id ?? null,
        preco_num: a?.preco_num ?? null,
        media_num: a?.media_num ?? null,
        jogos_num: a?.jogos_num ?? null,
      })),
    });
  } catch (err) {
    res.status(502).json({
      message: "Falha ao buscar /atletas/mercado",
      error: String(err?.message || err),
    });
  }
});

/**
 * 6) recomendar (LEVE) -> devolve só 11 jogadores (4-4-2)
 * Sem baixar a lista inteira no GPT.
 *
 * Heurística simples:
 * - se status_id existir, prioriza status_id = 7 (provável) (se esse id não bater, você troca depois)
 * - prioriza quem joga em casa
 * - depois media_num e preco_num
 */
app.get("/recomendar", async (req, res) => {
  try {
    const mercado = await fetchJson(`${CARTOLA_BASE}/atletas/mercado`);
    const partidasData = await fetchJson(`${CARTOLA_BASE}/partidas`);
    const clubesData = await fetchJson(`${CARTOLA_BASE}/clubes`);

    const atletas = Array.isArray(mercado?.atletas) ? mercado.atletas : [];
    const partidas = Array.isArray(partidasData?.partidas)
      ? partidasData.partidas
      : Array.isArray(partidasData)
      ? partidasData
      : [];

    const clubes = clubesData || {};

    // mapa clube -> casa/fora
    const clubIsHome = new Map();
    for (const p of partidas) {
      if (p?.clube_casa_id) clubIsHome.set(p.clube_casa_id, true);
      if (p?.clube_visitante_id) clubIsHome.set(p.clube_visitante_id, false);
    }

    // filtro "provável" se existir status
    const existeStatus = atletas.some((a) => a?.status_id !== undefined && a?.status_id !== null);
    const elegiveis = existeStatus ? atletas.filter((a) => a.status_id === 7) : atletas;

    function score(a) {
      const home = clubIsHome.get(a?.clube_id) === true ? 1 : 0;
      const media = typeof a?.media_num === "number" ? a.media_num : 0;
      const preco = typeof a?.preco_num === "number" ? a.preco_num : 0;
      return home * 1000 + media * 10 + preco * 0.1;
    }

    function pickByPos(posicao_id, n) {
      return elegiveis
        .filter((a) => a?.posicao_id === posicao_id)
        .sort((a, b) => score(b) - score(a))
        .slice(0, n)
        .map((a) => {
          const casa = clubIsHome.get(a?.clube_id);
          return {
            atleta_id: a?.atleta_id ?? null,
            nome: a?.apelido ?? a?.nome ?? null,
            clube_id: a?.clube_id ?? null,
            clube: clubes[String(a?.clube_id)]?.nome_fantasia ?? "indisponível",
            casa_fora: casa === true ? "Casa" : casa === false ? "Fora" : "indisponível",
            preco: a?.preco_num ?? null,
            motivo: casa === true ? "Joga em casa" : "Boa opção",
          };
        });
    }

    // Posições comuns do Cartola:
    // 1 GOL, 2 LAT, 3 ZAG, 4 MEI, 5 ATA
    const time = {
      goleiro: pickByPos(1, 1),
      laterais: pickByPos(2, 2),
      zagueiros: pickByPos(3, 2),
      meias: pickByPos(4, 4),
      atacantes: pickByPos(5, 2),
    };

    safeSend(res, {
      rodada: mercado?.rodada_atual ?? null,
      formacao: "4-4-2",
      criterio: existeStatus ? "status_id=7 + casa + media + preco" : "casa + media + preco",
      time,
    });
  } catch (err) {
    res.status(502).json({
      message: "Falha ao recomendar",
      error: String(err?.message || err),
    });
  }
});

// Porta do Render / local
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
