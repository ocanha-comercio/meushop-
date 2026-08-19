// ============================================================
// INTEGRAÇÃO: MAGALU (MAGAZINE LUIZA) MARKETPLACE
// Documentação: https://api-marketplace.magazineluiza.com.br/doc
// ============================================================

const axios = require("axios");

const BASE_URL = "https://api-marketplace.magazineluiza.com.br";
const AUTH_URL = "https://id-marketplace.magazineluiza.com.br/oauth/token";

class Magalu {
  constructor() {
    this.clientId = process.env.MAGALU_CLIENT_ID;
    this.clientSecret = process.env.MAGALU_CLIENT_SECRET;
    this.accessToken = process.env.MAGALU_ACCESS_TOKEN;
    this.tenantId = process.env.MAGALU_TENANT_ID;
    this.tokenExpiry = 0;
  }

  // ─── Renovar Token OAuth ──────────────────────────────────
  async _refreshToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const { data } = await axios.post(AUTH_URL, new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }));

      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      console.log("[Magalu] Token renovado com sucesso");
      return this.accessToken;
    } catch (err) {
      console.error("[Magalu] Erro ao renovar token:", err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Requisição Autenticada ───────────────────────────────
  async _request(method, path, params = {}, body = null) {
    const token = await this._refreshToken();

    try {
      const config = {
        method,
        url: `${BASE_URL}${path}`,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          "X-Tenant-Id": this.tenantId,
        },
        params,
      };
      if (body) config.data = body;

      const { data } = await axios(config);
      return data;
    } catch (err) {
      console.error(`[Magalu] Erro em ${path}:`, err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Pedidos ──────────────────────────────────────────────
  async getOrders({ dateFrom, dateTo, offset = 0, limit = 50 } = {}) {
    const params = { _offset: offset, _limit: limit };

    if (dateFrom) params.created_at_from = dateFrom;
    if (dateTo) params.created_at_to = dateTo;

    const data = await this._request("GET", "/api/v1/orders", params);
    const orders = Array.isArray(data) ? data : data?.results || [];

    const pedidos = orders.map((o) => ({
      id: o.id || o.order_id,
      marketplace: "magalu",
      status: this._mapStatus(o.status),
      statusOriginal: o.status,
      data: o.created_at || o.date_created,
      cliente: {
        id: o.customer?.document || "N/A",
        nome: o.customer?.name || "Cliente Magalu",
        email: o.customer?.email || null,
      },
      itens: (o.items || []).map((item) => ({
        id: item.id || item.sku,
        titulo: item.description || item.title,
        quantidade: item.quantity,
        preco: parseFloat(item.price || 0),
        sku: item.sku,
      })),
      valorTotal: parseFloat(o.total_amount || o.total || 0),
      frete: o.shipping?.estimated_delivery || null,
      pagamento: o.payment_type || "N/A",
    }));

    return {
      total: data?.total || pedidos.length,
      pedidos,
    };
  }

  // ─── Produtos ─────────────────────────────────────────────
  async getProducts({ offset = 0, limit = 50 } = {}) {
    const data = await this._request("GET", "/api/v1/products", {
      _offset: offset,
      _limit: limit,
    });

    const items = Array.isArray(data) ? data : data?.results || [];

    const produtos = items.map((p) => ({
      id: p.id || p.sku,
      marketplace: "magalu",
      titulo: p.title || p.description,
      preco: parseFloat(p.price || 0),
      estoque: p.stock || p.available_stock || 0,
      status: p.active ? "active" : "inactive",
      categoria: p.category || null,
      imagem: p.images?.[0] || null,
      link: null,
      sku: p.sku,
      vendidos: 0,
    }));

    return { total: data?.total || produtos.length, produtos };
  }

  // ─── Faturamento ──────────────────────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo });
    const completados = orders.pedidos.filter(
      (p) => p.statusOriginal === "delivered" || p.statusOriginal === "shipped"
    );

    const receita = completados.reduce((sum, p) => sum + p.valorTotal, 0);
    const taxas = receita * 0.16; // Magalu cobra ~14-18%
    const lucroEstimado = receita - taxas;

    return {
      marketplace: "magalu",
      periodo: { de: dateFrom, ate: dateTo },
      receita,
      taxas,
      frete: 0,
      lucroEstimado,
      totalPedidos: orders.total,
      ticketMedio: completados.length > 0 ? receita / completados.length : 0,
    };
  }

  _mapStatus(status) {
    const map = {
      new: "Novo",
      approved: "Aprovado",
      shipped: "Enviado",
      delivered: "Entregue",
      canceled: "Cancelado",
      processing: "Processando",
      invoiced: "Faturado",
    };
    return map[status] || status;
  }
}

module.exports = new Magalu();
