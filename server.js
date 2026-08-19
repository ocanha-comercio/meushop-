// ============================================================
//  MEUSHOP — Servidor Unificado (API + Painel)
//  Tudo roda em uma URL só
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const path = require("path");
const NodeCache = require("node-cache");

const app = express();
const PORT = process.env.PORT || 3001;
const cache = new NodeCache({ stdTTL: 300 });

const axios = require("axios");

app.use(cors());
app.use(express.json());

// ─── OAuth Callback: Mercado Livre ──────────────────────────
// Quando o ML redireciona de volta com ?code=TG-..., esta rota
// troca o código por access_token automaticamente.
app.get("/auth/mercadolivre/callback", async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send("Código de autorização não encontrado.");

  try {
    const { data } = await axios.post("https://api.mercadolibre.com/oauth/token", {
      grant_type: "authorization_code",
      client_id: process.env.ML_CLIENT_ID,
      client_secret: process.env.ML_CLIENT_SECRET,
      code,
      redirect_uri: process.env.ML_REDIRECT_URI,
    });

    // Atualiza os tokens em memória
    if (integrations.mercadolivre) {
      integrations.mercadolivre.accessToken = data.access_token;
      integrations.mercadolivre.refreshToken = data.refresh_token;
    }

    res.send(`
      <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f0fdf4;padding:20px">
        <div style="background:white;padding:40px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1);max-width:700px;width:100%">
          <h1 style="color:#16a34a;text-align:center">✅ Mercado Livre Conectado!</h1>
          <p style="color:#64748b;text-align:center">Copie cada valor abaixo e adicione como variável no Railway.</p>

          <div style="margin:20px 0">
            <label style="font-weight:bold;font-size:14px;color:#1e293b">ML_ACCESS_TOKEN</label>
            <textarea id="at" readonly style="width:100%;height:80px;margin-top:4px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;word-break:break-all;resize:none">${data.access_token}</textarea>
            <button onclick="navigator.clipboard.writeText(document.getElementById('at').value);this.textContent='✅ Copiado!'" style="margin-top:4px;background:#3b82f6;color:white;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px">📋 Copiar Access Token</button>
          </div>

          <div style="margin:20px 0">
            <label style="font-weight:bold;font-size:14px;color:#1e293b">ML_REFRESH_TOKEN</label>
            <textarea id="rt" readonly style="width:100%;height:80px;margin-top:4px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:11px;word-break:break-all;resize:none">${data.refresh_token}</textarea>
            <button onclick="navigator.clipboard.writeText(document.getElementById('rt').value);this.textContent='✅ Copiado!'" style="margin-top:4px;background:#3b82f6;color:white;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px">📋 Copiar Refresh Token</button>
          </div>

          <div style="margin:20px 0">
            <label style="font-weight:bold;font-size:14px;color:#1e293b">ML_SELLER_ID</label>
            <input id="si" readonly value="${data.user_id}" style="width:100%;margin-top:4px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px" />
            <button onclick="navigator.clipboard.writeText(document.getElementById('si').value);this.textContent='✅ Copiado!'" style="margin-top:4px;background:#3b82f6;color:white;border:none;padding:6px 16px;border-radius:6px;cursor:pointer;font-size:13px">📋 Copiar Seller ID</button>
          </div>

          <p style="color:#ef4444;font-size:13px;text-align:center;margin-top:20px">⚠️ Copie os 3 valores e cole nas Variables do Railway. Depois o sistema reinicia e puxa seus dados reais.</p>
          <div style="text-align:center"><a href="/" style="display:inline-block;margin-top:12px;background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">Ir para o Painel →</a></div>
        </div>
      </body></html>
    `);
  } catch (err) {
    console.error("[ML OAuth] Erro:", err.response?.data || err.message);
    res.status(500).send(`
      <html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;background:#fef2f2">
        <div style="text-align:center;background:white;padding:40px;border-radius:16px;box-shadow:0 2px 8px rgba(0,0,0,0.1)">
          <h1 style="color:#dc2626">❌ Erro na Autorização</h1>
          <p style="color:#64748b">${err.response?.data?.message || err.message}</p>
          <p style="color:#64748b;font-size:14px">O código pode ter expirado. Tente autorizar novamente.</p>
          <a href="/auth/mercadolivre" style="display:inline-block;margin-top:16px;background:#3b82f6;color:white;padding:10px 24px;border-radius:8px;text-decoration:none">Tentar Novamente →</a>
        </div>
      </body></html>
    `);
  }
});

// ─── Iniciar OAuth do Mercado Livre ─────────────────────────
app.get("/auth/mercadolivre", (req, res) => {
  const authUrl = `https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=${process.env.ML_CLIENT_ID}&redirect_uri=${encodeURIComponent(process.env.ML_REDIRECT_URI)}`;
  res.redirect(authUrl);
});

// Servir o painel (frontend) na raiz
app.use(express.static(path.join(__dirname, "public")));

// ─── Carregar Integrações ───────────────────────────────────
const integrations = {};

const tryLoad = (name, file) => {
  try {
    integrations[name] = require(`./integrations/${file}`);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.warn(`  ⚠️  ${name} — não configurado`);
  }
};

console.log("\n  Carregando integrações...");
tryLoad("mercadolivre", "mercadolivre");
tryLoad("shopee", "shopee");
tryLoad("amazon", "amazon");
tryLoad("tiktok", "tiktok");
tryLoad("magalu", "magalu");

