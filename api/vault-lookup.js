// Tra cứu Kho của tôi — chỉ trả về link của các đơn ĐÃ GIAO qua Zalo.
// Giao hàng làm bằng tay qua Zalo: khách chuyển khoản xong, chủ shop nhắn Zalo
// giao link bằng tay rồi bấm "Đã giao qua Zalo" trong Quản trị — khi đó đơn
// mới tính là hoàn tất và link mới hiện trong Kho của tôi của khách.
// API này công khai nhưng chỉ nhận Gmail + số điện thoại của chính khách,
// và chỉ trả về mã đơn + tên + link sản phẩm của các đơn đã giao đó.
// Cần biến môi trường trên Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Khi chưa cấu hình thì trả lỗi not-configured để trang dùng cách tra cứu
// trong phiên xem này như trước.
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method-not-allowed", orders: [] });
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return res.status(503).json({ error: "not-configured", orders: [] });
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  const email = String((body && body.email) || "")
    .trim()
    .toLowerCase();
  const phone = String((body && body.phone) || "").replace(/\D/g, "");
  if (!email || !phone) {
    return res.status(400).json({ error: "bad-request", orders: [] });
  }
  try {
    const headers = { apikey: key, Authorization: "Bearer " + key };
    const r = await fetch(
      url +
        "/rest/v1/orders?select=code,items,customer_phone&customer_email=eq." +
        encodeURIComponent(email) +
        "&status=eq.delivered&order=created_at.desc&limit=20",
      { headers }
    );
    if (!r.ok) return res.status(200).json({ orders: [] });
    const rows = await r.json();
    const mine = (rows || []).filter(function (o) {
      return String(o.customer_phone || "").replace(/\D/g, "") === phone;
    });
    if (!mine.length) return res.status(200).json({ orders: [] });
    const pr = await fetch(url + "/rest/v1/products?select=id,name,link", {
      headers,
    });
    const prods = pr.ok ? await pr.json() : [];
    const byId = {};
    (prods || []).forEach(function (p) {
      byId[p.id] = p;
    });
    const orders = mine.map(function (o) {
      const items = (Array.isArray(o.items) ? o.items : []).map(function (it) {
        const id = it && typeof it === "object" ? it.id : String(it);
        const p = byId[id];
        return {
          id,
          name: (p && p.name) || (it && it.name) || id,
          link: (p && p.link) || "",
        };
      });
      return { code: o.code, items };
    });
    return res.status(200).json({ orders });
  } catch (e) {
    return res.status(200).json({ orders: [] });
  }
};
