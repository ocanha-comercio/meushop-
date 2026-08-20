// ============================================================
// INTEGRAÇÃO COMPLETA: MERCADO LIVRE
// Puxa dados detalhados: comissões, frete, taxas, receita líquida
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

  get api() {
    return axios.create({
      baseURL: BASE_URL,
      headers: { Authorization: `Bearer ${this.accessToken}` },
      timeout: 15000,
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
      console.log("[ML] Token renovado");
      return data;
    } catch (err) {
      console.error("[ML] Erro ao renovar token:", err.response?.data || err.message);
      throw err;
    }
  }

  // ─── Request com retry automático ─────────────────────────
  async _req(method, url, params = {}, retry = true) {
    try {
      const config = { method, url, params };
      const { data } = await this.api(config);
      return data;
    } catch (err) {
      if (err.response?.status === 401 && retry) {
        await this.refreshAccessToken();
        return this._req(method, url, params, false);
      }
      throw err;
    }
  }

  // ─── Dados do Vendedor ────────────────────────────────────
  async getSeller() {
    const data = await this._req("GET", "/users/me");
    return {
      id: data.id,
      nome: data.nickname,
      reputacao: data.seller_reputation?.level_id,
      transacoes: data.seller_reputation?.transactions?.completed,
    };
  }

  // ─── Pedidos DETALHADOS ───────────────────────────────────
  async getOrders({ offset = 0, limit = 50, dateFrom, dateTo } = {}) {
    const params = {
      seller: this.sellerId,
      offset,
      limit,
      sort: "date_desc",
    };
    if (dateFrom) params["order.date_created.from"] = dateFrom;
    if (dateTo) params["order.date_created.to"] = dateTo;

    const data = await this._req("GET", "/orders/search", params);
    const pedidos = [];

    for (const o of (data.results || [])) {
      // Extrair dados de pagamento (taxas reais)
      const pagamento = o.payments?.[0] || {};
      const taxaPagamento = pagamento.marketplace_fee || 0;
      const valorRecebido = pagamento.transaction_amount || o.total_amount || 0;
      const parcelamento = pagamento.installments || 1;

      // Extrair dados de frete
      let freteVendedor = 0;
      let freteComprador = 0;
      let tipoFrete = "N/A";

      if (o.shipping?.id) {
        try {
          const ship = await this._req("GET", `/shipments/${o.shipping.id}`);
          freteVendedor = ship.cost || ship.sender_cost || 0;
          freteComprador = ship.receiver_cost || ship.base_cost || 0;
          tipoFrete = ship.logistic_type || ship.shipping_mode || "N/A";
        } catch (e) {
          // Frete pode não estar acessível
        }
      }

      // Itens com comissão (sale_fee)
      const itens = (o.order_items || []).map((item) => {
        const comissao = item.sale_fee || 0;
        const precoUnitario = item.unit_price || 0;
        const quantidade = item.quantity || 1;
        const totalItem = precoUnitario * quantidade;

        return {
          id: item.item.id,
          titulo: item.item.title,
          sku: item.item.seller_sku || item.item.seller_custom_field || "",
          quantidade,
          precoUnitario,
          totalItem,
          comissao,
          categoriaId: item.item.category_id || "",
          condicao: item.item.condition || "",
          variacaoId: item.item.variation_id || null,
          imagem: null,
        };
      });

      // Calcular totais reais
      const totalBruto = o.total_amount || 0;
      const totalComissoes = itens.reduce((s, i) => s + i.comissao, 0);
      const totalTaxas = taxaPagamento + totalComissoes;
      const receitaLiquida = totalBruto - totalTaxas - freteVendedor;

      pedidos.push({
        id: o.id,
        marketplace: "mercadolivre",
        status: this._mapStatus(o.status),
        statusOriginal: o.status,
        statusDetalhe: o.status_detail || "",
        data: o.date_created,
        dataUltimaAtualizacao: o.last_updated,

        cliente: {
          id: o.buyer?.id,
          nome: o.buyer ? `${o.buyer.first_name || ""} ${o.buyer.last_name || ""}`.trim() : "N/A",
          apelido: o.buyer?.nickname || "",
          email: o.buyer?.email || null,
        },

        itens,

        // Valores financeiros reais
        valorBruto: totalBruto,
        valorTotal: totalBruto,
        comissaoML: totalComissoes,
        taxaPagamento,
        totalTaxas,
        freteVendedor,
        freteComprador,
        receitaLiquida,

        // Detalhes de pagamento
        pagamento: {
          metodo: pagamento.payment_type || "N/A",
          status: pagamento.status || "N/A",
          parcelas: parcelamento,
          valorPago: pagamento.total_paid_amount || totalBruto,
          taxaMarketplace: taxaPagamento,
        },

        // Detalhes de envio
        envio: {
          id: o.shipping?.id || null,
          tipo: tipoFrete,
          custoVendedor: freteVendedor,
          custoComprador: freteComprador,
        },

        // Tags e informações extras
        tags: o.tags || [],
        packId: o.pack_id || null,
      });
    }

    return {
      total: data.paging?.total || 0,
      offset: data.paging?.offset || 0,
      pedidos,
    };
  }

  // ─── Produtos / Anúncios DETALHADOS ──────────────────────
  async getProducts({ offset = 0, limit = 50 } = {}) {
    const ids = await this._req("GET", `/users/${this.sellerId}/items/search`, {
      offset,
      limit,
    });

    if (!ids.results?.length) return { total: ids.paging?.total || 0, produtos: [] };

    // Busca em lotes de 20
    const produtos = [];
    for (let i = 0; i < ids.results.length; i += 20) {
      const batch = ids.results.slice(i, i + 20);
      const details = await this._req("GET", "/items", { ids: batch.join(",") });

      for (const item of (details || [])) {
        if (item.code !== 200) continue;
        const p = item.body;

        // Buscar visitas do anúncio
        let visitas = 0;
        try {
          const v = await this._req("GET", `/items/${p.id}/visits/time_window`, {
            last: 30,
            unit: "day",
          });
          visitas = v.total_visits || 0;
        } catch (e) {}

        produtos.push({
          id: p.id,
          marketplace: "mercadolivre",
          titulo: p.title,
          preco: p.price,
          precoOriginal: p.original_price || p.price,
          moeda: p.currency_id,
          estoque: p.available_quantity,
          vendidos: p.sold_quantity,
          status: p.status,
          condicao: p.condition,
          tipoAnuncio: p.listing_type_id,
          categoriaId: p.category_id,
          imagem: p.pictures?.[0]?.url || p.thumbnail,
          link: p.permalink,
          sku: p.seller_custom_field || "",
          visitas30d: visitas,
          taxaConversao: visitas > 0 ? ((p.sold_quantity / visitas) * 100).toFixed(2) : "0",
          dataCriacao: p.date_created,
          saude: p.health || null,
          freteTipo: p.shipping?.mode || "N/A",
          freteGratis: p.shipping?.free_shipping || false,
          catalogoId: p.catalog_product_id || null,
        });
      }
    }

    return { total: ids.paging?.total || 0, produtos };
  }

  // ─── Faturamento com dados REAIS ──────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo, limit: 50 });
    const pagos = orders.pedidos.filter(
      (p) => ["Pago", "Enviado", "Entregue"].includes(p.status)
    );

    const receita = pagos.reduce((s, p) => s + p.valorBruto, 0);
    const comissoes = pagos.reduce((s, p) => s + p.comissaoML, 0);
    const taxasPagamento = pagos.reduce((s, p) => s + p.taxaPagamento, 0);
    const frete = pagos.reduce((s, p) => s + p.freteVendedor, 0);
    const totalTaxas = comissoes + taxasPagamento;
    const receitaLiquida = receita - totalTaxas;
    const lucroOperacional = receitaLiquida - frete;

    return {
      marketplace: "mercadolivre",
      periodo: { de: dateFrom, ate: dateTo },
      receita,
      receitaLiquida,
      comissoes,
      taxasPagamento,
      taxas: totalTaxas,
      frete,
      lucroEstimado: lucroOperacional,
      totalPedidos: orders.total,
      pedidosPagos: pagos.length,
      ticketMedio: pagos.length > 0 ? receita / pagos.length : 0,
      margemLiquida: receita > 0 ? ((lucroOperacional / receita) * 100).toFixed(2) : "0",

      // Breakdown detalhado
      breakdown: {
        faturamentoBruto: receita,
        menosComissaoML: comissoes,
        menosTaxaPagamento: taxasPagamento,
        igualReceitaLiquida: receitaLiquida,
        menosFrete: frete,
        igualLucroOperacional: lucroOperacional,
      },
    };
  }

  // ─── Mapeamento de Status ─────────────────────────────────
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
