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

function formatFechamento(f) {
  if (!f || f.dia == null) return "indisponível";
  const dd = String(f.dia).padStart(2, "0");
  const mm = String(f.mes).padStart(2, "0");
  const yyyy = String(f.ano);
  const hh = String(f.hora).padStart(2, "0");
  const min = String(f.minuto).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function formatCartoleta(v) {
  if (typeof v !== "number") return "indisponível";
  // sempre com ponto, 2 casas
  return `C$ ${v.toFixed(2)}`;
}

function linhaJogador(p) {
  // linha 100% pronta para imprimir
  const nome = p?.nome ?? "indisponível";
  const time = p?.time ?? "indisponível";
  const casa_fora = p?.casa_fora ?? "indisponível";
  const preco = p?.preco ?? "indisponível";
  const motivo = p?.motivo ?? "indisponível";
  return `${nome} – ${time} – ${casa_fora} – ${preco} – ${motivo}`;
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
    res.status(502).json({ message: "Falha ao buscar /mercado/status", error: String(err?.message || err) });
  }
});

app.get("/partidas", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/partidas`);
    const partidas = Array.isArray(data?.partidas) ? data.partidas : (Array.isArray(data) ? data : []);
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
    res.status(502).json({ message: "Falha ao buscar /partidas", error: String(err?.message || err) });
  }
});

app.get("/clubes", async (req, res) => {
  try {
    const data = await fetchJson(`${CARTOLA_BASE}/clubes`);
    const out = {};
    for (const [k, v] of Object.entries(data || {})) {
      out[k] = {
        id: v?.id ?? null,
        nome: v?.nome ?? null,
        abreviacao: v?.abreviacao ?? null,
        nome_fantasia: v?.nome_fantasia ?? null
      };
    }
    safeSend(res, out);
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /clubes", error: String(err?.message || err) });
  }
});

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
        jogos_num: a?.jogos_num ?? null
      }))
    });
  } catch (err) {
    res.status(502).json({ message: "Falha ao buscar /atletas/mercado", error: String(err?.message || err) });
  }
});

app.get("/recomendar", async (req, res) => {
  try {
    const rodada = await fetchJson(`${CARTOLA_BASE}/mercado/status`);
    const partidasData = await fetchJson(`${CARTOLA_BASE}/partidas`);
    const clubesData = await fetchJson(`${CARTOLA_BASE}/clubes`);
    const mercado = await fetchJson(`${CARTOLA_BASE}/atletas/mercado`);

    const clubes = clubesData || {};
    const partidas = Array.isArray(partidasData?.partidas) ? partidasData.partidas : (Array.isArray(partidasData) ? partidasData : []);
    const atletas = Array.isArray(mercado?.atletas) ? mercado.atletas : [];

    const clubIsHome = new Map();
    for (const p of partidas) {
      if (p?.clube_casa_id) clubIsHome.set(p.clube_casa_id, true);
      if (p?.clube_visitante_id) clubIsHome.set(p.clube_visitante_id, false);
    }

    const existeStatus = atletas.some((a) => a?.status_id !== undefined && a?.status_id !== null);
    const elegiveis = existeStatus ? atletas.filter((a) => a.status_id === 7) : atletas;

    function score(a) {
      const home = clubIsHome.get(a?.clube_id) === true ? 1 : 0;
      const media = typeof a?.media_num === "number" ? a.media_num : 0;
      const preco = typeof a?.preco_num === "number" ? a.preco_num : 0;
      return home * 1000 + media * 10 + preco * 0.1;
    }

    function nomeClube(clubeId) {
      return clubes[String(clubeId)]?.nome_fantasia ?? "indisponível";
    }

    function casaFora(clubeId) {
      const v = clubIsHome.get(clubeId);
      return v === true ? "Casa" : v === false ? "Fora" : "indisponível";
    }

    function pickByPos(posicao_id, n) {
      return elegiveis
        .filter((a) => a?.posicao_id === posicao_id)
        .sort((a, b) => score(b) - score(a))
        .slice(0, n)
        .map((a) => {
          const clubeId = a?.clube_id ?? null;
          const nome = a?.apelido ?? a?.nome ?? "indisponível";
          const preco = formatCartoleta(a?.preco_num);
          const cf = clubeId ? casaFora(clubeId) : "indisponível";
          const time = clubeId ? nomeClube(clubeId) : "indisponível";
          const motivo = cf === "Casa" ? "Joga em casa" : "Boa opção";
          return { atleta_id: a?.atleta_id ?? null, nome, time, casa_fora: cf, preco, motivo };
        });
    }

    const goleiro = pickByPos(1, 1);
    const laterais = pickByPos(2, 2);
    const zagueiros = pickByPos(3, 2);
    const meias = pickByPos(4, 4);
    const atacantes = pickByPos(5, 2);

    const encerradas = partidas
      .filter((p) => p?.status_transmissao_tr === "ENCERRADA")
      .slice(0, 2)
      .map((p) => `${nomeClube(p.clube_casa_id)} x ${nomeClube(p.clube_visitante_id)}`);

    const resumo = [
      `Rodada atual: ${rodada?.rodada_atual ?? "indisponível"}`,
      `Status do mercado: ${rodada?.status_mercado ?? "indisponível"}`,
      `Bola rolando: ${rodada?.bola_rolando ?? "indisponível"}`,
      `Fechamento: ${formatFechamento(rodada?.fechamento)}`
    ];

    const jogos_ataque = encerradas.length ? encerradas : ["indisponível", "indisponível"];
    const jogos_defesa = encerradas.length ? encerradas : ["indisponível", "indisponível"];

    const defesa = [...laterais, ...zagueiros];

    // LINHAS PRONTAS (o GPT só imprime isso)
    const linhas_prontas = {
      resumo,
      jogos_ataque,
      jogos_defesa,
      goleiro: goleiro.length ? [linhaJogador(goleiro[0])] : ["indisponível"],
      defesa: defesa.map(linhaJogador),
      meio: meias.map(linhaJogador),
      ataque: atacantes.map(linhaJogador)
    };

    safeSend(res, {
      formacao: "4-4-2",
      criterio: existeStatus ? "status_id=7 + casa + media + preco" : "casa + media + preco",
      linhas_prontas
    });
  } catch (err) {
    res.status(502).json({ message: "Falha ao recomendar", error: String(err?.message || err) });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API rodando na porta ${PORT}`));
