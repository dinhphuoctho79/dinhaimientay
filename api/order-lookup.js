// Tra cứu đơn hàng bằng mã đơn + số điện thoại — chỉ trả về đơn khớp cả hai.
// Trả trạng thái đơn, tổng tiền và từng món; link sản phẩm chỉ trả khi đơn
// ĐÃ GIAO qua Zalo (giao hàng làm bằng tay: khách chuyển khoản xong, chủ shop
// nhắn Zalo giao link/tài khoản bằng tay rồi bấm "Đã giao qua Zalo" trong
// Quản trị — khi đó đơn mới tính là hoàn tất). Đơn chưa giao thì chỉ hiện
// trạng thái, không hiện link.
// API này công khai nhưng cần cả mã đơn và số điện thoại đúng của đơn đó,
// để người lạ nhặt được mã đơn cũng không xem được đơn của khách.
// Cần biến môi trường trên Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Khi chưa cấu hình thì trả lỗi not-configured để trang tra cứu đơn trong
// phiên xem này như trước.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method-not-allowed", order: null });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(503).json({ error: "not-configured", order: null });
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const code = String((body && body.code) || "")
    .trim()
    .toUpperCase();
  const phone = String((body && body.phone) || "").replace(/\D/g, "");
  if (!code || !phone) {
    return res.status(400).json({ error: "bad-request", order: null });
  }
  try {
    const headers = { apikey: key, Authorization: "Bearer " + key };
    const r = await fetch(
      url +
        "/rest/v1/orders?select=code,status,total,items,created_at,customer_phone&code=eq." +
        encodeURIComponent(code) +
        "&limit=1",
      { headers }
    );
    if (!r.ok) return res.status(200).json({ order: null });
    const rows = await r.json();
    const row = (rows || [])[0];
    if (!row) return res.status(200).json({ order: null });
    if (String(row.customer_phone || "").replace(/\D/g, "") !== phone) {
      return res.status(200).json({ order: null });
    }
    const delivered = row.status === "delivered";
    const pr = await fetch(url + "/rest/v1/products?select=id,name,link,cat", {
      headers,
    });
    const prods = pr.ok ? await pr.json() : [];
    const byId = {};
    (prods || []).forEach(function (p) {
      byId[p.id] = p;
    });
    const items = (Array.isArray(row.items) ? row.items : []).map(function (it) {
      const id = it && typeof it === "object" ? it.id : String(it);
      const p = byId[id];
      return {
        id,
        name: (p && p.name) || (it && it.name) || id,
        cat: (p && p.cat) || "",
        link: delivered ? (p && p.link) || "" : "",
        delivery: (it && it.delivery) || "",
        upgrade_email: (it && it.upgrade_email) || "",
      };
    });
    return res.status(200).json({
      order: {
        code: row.code,
        status: row.status,
        total: row.total,
        created_at: row.created_at,
        items,
      },
    });
  } catch (e) {
    return res.status(200).json({ order: null });
  }
};
