// ============================================================
// INTEGRAÇÃO: SHOPEE
// Documentação: https://open.shopee.com/documents
// ============================================================

const axios = require("axios");
const CryptoJS = require("crypto-js");

const BASE_URL = "https://partner.shopeemobile.com/api/v2";

class Shopee {
  constructor() {
    this.partnerId = parseInt(process.env.SHOPEE_PARTNER_ID);
    this.partnerKey = process.env.SHOPEE_PARTNER_KEY;
    this.shopId = parseInt(process.env.SHOPEE_SHOP_ID);
    this.accessToken = process.env.SHOPEE_ACCESS_TOKEN;
  }

  // ─── Gerar Assinatura HMAC-SHA256 ─────────────────────────
  _sign(path, timestamp) {
    const baseString = `${this.partnerId}${path}${timestamp}${this.accessToken}${this.shopId}`;
    return CryptoJS.HmacSHA256(baseString, this.partnerKey).toString(CryptoJS.enc.Hex);
  }

  // ─── Fazer Requisição Autenticada ─────────────────────────
  async _request(path, params = {}) {
    const timestamp = Math.floor(Date.now() / 1000);
    const sign = this._sign(path, timestamp);

    const allParams = {
      partner_id: this.partnerId,
      timestamp,
      sign,
      access_token: this.accessToken,
      shop_id: this.shopId,
      ...params,
    };

    try {
      const { data } = await axios.get(`${BASE_URL}${path}`, { params: allParams });

      if (data.error) {
        throw new Error(`[Shopee] ${data.error}: ${data.message}`);
      }
      return data.response;
    } catch (err) {
      console.error(`[Shopee] Erro em ${path}:`, err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Pedidos ──────────────────────────────────────────────
  async getOrders({ dateFrom, dateTo, pageSize = 50 } = {}) {
    const timeFrom = dateFrom
      ? Math.floor(new Date(dateFrom).getTime() / 1000)
      : Math.floor(Date.now() / 1000) - 15 * 24 * 3600; // últimos 15 dias
    const timeTo = dateTo
      ? Math.floor(new Date(dateTo).getTime() / 1000)
      : Math.floor(Date.now() / 1000);

    const response = await this._request("/order/get_order_list", {
      time_range_field: "create_time",
      time_from: timeFrom,
      time_to: timeTo,
      page_size: pageSize,
      order_status: "ALL",
    });

    if (!response?.order_list?.length) {
      return { total: 0, pedidos: [] };
    }

    // Buscar detalhes dos pedidos
    const orderIds = response.order_list.map((o) => o.order_sn).join(",");
    const details = await this._request("/order/get_order_detail", {
      order_sn_list: orderIds,
      response_optional_fields:
        "buyer_user_id,buyer_username,item_list,pay_time,total_amount,shipping_carrier",
    });

    const pedidos = (details?.order_list || []).map((o) => ({
      id: o.order_sn,
      marketplace: "shopee",
      status: this._mapStatus(o.order_status),
      statusOriginal: o.order_status,
      data: new Date(o.create_time * 1000).toISOString(),
      cliente: {
        id: o.buyer_user_id,
        nome: o.buyer_username,
        email: null,
      },
      itens: (o.item_list || []).map((item) => ({
        id: item.item_id,
        titulo: item.item_name,
        quantidade: item.model_quantity_purchased,
        preco: parseFloat(item.model_discounted_price || item.model_original_price),
        sku: item.item_sku,
      })),
      valorTotal: parseFloat(o.total_amount),
      frete: o.shipping_carrier || null,
      pagamento: "Shopee Pay",
    }));

    return { total: response.total_count || pedidos.length, pedidos };
  }

  // ─── Produtos ─────────────────────────────────────────────
  async getProducts({ offset = 0, pageSize = 50 } = {}) {
    const response = await this._request("/product/get_item_list", {
      offset,
      page_size: pageSize,
      item_status: "NORMAL",
    });

    if (!response?.item?.length) {
      return { total: 0, produtos: [] };
    }

    // Buscar detalhes
    const itemIds = response.item.map((i) => i.item_id).join(",");
    const details = await this._request("/product/get_item_base_info", {
      item_id_list: itemIds,
    });

    const produtos = (details?.item_list || []).map((p) => ({
      id: p.item_id,
      marketplace: "shopee",
      titulo: p.item_name,
      preco: parseFloat(p.price_info?.[0]?.current_price || 0),
      estoque: p.stock_info_v2?.summary_info?.total_available_stock || 0,
      status: p.item_status,
      categoria: p.category_id,
      imagem: p.image?.image_url_list?.[0] || null,
      link: null,
      sku: p.item_sku,
      vendidos: p.sale_count || 0,
    }));

    return { total: response.total_count || produtos.length, produtos };
  }

  // ─── Faturamento ──────────────────────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo });
    const completados = orders.pedidos.filter(
      (p) => p.statusOriginal === "COMPLETED" || p.statusOriginal === "SHIPPED"
    );

    const receita = completados.reduce((sum, p) => sum + p.valorTotal, 0);
    const taxas = receita * 0.08; // Shopee cobra ~6-12%
    const lucroEstimado = receita - taxas;

    return {
      marketplace: "shopee",
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
      UNPAID: "Aguardando Pagamento",
      READY_TO_SHIP: "Pronto para Envio",
      PROCESSED: "Processando",
      SHIPPED: "Enviado",
      COMPLETED: "Entregue",
      IN_CANCEL: "Em Cancelamento",
      CANCELLED: "Cancelado",
      INVOICE_PENDING: "Aguardando NF",
    };
    return map[status] || status;
  }
}

module.exports = new Shopee();
