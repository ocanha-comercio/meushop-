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

// Servir o painel direto do servidor (sem depender de arquivo estático)
const PANEL_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>MeuShop</title>
<script src="https://cdn.tailwindcss.com"><\/script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
body{margin:0;font-family:system-ui,sans-serif;background:#f8fafc}
.page{display:none}.page.active{display:block}
.nav-btn{transition:all .15s}.nav-btn.active{background:#eff6ff;color:#2563eb}
.card{background:#fff;border-radius:12px;border:1px solid #f1f5f9;box-shadow:0 1px 3px rgba(0,0,0,.04);padding:20px}
.badge{padding:2px 10px;border-radius:20px;font-size:12px;font-weight:500;display:inline-block}
.spinner{width:32px;height:32px;border:3px solid #e5e7eb;border-top-color:#3b82f6;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
table{width:100%;border-collapse:collapse;font-size:14px}
th{text-align:left;color:#94a3b8;font-weight:500;padding:8px 12px;border-bottom:1px solid #f1f5f9}
td{padding:10px 12px;border-bottom:1px solid #f8fafc}
tr:hover{background:#f8fafc}
</style>
</head>
<body>
<div class="flex h-screen overflow-hidden">
<aside class="w-52 bg-white border-r border-gray-100 flex flex-col shrink-0">
<div class="p-4 border-b border-gray-100 font-bold text-gray-800">&#128722; MeuShop</div>
<nav class="flex-1 p-2 space-y-1">
<button onclick="showPage('dashboard')" class="nav-btn active w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" data-page="dashboard">&#128202; Dashboard</button>
<button onclick="showPage('pedidos')" class="nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" data-page="pedidos">&#128230; Pedidos</button>
<button onclick="showPage('financeiro')" class="nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" data-page="financeiro">&#128176; Financeiro</button>
<button onclick="showPage('config')" class="nav-btn w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-gray-500 hover:bg-gray-50" data-page="config">&#9881; Config</button>
</nav>
</aside>
<main class="flex-1 overflow-y-auto p-6">
<div id="page-dashboard" class="page active max-w-7xl mx-auto space-y-6">
<div><h1 class="text-2xl font-bold text-gray-900">Dashboard</h1><p class="text-gray-500 mt-1">Dados consolidados dos marketplaces</p></div>
<div id="kpis" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Receita por Marketplace</h2><canvas id="chartReceita" height="200"></canvas></div>
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Status dos Marketplaces</h2><div id="mktStatus"></div></div>
</div>
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Pedidos Recentes</h2><div id="recentOrders"></div></div>
</div>
<div id="page-pedidos" class="page max-w-7xl mx-auto space-y-6">
<div><h1 class="text-2xl font-bold text-gray-900">Pedidos</h1><p class="text-gray-500 mt-1">Todos os pedidos consolidados</p></div>
<div id="orderFilters" class="flex gap-2 flex-wrap"></div>
<div class="card"><div id="allOrders"></div></div>
</div>
<div id="page-financeiro" class="page max-w-7xl mx-auto space-y-6">
<div><h1 class="text-2xl font-bold text-gray-900">Financeiro</h1></div>
<div id="finKpis" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
<div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Receita por Canal</h2><canvas id="chartPie" height="250"></canvas></div>
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Detalhamento</h2><div id="finDetail"></div></div>
</div>
</div>
<div id="page-config" class="page max-w-7xl mx-auto space-y-6">
<div><h1 class="text-2xl font-bold text-gray-900">Configuracoes</h1></div>
<div class="card"><h2 class="font-semibold text-gray-800 mb-4">Status das Integracoes</h2><div id="configStatus"></div></div>
<div class="card"><h2 class="font-semibold text-gray-800 mb-2">Limpar Cache</h2><p class="text-sm text-gray-500 mb-4">Buscar dados novos.</p>
<button onclick="fetch('/api/cache/clear',{method:'POST'}).then(function(){alert('Cache limpo!')})" class="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium">Limpar Cache</button></div>
</div>
</main>
</div>
<script>
var fmt=function(v){return(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})};
var fmtDate=function(d){return d?new Date(d).toLocaleDateString('pt-BR'):'-'};
var mi={mercadolivre:{l:'Mercado Livre',e:'ML',c:'#F59E0B'},shopee:{l:'Shopee',e:'SH',c:'#EA580C'},amazon:{l:'Amazon',e:'AZ',c:'#16A34A'},tiktok:{l:'TikTok Shop',e:'TK',c:'#7C3AED'},magalu:{l:'Magalu',e:'MG',c:'#2563EB'}};
var sc={Pago:'bg-teal-100 text-teal-700',Entregue:'bg-emerald-100 text-emerald-700',Enviado:'bg-blue-100 text-blue-700',Cancelado:'bg-red-100 text-red-700'};
function spin(){return '<div class="flex justify-center py-12"><div class="spinner"></div></div>'}
function showPage(id){document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});document.getElementById('page-'+id).classList.add('active');document.querySelectorAll('.nav-btn').forEach(function(b){b.classList.toggle('active',b.dataset.page===id)});if(id==='pedidos'&&!window._oL)loadOrders();if(id==='financeiro'&&!window._fL)loadFinancials();if(id==='config'&&!window._cL)loadConfig()}
function kpi(e,l,v,s,c){return '<div class="card"><div class="w-10 h-10 rounded-lg '+c+' flex items-center justify-center text-white text-lg mb-3">'+e+'</div><p class="text-2xl font-bold text-gray-900">'+v+'</p><p class="text-sm text-gray-500">'+l+'</p>'+(s?'<p class="text-xs text-gray-400 mt-1">'+s+'</p>':'')+'</div>'}
function oRow(o){var m=mi[o.marketplace]||{l:o.marketplace,e:'?'};var s=sc[o.status]||'bg-gray-100 text-gray-600';var t=(o.itens&&o.itens[0]&&o.itens[0].titulo)||'-';return '<tr><td class="font-mono text-xs">'+String(o.id).substring(0,16)+'</td><td><span class="badge bg-gray-100">'+m.e+'</span></td><td class="text-gray-600">'+t.substring(0,30)+(t.length>30?'...':'')+'</td><td class="font-semibold">'+fmt(o.valorTotal)+'</td><td><span class="badge '+s+'">'+o.status+'</span></td><td class="text-gray-500">'+fmtDate(o.data)+'</td></tr>'}
function oTable(os){if(!os.length)return '<p class="text-center text-gray-400 py-8">Nenhum pedido</p>';return '<div class="overflow-x-auto"><table><thead><tr><th>ID</th><th>Canal</th><th>Produto</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead><tbody>'+os.map(oRow).join('')+'</tbody></table></div>'}
function loadDashboard(){document.getElementById('kpis').innerHTML=spin();document.getElementById('recentOrders').innerHTML=spin();Promise.all([fetch('/api/dashboard').then(function(r){return r.json()}),fetch('/api/orders?limit=8').then(function(r){return r.json()})]).then(function(res){var d=res[0],o=res[1],k=d.kpis||{};document.getElementById('kpis').innerHTML=kpi('R$','Faturamento',fmt(k.receitaTotal),'Este mes','bg-blue-500')+kpi('#','Pedidos',k.totalPedidos||0,'Este mes','bg-violet-500')+kpi('%','Taxas',fmt(k.taxasTotal),'Comissoes','bg-amber-500')+kpi('$','Lucro',fmt(k.lucroEstimado),'Receita-taxas','bg-emerald-500');var ms=(d.porMarketplace||[]).filter(function(m){return !m.error});if(ms.length){try{new Chart(document.getElementById('chartReceita'),{type:'bar',data:{labels:ms.map(function(m){return(mi[m.marketplace]||{}).l||m.marketplace}),datasets:[{label:'Receita',data:ms.map(function(m){return m.receita||0}),backgroundColor:ms.map(function(m){return(mi[m.marketplace]||{}).c||'#94a3b8'}),borderRadius:6}]},options:{responsive:true,plugins:{legend:{display:false}},scales:{y:{ticks:{callback:function(v){return 'R$'+(v/1000).toFixed(0)+'k'}}}}}})}catch(e){}}var all=d.porMarketplace||[];document.getElementById('mktStatus').innerHTML=all.map(function(m){var i=mi[m.marketplace]||{l:m.marketplace,e:'?'};return '<div class="flex items-center justify-between p-3 rounded-lg bg-gray-50 mb-2"><span class="font-medium text-sm">'+i.l+'</span>'+(m.error?'<span class="text-xs text-red-500">Nao configurado</span>':'<div class="text-right"><p class="text-sm font-semibold">'+fmt(m.receita)+'</p><p class="text-xs text-gray-400">'+m.totalPedidos+' pedidos</p></div>')+'</div>'}).join('');document.getElementById('recentOrders').innerHTML=oTable(o.pedidos||[])}).catch(function(e){document.getElementById('kpis').innerHTML='<div class="col-span-4 text-center text-red-500 py-8">Erro: '+e.message+'</div>'})}
function loadOrders(m){window._oL=true;var u=m&&m!=='todos'?'/api/orders?marketplace='+m+'&limit=100':'/api/orders?limit=100';document.getElementById('allOrders').innerHTML=spin();var fs=['todos','mercadolivre','shopee','amazon','tiktok','magalu'];document.getElementById('orderFilters').innerHTML=fs.map(function(f){var a=(m||'todos')===f;var i=mi[f];var l=f==='todos'?'Todos':(i?i.l:f);return '<button onclick="loadOrders(\\''+f+'\\')\" class="px-3 py-2 rounded-lg text-sm font-medium '+(a?'bg-blue-600 text-white':'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50')+'">'+l+'</button>'}).join('');fetch(u).then(function(r){return r.json()}).then(function(d){document.getElementById('allOrders').innerHTML='<p class="text-sm text-gray-500 mb-3">'+(d.total||0)+' pedidos</p>'+oTable(d.pedidos||[])}).catch(function(e){document.getElementById('allOrders').innerHTML='<p class="text-red-500">Erro: '+e.message+'</p>'})}
function loadFinancials(){window._fL=true;document.getElementById('finKpis').innerHTML=spin();fetch('/api/financials').then(function(r){return r.json()}).then(function(d){var c=d.consolidado||{};document.getElementById('finKpis').innerHTML=kpi('R$','Receita Total',fmt(c.receita),'','bg-blue-500')+kpi('%','Taxas',fmt(c.taxas),'','bg-red-500')+kpi('$','Lucro',fmt(c.lucroEstimado),'','bg-emerald-500')+kpi('#','Pedidos',c.totalPedidos||0,'','bg-violet-500');var ms=(d.porMarketplace||[]).filter(function(m){return !m.error&&m.receita>0});if(ms.length){try{new Chart(document.getElementById('chartPie'),{type:'doughnut',data:{labels:ms.map(function(m){return(mi[m.marketplace]||{}).l||m.marketplace}),datasets:[{data:ms.map(function(m){return m.receita||0}),backgroundColor:ms.map(function(m){return(mi[m.marketplace]||{}).c||'#94a3b8'})}]},options:{responsive:true,plugins:{legend:{position:'bottom'}}}})}catch(e){}}var am=(d.porMarketplace||[]).filter(function(m){return !m.error});document.getElementById('finDetail').innerHTML=am.map(function(m){var i=mi[m.marketplace]||{l:m.marketplace};var mg=m.receita>0?((m.lucroEstimado/m.receita)*100).toFixed(1):'0';return '<div class="p-4 rounded-lg bg-gray-50 mb-3"><div class="flex items-center justify-between mb-2"><span class="font-medium">'+i.l+'</span><span class="font-bold">'+fmt(m.receita)+'</span></div><div class="grid grid-cols-3 gap-2 text-center text-xs"><div><p class="font-semibold text-red-500">'+fmt(m.taxas)+'</p><p class="text-gray-400">Taxas</p></div><div><p class="font-semibold text-emerald-600">'+fmt(m.lucroEstimado)+'</p><p class="text-gray-400">Lucro</p></div><div><p class="font-semibold text-blue-600">'+mg+'%</p><p class="text-gray-400">Margem</p></div></div></div>'}).join('')||'<p class="text-gray-400 text-center py-4">Sem dados</p>'}).catch(function(e){document.getElementById('finKpis').innerHTML='<div class="col-span-4 text-red-500 text-center">Erro: '+e.message+'</div>'})}
function loadConfig(){window._cL=true;fetch('/api/status').then(function(r){return r.json()}).then(function(d){var all=['mercadolivre','shopee','amazon','tiktok','magalu'];document.getElementById('configStatus').innerHTML=all.map(function(k){var a=d.marketplaces&&d.marketplaces.indexOf(k)>=0;var i=mi[k]||{l:k};return '<div class="flex items-center justify-between p-4 rounded-lg border border-gray-100 mb-2"><span class="font-medium">'+i.l+'</span><span class="badge '+(a?'bg-emerald-100 text-emerald-700':'bg-red-100 text-red-600')+'">'+(a?'Conectado':'Nao configurado')+'</span></div>'}).join('')}).catch(function(e){document.getElementById('configStatus').innerHTML='Erro: '+e.message})}
loadDashboard();
<\/script>
</body></html>`;

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-store");
  res.send(PANEL_HTML);
});

// ─── Carregar Integrações ───────────────────────────────────
const integrations = {};

// Só carrega se as credenciais principais existirem
const credCheck = {
  mercadolivre: () => process.env.ML_ACCESS_TOKEN && process.env.ML_SELLER_ID,
  shopee: () => process.env.SHOPEE_PARTNER_ID && process.env.SHOPEE_ACCESS_TOKEN,
  amazon: () => process.env.AMAZON_CLIENT_ID && process.env.AMAZON_REFRESH_TOKEN,
  tiktok: () => process.env.TIKTOK_APP_KEY && process.env.TIKTOK_ACCESS_TOKEN,
  magalu: () => process.env.MAGALU_CLIENT_ID && process.env.MAGALU_ACCESS_TOKEN,
};

const tryLoad = (name, file) => {
  try {
    if (credCheck[name] && !credCheck[name]()) {
      console.warn(`  ⏭️  ${name} — sem credenciais, pulando`);
      return;
    }
    integrations[name] = require(`./integrations/${file}`);
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.warn(`  ⚠️  ${name} — erro ao carregar`);
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

// Timeout de 15 segundos por marketplace
const safeCall = async (mkt, method, params) => {
  const integ = integrations[mkt];
  if (!integ?.[method]) return { error: `${mkt} indisponível` };
  try {
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 15000));
    return await Promise.race([integ[method](params), timeout]);
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

// ─── Iniciar ────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║       MEUSHOP v1.0 — Online!              ║
║  Acesse: http://localhost:${PORT}            ║
╚═══════════════════════════════════════════╝
  `);
});
