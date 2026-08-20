// ============================================================
// INTEGRAÇÃO COMPLETA: MERCADO LIVRE (v3)
// Baseado na documentação oficial da API
// sale_fee, marketplace_fee, shipping real
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
      timeout: 20000,
    });
  }

  async refreshAccessToken() {
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
  }

  async _req(method, url, params = {}, retry = true) {
    try {
      const { data } = await this.api({ method, url, params });
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
    const d = await this._req("GET", "/users/me");
    return {
      id: d.id,
      nome: d.nickname,
      reputacao: d.seller_reputation?.level_id,
      transacoes: d.seller_reputation?.transactions?.completed,
    };
  }

  // ─── Buscar envio de um pedido ────────────────────────────
  async _getShipping(shippingId) {
    try {
      const d = await this._req("GET", `/shipments/${shippingId}`);
      return {
        id: d.id,
        status: d.status,
        tipoLogistico: d.logistic_type || d.mode || "N/A",
        custoVendedor: d.shipping_option?.cost || d.base_cost || 0,
        custoListado: d.shipping_option?.list_cost || 0,
        custoBase: d.base_cost || 0,
        nomeServico: d.shipping_option?.name || "N/A",
        rastreio: d.tracking_number || null,
        dataEnvio: d.status_history?.date_shipped || null,
        dataEntrega: d.status_history?.date_delivered || null,
      };
    } catch (e) {
      return null;
    }
  }

  // ─── PEDIDOS com dados financeiros reais ──────────────────
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
      // ── Pagamento (marketplace_fee real) ──
      const pag = o.payments?.[0] || {};
      const marketplaceFee = pag.marketplace_fee || 0;
      const transactionAmount = pag.transaction_amount || 0;
      const totalPaidAmount = pag.total_paid_amount || transactionAmount;
      const shippingCostPag = pag.shipping_cost || 0;

      // ── Itens (sale_fee real por item) ──
      const itens = (o.order_items || []).map((item) => ({
        id: item.item?.id || "",
        titulo: item.item?.title || "",
        sku: item.item?.seller_sku || item.item?.seller_custom_field || "",
        categoriaId: item.item?.category_id || "",
        condicao: item.item?.condition || "",
        tipoAnuncio: item.listing_type_id || "",
        variacaoId: item.item?.variation_id || null,
        quantidade: item.quantity || 1,
        precoUnitario: item.unit_price || 0,
        totalItem: (item.unit_price || 0) * (item.quantity || 1),
        grossPrice: item.gross_price || null,
        saleFee: item.sale_fee || 0,       // COMISSÃO REAL DO ML
        moeda: item.currency_id || "BRL",
      }));

      // ── Totais financeiros reais ──
      const totalBruto = o.total_amount || 0;
      const totalSaleFee = itens.reduce((s, i) => s + i.saleFee, 0);
      const totalTaxas = totalSaleFee + marketplaceFee;
      const receitaLiquida = totalBruto - totalTaxas;

      // ── Envio (buscar detalhes se shipping.id existe) ──
      let envio = { custoVendedor: 0, custoListado: 0, tipoLogistico: "N/A" };
      if (o.shipping?.id) {
        const shipData = await this._getShipping(o.shipping.id);
        if (shipData) envio = shipData;
      }

      const lucroOperacional = receitaLiquida - envio.custoVendedor;

      pedidos.push({
        id: o.id,
        marketplace: "mercadolivre",
        status: this._mapStatus(o.status),
        statusOriginal: o.status,
        statusDetalhe: o.status_detail || "",
        data: o.date_created,
        dateFechamento: o.date_closed,
        dataUltimaAtualizacao: o.last_updated,

        cliente: {
          id: o.buyer?.id,
          nome: o.buyer
            ? `${o.buyer.first_name || ""} ${o.buyer.last_name || ""}`.trim()
            : "N/A",
          apelido: o.buyer?.nickname || "",
        },

        itens,
        quantidadeItens: itens.reduce((s, i) => s + i.quantidade, 0),

        // ── Valores financeiros REAIS ──
        valorBruto: totalBruto,
        valorTotal: totalBruto,
        totalPago: totalPaidAmount,
        saleFee: totalSaleFee,           // Comissão ML real
        marketplaceFee: marketplaceFee,   // Taxa de pagamento real
        totalTaxas: totalTaxas,           // Total de taxas (comissão + taxa pag)
        receitaLiquida: receitaLiquida,   // Receita após taxas
        freteVendedor: envio.custoVendedor, // Frete real pago pelo vendedor
        freteListado: envio.custoListado,
        lucroOperacional: lucroOperacional, // Receita líquida - frete

        // ── Pagamento ──
        pagamento: {
          id: pag.id,
          metodo: pag.payment_type || "N/A",
          metodoPagamento: pag.payment_method_id || "",
          status: pag.status || "N/A",
          parcelas: pag.installments || 1,
          valorParcela: pag.installment_amount || totalBruto,
          taxaMarketplace: marketplaceFee,
          custoFretePagamento: shippingCostPag,
        },

        // ── Envio ──
        envio: {
          id: o.shipping?.id || null,
          status: envio.status || null,
          tipoLogistico: envio.tipoLogistico,
          custoVendedor: envio.custoVendedor,
          custoListado: envio.custoListado,
          servico: envio.nomeServico || "N/A",
          rastreio: envio.rastreio,
          dataEnvio: envio.dataEnvio,
          dataEntrega: envio.dataEntrega,
        },

        // ── Extras ──
        tags: o.tags || [],
        packId: o.pack_id || null,
        cupom: o.coupon?.amount || 0,
        impostos: o.taxes?.amount || 0,
      });
    }

    return {
      total: data.paging?.total || 0,
      offset: data.paging?.offset || 0,
      limit: data.paging?.limit || 50,
      pedidos,
    };
  }

  // ─── PRODUTOS / ANÚNCIOS ─────────────────────────────────
  async getProducts({ offset = 0, limit = 50 } = {}) {
    const ids = await this._req("GET", `/users/${this.sellerId}/items/search`, {
      offset, limit,
    });

    if (!ids.results?.length) return { total: ids.paging?.total || 0, produtos: [] };

    const produtos = [];
    for (let i = 0; i < ids.results.length; i += 20) {
      const batch = ids.results.slice(i, i + 20);
      const details = await this._req("GET", "/items", { ids: batch.join(",") });

      for (const item of (details || [])) {
        if (item.code !== 200) continue;
        const p = item.body;

        produtos.push({
          id: p.id,
          marketplace: "mercadolivre",
          titulo: p.title,
          preco: p.price,
          precoOriginal: p.original_price || p.price,
          estoque: p.available_quantity,
          vendidos: p.sold_quantity,
          status: p.status,
          condicao: p.condition,
          tipoAnuncio: p.listing_type_id,
          categoriaId: p.category_id,
          imagem: p.pictures?.[0]?.url || p.thumbnail,
          link: p.permalink,
          sku: p.seller_custom_field || "",
          dataCriacao: p.date_created,
          freteGratis: p.shipping?.free_shipping || false,
          catalogoId: p.catalog_product_id || null,
        });
      }
    }

    return { total: ids.paging?.total || 0, produtos };
  }

  // ─── FINANCEIRO com breakdown real ────────────────────────
  async getFinancials({ dateFrom, dateTo } = {}) {
    const orders = await this.getOrders({ dateFrom, dateTo, limit: 50 });
    const pagos = orders.pedidos.filter((p) =>
      ["Pago", "Enviado", "Entregue", "Confirmado"].includes(p.status)
    );

    const receita = pagos.reduce((s, p) => s + p.valorBruto, 0);
    const comissoesML = pagos.reduce((s, p) => s + p.saleFee, 0);
    const taxasPagamento = pagos.reduce((s, p) => s + p.marketplaceFee, 0);
    const totalTaxas = comissoesML + taxasPagamento;
    const receitaLiquida = receita - totalTaxas;
    const frete = pagos.reduce((s, p) => s + p.freteVendedor, 0);
    const lucroOperacional = receitaLiquida - frete;
    const cupons = pagos.reduce((s, p) => s + p.cupom, 0);
    const impostos = pagos.reduce((s, p) => s + p.impostos, 0);

    return {
      marketplace: "mercadolivre",
      periodo: { de: dateFrom, ate: dateTo },

      // Valores consolidados
      receita,
      receitaLiquida,
      comissoes: comissoesML,
      taxasPagamento,
      taxas: totalTaxas,
      frete,
      cupons,
      impostos,
      lucroEstimado: lucroOperacional,

      totalPedidos: orders.total,
      pedidosPagos: pagos.length,
      ticketMedio: pagos.length > 0 ? receita / pagos.length : 0,
      margemLiquida: receita > 0
        ? ((lucroOperacional / receita) * 100).toFixed(2)
        : "0",

      // DRE detalhado
      breakdown: {
        faturamentoBruto: receita,
        menosComissaoML: comissoesML,
        menosTaxaPagamento: taxasPagamento,
        totalDescontos: totalTaxas,
        igualReceitaLiquida: receitaLiquida,
        menosFrete: frete,
        menosCupons: cupons,
        menosImpostos: impostos,
        igualLucroOperacional: lucroOperacional,
      },
    };
  }

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
      partially_refunded: "Reembolso Parcial",
      pending_cancel: "Cancelamento Pendente",
      invalid: "Inválido",
    };
    return map[status] || status;
  }
}

module.exports = new MercadoLivre();
