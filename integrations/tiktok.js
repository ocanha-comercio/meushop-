// ============================================================
// INTEGRAÇÃO: TIKTOK SHOP
// Documentação: https://partner.tiktokshop.com/docv2
// ============================================================

const axios = require("axios");
const CryptoJS = require("crypto-js");

const BASE_URL = "https://open-api.tiktokglobalshop.com";

class TikTokShop {
  constructor() {
    this.appKey = process.env.TIKTOK_APP_KEY;
    this.appSecret = process.env.TIKTOK_APP_SECRET;
    this.accessToken = process.env.TIKTOK_ACCESS_TOKEN;
    this.shopId = process.env.TIKTOK_SHOP_ID;
  }

  // ─── Gerar Assinatura ─────────────────────────────────────
  _sign(path, params, timestamp) {
    const sortedKeys = Object.keys(params).sort();
    let baseString = `${this.appSecret}${path}`;
    for (const key of sortedKeys) {
      baseString += `${key}${params[key]}`;
    }
    baseString += this.appSecret;
    return CryptoJS.HmacSHA256(baseString, this.appSecret).toString(CryptoJS.enc.Hex);
  }

  // ─── Requisição Autenticada ───────────────────────────────
  async _request(path, params = {}, method = "GET") {
    const timestamp = Math.floor(Date.now() / 1000);

    const queryParams = {
      app_key: this.appKey,
      timestamp: timestamp.toString(),
      shop_id: this.shopId,
      access_token: this.accessToken,
      ...params,
    };

    queryParams.sign = this._sign(path, queryParams, timestamp);

    try {
      const config = {
        method,
        url: `${BASE_URL}${path}`,
        params: method === "GET" ? queryParams : { app_key: this.appKey, timestamp, sign: queryParams.sign },
      };
      if (method === "POST") config.data = params;

      const { data } = await axios(config);

      if (data.code !== 0) {
        throw new Error(`[TikTok] ${data.code}: ${data.message}`);
      }
      return data.data;
    } catch (err) {
      console.error(`[TikTok] Erro em ${path}:`, err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Pedidos ──────────────────────────────────────────────
  async getOrders({ dateFrom, dateTo, pageSize = 50 } = {}) {
    const timeFrom = dateFrom
      ? Math.floor(new Date(dateFrom).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
    const timeTo = dateTo
      ? Math.floor(new Date(dateTo).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const response = await this._request("/api/orders/search", {
      create_time_from: timeFrom,
      create_time_to: timeTo,
      page_size: pageSize,
      sort_by: "CREATE_TIME",
      sort_type: "DESC",
    }, "POST");

    const pedidos = (response?.order_list || []).map((o) => ({
      id: o.order_id,
      marketplace: "tiktok",
      status: this._mapStatus(o.order_status),
      statusOriginal: o.order_status,
      data: new Date(o.create_time * 1000).toISOString(),
      cliente: {
        id: o.buyer_uid || "N/A",
        nome: o.recipient_address?.name || "Cliente TikTok",
        email: null,
      },
      itens: (o.item_list || []).map((item) => ({
        id: item.product_id,
        titulo: item.product_name,
        quantidade: item.quantity,
        preco: parseFloat(item.sale_price || 0),
        sku: item.seller_sku,
      })),
      valorTotal: parseFloat(o.payment_info?.total_amount || 0),
      frete: o.shipping_provider || null,
      pagamento: o.payment_method_name || "TikTok Pay",
    }));

    return { total: response?.total_count || pedidos.length, pedidos };
  }

  // ─── Produtos ─────────────────────────────────────────────
  async getProducts({ pageNumber = 1, pageSize = 50 } = {}) {
    const response = await this._request("/api/products/search", {
      page_number: pageNumber,
      page_size: pageSize,
    }, "POST");

    const produtos = (response?.products || []).map((p) => ({
      id: p.id,
      marketplace: "tiktok",
      titulo: p.name,
      preco: parseFloat(p.skus?.[0]?.price?.sale_price || 0),
      estoque: p.skus?.reduce((sum, s) => sum + (s.stock_infos?.[0]?.available_stock || 0), 0) || 0,
      status: p.status === 4 ? "active" : "inactive",
      categoria: p.category_list?.[0]?.id || null,
      imagem: p.images?.[0]?.url_list?.[0] || null,
      link: null,
      sku: p.skus?.[0]?.seller_sku || null,
      vendidos: p.sale_count || 0,
    }));

    return { total: response?.total_count || produtos.length, produtos };
  }

  // ─── Faturamento ──────────────────────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo });
    const completados = orders.pedidos.filter(
      (p) =>
        p.statusOriginal === "COMPLETED" ||
        p.statusOriginal === "DELIVERED" ||
        p.statusOriginal === "SHIPPED"
    );

    const receita = completados.reduce((sum, p) => sum + p.valorTotal, 0);
    const taxas = receita * 0.05; // TikTok cobra ~5%
    const lucroEstimado = receita - taxas;

    return {
      marketplace: "tiktok",
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
      AWAITING_SHIPMENT: "Aguardando Envio",
      AWAITING_COLLECTION: "Aguardando Coleta",
      PARTIALLY_SHIPPING: "Parcialmente Enviado",
      IN_TRANSIT: "Em Trânsito",
      DELIVERED: "Entregue",
      COMPLETED: "Completo",
      CANCELLED: "Cancelado",
      UNPAID: "Aguardando Pagamento",
    };
    return map[status] || status;
  }
}

module.exports = new TikTokShop();
