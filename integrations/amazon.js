// ============================================================
// INTEGRAÇÃO: AMAZON SELLER (SP-API)
// Documentação: https://developer-docs.amazon.com/sp-api/
// ============================================================

const axios = require("axios");

const LWA_URL = "https://api.amazon.com/auth/o2/token";
const BASE_URL = "https://sellingpartnerapi-na.amazon.com";

class Amazon {
  constructor() {
    this.clientId = process.env.AMAZON_CLIENT_ID;
    this.clientSecret = process.env.AMAZON_CLIENT_SECRET;
    this.refreshToken = process.env.AMAZON_REFRESH_TOKEN;
    this.marketplaceId = process.env.AMAZON_MARKETPLACE_ID || "A2Q3Y263D00KWC"; // Brasil
    this.accessToken = null;
    this.tokenExpiry = 0;
  }

  // ─── Obter Access Token via LWA ──────────────────────────
  async _getAccessToken() {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const { data } = await axios.post(LWA_URL, new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.refreshToken,
        client_id: this.clientId,
        client_secret: this.clientSecret,
      }));

      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in - 60) * 1000;
      console.log("[Amazon] Token LWA obtido com sucesso");
      return this.accessToken;
    } catch (err) {
      console.error("[Amazon] Erro ao obter token:", err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Requisição Autenticada ───────────────────────────────
  async _request(method, path, params = {}, body = null) {
    const token = await this._getAccessToken();

    try {
      const config = {
        method,
        url: `${BASE_URL}${path}`,
        headers: {
          "x-amz-access-token": token,
          "Content-Type": "application/json",
        },
        params,
      };
      if (body) config.data = body;

      const { data } = await axios(config);
      return data;
    } catch (err) {
      console.error(`[Amazon] Erro em ${path}:`, err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Pedidos ──────────────────────────────────────────────
  async getOrders({ dateFrom, dateTo, maxResults = 50 } = {}) {
    const params = {
      MarketplaceIds: this.marketplaceId,
      MaxResultsPerPage: maxResults,
      SortOrder: "DESC",
    };

    if (dateFrom) params.CreatedAfter = new Date(dateFrom).toISOString();
    else params.CreatedAfter = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    if (dateTo) params.CreatedBefore = new Date(dateTo).toISOString();

    const data = await this._request("GET", "/orders/v0/orders", params);
    const orders = data?.payload?.Orders || [];

    // Buscar itens de cada pedido
    const pedidos = [];
    for (const o of orders.slice(0, 20)) {
      let itens = [];
      try {
        const itemData = await this._request("GET", `/orders/v0/orders/${o.AmazonOrderId}/orderItems`);
        itens = (itemData?.payload?.OrderItems || []).map((item) => ({
          id: item.ASIN,
          titulo: item.Title,
          quantidade: item.QuantityOrdered,
          preco: parseFloat(item.ItemPrice?.Amount || 0),
          sku: item.SellerSKU,
        }));
      } catch (_) {}

      pedidos.push({
        id: o.AmazonOrderId,
        marketplace: "amazon",
        status: this._mapStatus(o.OrderStatus),
        statusOriginal: o.OrderStatus,
        data: o.PurchaseDate,
        cliente: {
          id: o.BuyerInfo?.BuyerEmail || "N/A",
          nome: o.ShippingAddress?.Name || "Cliente Amazon",
          email: o.BuyerInfo?.BuyerEmail || null,
        },
        itens,
        valorTotal: parseFloat(o.OrderTotal?.Amount || 0),
        frete: o.ShipmentServiceLevelCategory || null,
        pagamento: o.PaymentMethod || "N/A",
      });
    }

    return {
      total: orders.length,
      pedidos,
      nextToken: data?.payload?.NextToken || null,
    };
  }

  // ─── Relatório de Inventário ──────────────────────────────
  async getProducts() {
    // Amazon usa Reports API para listar inventário
    try {
      // Solicitar relatório de inventário
      const reportData = await this._request("POST", "/reports/2021-06-30/reports", {}, {
        reportType: "GET_MERCHANT_LISTINGS_ALL_DATA",
        marketplaceIds: [this.marketplaceId],
      });

      // Nota: O relatório leva alguns minutos para ser gerado.
      // Em produção, implemente polling para buscar o resultado.
      console.log("[Amazon] Relatório de inventário solicitado:", reportData?.reportId);

      return {
        total: 0,
        produtos: [],
        mensagem: "Relatório de inventário solicitado. Use o reportId para buscar os resultados.",
        reportId: reportData?.reportId,
      };
    } catch (err) {
      console.error("[Amazon] Erro ao solicitar relatório:", err.message);
      return { total: 0, produtos: [] };
    }
  }

  // ─── Faturamento ──────────────────────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo });
    const completados = orders.pedidos.filter(
      (p) => p.statusOriginal === "Shipped" || p.statusOriginal === "Complete"
    );

    const receita = completados.reduce((sum, p) => sum + p.valorTotal, 0);
    const taxas = receita * 0.15; // Amazon cobra ~10-20% de comissão
    const lucroEstimado = receita - taxas;

    return {
      marketplace: "amazon",
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
      Pending: "Pendente",
      Unshipped: "Aguardando Envio",
      PartiallyShipped: "Parcialmente Enviado",
      Shipped: "Enviado",
      Complete: "Entregue",
      Canceled: "Cancelado",
      Unfulfillable: "Indisponível",
    };
    return map[status] || status;
  }
}

module.exports = new Amazon();