// ─── Helpers ────────────────────────────────────────────────
const getActive = () => Object.keys(integrations);

const withCache = async (key, fn) => {
  const c = cache.get(key);
  if (c) return c;
  const r = await fn();
  cache.set(key, r);
  return r;
};

const safeCall = async (mkt, method, params) => {
  const integ = integrations[mkt];
  if (!integ?.[method]) return { error: `${mkt} indisponível` };
  try {
    return await integ[method](params);
  } catch (err) {
    return { error: err.message, marketplace: mkt };
  }
};

// ============================================================
//  ROTAS DA API
// ============================================================

app.get("/api/status", (req, res) => {
  res.json({
    status: "online",
    marketplaces: getActive(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/dashboard", async (req, res) => {
  try {
    const result = await withCache("dashboard", async () => {
      const mkts = getActive();
      const now = new Date();
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const financials = await Promise.all(
        mkts.map((m) => safeCall(m, "getFinancials", { dateFrom: firstOfMonth, dateTo: now.toISOString() }))
      );
      const valid = financials.filter((f) => !f.error);
      return {
        kpis: {
          receitaTotal: valid.reduce((s, f) => s + (f.receita || 0), 0),
          totalPedidos: valid.reduce((s, f) => s + (f.totalPedidos || 0), 0),
          taxasTotal: valid.reduce((s, f) => s + (f.taxas || 0), 0),
          lucroEstimado: valid.reduce((s, f) => s + (f.lucroEstimado || 0), 0),
          ticketMedio: valid.reduce((s, f) => s + (f.ticketMedio || 0), 0) / (valid.length || 1),
        },
        porMarketplace: financials.map((f, i) => ({ marketplace: mkts[i], ...(f.error ? { error: f.error } : f) })),
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/orders", async (req, res) => {
  try {
    const { marketplace, dateFrom, dateTo, limit } = req.query;
    const targets = marketplace ? [marketplace] : getActive();
    const results = await Promise.all(
      targets.map((m) => safeCall(m, "getOrders", { dateFrom, dateTo, limit: parseInt(limit) || 50 }))
    );
    const allOrders = results.filter((r) => !r.error).flatMap((r) => r.pedidos || []).sort((a, b) => new Date(b.data) - new Date(a.data));
    const totalByMkt = {};
    results.forEach((r, i) => { totalByMkt[targets[i]] = r.error ? { error: r.error } : { total: r.total }; });
    res.json({ total: allOrders.length, totalByMarketplace: totalByMkt, pedidos: allOrders });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const { marketplace, limit } = req.query;
    const targets = marketplace ? [marketplace] : getActive();
    const results = await Promise.all(targets.map((m) => safeCall(m, "getProducts", { limit: parseInt(limit) || 50 })));
    const allProducts = results.filter((r) => !r.error).flatMap((r) => r.produtos || []);
    res.json({ total: allProducts.length, produtos: allProducts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/financials", async (req, res) => {
  try {
    const { dateFrom, dateTo } = req.query;
    const mkts = getActive();
    const results = await Promise.all(mkts.map((m) => safeCall(m, "getFinancials", { dateFrom, dateTo })));
    const valid = results.filter((r) => !r.error);
    res.json({
      consolidado: {
        receita: valid.reduce((s, r) => s + (r.receita || 0), 0),
        taxas: valid.reduce((s, r) => s + (r.taxas || 0), 0),
        lucroEstimado: valid.reduce((s, r) => s + (r.lucroEstimado || 0), 0),
        totalPedidos: valid.reduce((s, r) => s + (r.totalPedidos || 0), 0),
      },
      porMarketplace: results.map((r, i) => ({ marketplace: mkts[i], ...(r.error ? { error: r.error } : r) })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/customers", async (req, res) => {
  try {
    const result = await withCache("customers", async () => {
      const mkts = getActive();
      const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const results = await Promise.all(mkts.map((m) => safeCall(m, "getOrders", { dateFrom: ninetyDaysAgo, limit: 100 })));
      const clientMap = {};
      for (const r of results.filter((r) => !r.error)) {
        for (const p of r.pedidos || []) {
          const key = p.cliente.email || p.cliente.nome;
          if (!clientMap[key]) clientMap[key] = { ...p.cliente, totalGasto: 0, pedidos: 0, marketplaces: new Set(), ultimaCompra: p.data };
          clientMap[key].totalGasto += p.valorTotal;
          clientMap[key].pedidos += 1;
          clientMap[key].marketplaces.add(p.marketplace);
          if (new Date(p.data) > new Date(clientMap[key].ultimaCompra)) clientMap[key].ultimaCompra = p.data;
        }
      }
      return {
        total: Object.keys(clientMap).length,
        clientes: Object.values(clientMap).map((c) => ({
          ...c, marketplaces: [...c.marketplaces],
          ticketMedio: c.pedidos > 0 ? c.totalGasto / c.pedidos : 0,
          status: c.totalGasto > 5000 ? "VIP" : c.pedidos > 3 ? "Ativo" : c.pedidos === 1 ? "Novo" : "Regular",
        })).sort((a, b) => b.totalGasto - a.totalGasto),
      };
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/cache/clear", (req, res) => {
  cache.flushAll();
  res.json({ message: "Cache limpo" });
});

// Qualquer rota não-API serve o painel
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ─── Iniciar ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║       MEUSHOP v1.0 — Online!              ║
║  Acesse: http://localhost:${PORT}            ║
╚═══════════════════════════════════════════╝
  `);
});
