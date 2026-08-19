// ============================================================
// INTEGRAÇÃO: MERCADO LIVRE
// Documentação: https://developers.mercadolivre.com.br/pt_br/api-docs
// ============================================================

const axios = require("axios");

const BASE_URL = "https://api.mercadolibre.com";

class MercadoLivre {
  constructor() {
    this.accessToken = process.env.ML_ACCESS_TOKEN;
    this.refreshToken = process.env.ML_REFRESH_TOKEN;
    this.clientId = process.env.ML_CLIENT_ID;
    this.clientSecret = process.env.ML_CLIENT_SECRET;
    this.sellerId = process.env.ML_SELLER_ID;
  }

  // Cliente HTTP com token
  get api() {
    return axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });
  }

  // ─── Renovar Token ────────────────────────────────────────
  async refreshAccessToken() {
    try {
      const { data } = await axios.post(`${BASE_URL}/oauth/token`, {
        grant_type: "refresh_token",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
      });
      this.accessToken = data.access_token;
      this.refreshToken = data.refresh_token;
      console.log("[ML] Token renovado com sucesso");
      return data;
    } catch (err) {
      console.error("[ML] Erro ao renovar token:", err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Dados do Vendedor ────────────────────────────────────
  async getSeller() {
    try {
      const { data } = await this.api.get("/users/me");
      return {
        id: data.id,
        nome: data.nickname,
        reputacao: data.seller_reputation?.level_id,
        transacoes: data.seller_reputation?.transactions?.completed,
      };
    } catch (err) {
      if (err.response?.status === 401) {
        await this.refreshAccessToken();
        return this.getSeller();
      }
      throw err;
    }
  }

  // ─── Pedidos ──────────────────────────────────────────────
  async getOrders({ offset = 0, limit = 50, dateFrom, dateTo } = {}) {
    try {
      const params = {
        seller: this.sellerId,
        offset,
        limit,
        sort: "date_desc",
      };
      if (dateFrom) params["order.date_created.from"] = dateFrom;
      if (dateTo) params["order.date_created.to"] = dateTo;

      const { data } = await this.api.get("/orders/search", { params });

      return {
        total: data.paging.total,
        pedidos: data.results.map((o) => ({
          id: o.id,
          marketplace: "mercadolivre",
          status: this._mapStatus(o.status),
          statusOriginal: o.status,
          data: o.date_created,
          cliente: {
            id: o.buyer.id,
            nome: `${o.buyer.first_name} ${o.buyer.last_name}`,
            email: o.buyer.email,
          },
          itens: o.order_items.map((item) => ({
            id: item.item.id,
            titulo: item.item.title,
            quantidade: item.quantity,
            preco: item.unit_price,
            sku: item.item.seller_sku,
          })),
          valorTotal: o.total_amount,
          frete: o.shipping?.id || null,
          pagamento: o.payments?.[0]?.payment_type || "N/A",
        })),
      };
    } catch (err) {
      if (err.response?.status === 401) {
        await this.refreshAccessToken();
        return this.getOrders({ offset, limit, dateFrom, dateTo });
      }
      throw err;
    }
  }

  // ─── Produtos / Anúncios ─────────────────────────────────
  async getProducts({ offset = 0, limit = 50 } = {}) {
    try {
      const { data: ids } = await this.api.get(`/users/${this.sellerId}/items/search`, {
        params: { offset, limit },
      });

      if (!ids.results.length) return { total: ids.paging.total, produtos: [] };

      // Busca detalhes em lote (até 20 por vez)
      const batches = [];
      for (let i = 0; i < ids.results.length; i += 20) {
        batches.push(ids.results.slice(i, i + 20));
      }

      const produtos = [];
      for (const batch of batches) {
        const { data } = await this.api.get("/items", {
          params: { ids: batch.join(",") },
        });
        for (const item of data) {
          if (item.code === 200) {
            const p = item.body;
            produtos.push({
              id: p.id,
              marketplace: "mercadolivre",
              titulo: p.title,
              preco: p.price,
              estoque: p.available_quantity,
              status: p.status,
              categoria: p.category_id,
              imagem: p.pictures?.[0]?.url,
              link: p.permalink,
              sku: p.seller_custom_field,
              vendidos: p.sold_quantity,
            });
          }
        }
      }

      return { total: ids.paging.total, produtos };
    } catch (err) {
      if (err.response?.status === 401) {
        await this.refreshAccessToken();
        return this.getProducts({ offset, limit });
      }
      throw err;
    }
  }

  // ─── Faturamento / Financeiro ─────────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    try {
      // Busca pedidos pagos no período para calcular faturamento
      const orders = await this.getOrders({ dateFrom, dateTo, limit: 50 });
      const pagos = orders.pedidos.filter(
        (p) => p.statusOriginal === "paid" || p.statusOriginal === "shipped"
      );

      const receita = pagos.reduce((sum, p) => sum + p.valorTotal, 0);
      const taxas = receita * 0.13; // ML cobra ~11-16% de comissão
      const frete = pagos.length * 15; // estimativa
      const lucroEstimado = receita - taxas - frete;

      return {
        marketplace: "mercadolivre",
        periodo: { de: dateFrom, ate: dateTo },
        receita,
        taxas,
        frete,
        lucroEstimado,
        totalPedidos: orders.total,
        ticketMedio: pagos.length > 0 ? receita / pagos.length : 0,
      };
    } catch (err) {
      throw err;
    }
  }

  // ─── Mapear Status Padrão ─────────────────────────────────
  _mapStatus(status) {
    const map = {
      confirmed: "Confirmado",
      payment_required: "Aguardando Pagamento",
      payment_in_process: "Pagamento em Análise",
      paid: "Pago",
      partially_paid: "Parcialmente Pago",
      shipped: "Enviado",
      delivered: "Entregue",
      cancelled: "Cancelado",
    };
    return map[status] || status;
  }
}

module.exports = new MercadoLivre();
