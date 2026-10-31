// API quản trị Dinh AI Miền Tây — chạy phía máy chủ trên Vercel.
// Cần biến môi trường trên Vercel (chủ shop tự nhập, KHÔNG ghi trong mã):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, APP_SECRET
// Mọi thao tác đều cần token đăng nhập quản trị (lấy từ /api/admin-login).
//
// Luồng giao hàng: giao bằng tay qua Zalo, KHÔNG giao tự động.
// Đơn ở trạng thái chờ xác nhận -> chủ shop nhắn Zalo giao link bằng tay ->
// bấm "Đã giao qua Zalo" (update-order -> delivered) -> link mới hiện trong
// Kho của tôi của khách. Khi đơn chuyển sang delivered, hoa hồng CTV (nếu đơn
// có mã giới thiệu) được ghi vào bảng affiliate_orders với trạng thái giữ.
const crypto = require("crypto");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_SECRET = process.env.APP_SECRET;

function verifyToken(token) {
  if (!token || !APP_SECRET) return false;
  const parts = String(token).split(".");
  if (parts.length !== 2) return false;
  const expiresAt = parseInt(parts[0], 10);
  if (!expiresAt || Date.now() > expiresAt) return false;
  const sig = crypto
    .createHmac("sha256", APP_SECRET)
    .update(parts[0])
    .digest("hex");
  const a = Buffer.from(sig);
  const b = Buffer.from(parts[1]);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function sb(path, method, body, prefer) {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json",
    Prefer: prefer || "return=representation",
  };
  return fetch(SUPABASE_URL + "/rest/v1/" + path, {
    method: method || "GET",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  }).then(async (r) => {
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      data = text;
    }
    if (!r.ok) {
      const err = new Error("Supabase " + r.status);
      err.data = data;
      throw err;
    }
    return data;
  });
}

// Mức hoa hồng theo tổng số đơn của CTV: 1–9 đơn 10%, 10–29 đơn 12%, từ 30 đơn 13%.
// Hoa hồng tính trên giá trị đơn SAU giảm giá (order.total là tổng tiền khách phải chuyển).
function tierRate(orderCount) {
  if (orderCount >= 30) return 13;
  if (orderCount >= 10) return 12;
  return 10;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method-not-allowed" });
  }
  if (!SUPABASE_URL || !SERVICE_KEY || !APP_SECRET) {
    return res.status(503).json({
      error: "not-configured",
      message: "Chưa cấu hình API quản trị phía máy chủ.",
    });
  }
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!verifyToken(token)) {
    return res.status(401).json({
      error: "unauthorized",
      message: "Chưa đăng nhập quản trị hoặc phiên đã hết hạn.",
    });
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (e) {
      body = {};
    }
  }
  if (!body || typeof body !== "object") body = {};
  const action = body.action;

  try {
    if (action === "ping") return res.status(200).json({ ok: true });

    if (action === "list-orders") {
      const orders = await sb(
        "orders?select=*&order=created_at.desc&limit=100"
      );
      return res.status(200).json({ orders: orders || [] });
    }

    if (action === "list-affiliates") {
      const affiliates = await sb(
        "affiliates?select=*&order=created_at.desc&limit=200"
      );
      const affOrders = await sb(
        "affiliate_orders?select=*&order=created_at.desc&limit=500"
      );
      return res.status(200).json({
        affiliates: affiliates || [],
        affiliate_orders: affOrders || [],
      });
    }

    if (action === "update-order") {
      const code = String(body.code || "");
      const status = String(body.status || "");
      if (
        !code ||
        ["pending", "paid", "delivered", "cancelled"].indexOf(status) === -1
      ) {
        return res.status(400).json({ error: "bad-request" });
      }
      const updated = await sb(
        "orders?code=eq." + encodeURIComponent(code),
        "PATCH",
        { status }
      );
      const order = Array.isArray(updated) ? updated[0] : updated;
      // Khi chủ shop bấm "Đã giao qua Zalo": nếu đơn có mã giới thiệu thì ghi
      // hoa hồng cho CTV đó (tính theo bậc, trạng thái giữ).
      if (status === "delivered" && order && order.ref_code) {
        // Chỉ ghi hoa hồng khi mã giới thiệu thuộc về 1 CTV đã đăng ký
        // (tránh ghi cho mã gõ bừa trong link).
        const aff = await sb(
          "affiliates?select=code&code=eq." + encodeURIComponent(order.ref_code)
        );
        if (!aff || !aff.length) return res.status(200).json({ order });
        const existing = await sb(
          "affiliate_orders?select=id&order_code=eq." +
            encodeURIComponent(code)
        );
        if (!existing || !existing.length) {
          const mine = await sb(
            "affiliate_orders?select=id&aff_code=eq." +
              encodeURIComponent(order.ref_code)
          );
          const rate = tierRate((mine ? mine.length : 0) + 1);
          const productName = Array.isArray(order.items)
            ? order.items
                .map((it) =>
                  it && typeof it === "object" ? it.name || it.id : String(it)
                )
                .join("; ")
            : "";
          await sb(
            "affiliate_orders",
            "POST",
            [
              {
                aff_code: order.ref_code,
                order_code: code,
                product_name: productName,
                total: order.total || 0,
                rate,
                commission: Math.round(((order.total || 0) * rate) / 100),
                status: "hold",
              },
            ],
            "return=representation"
          );
        }
      }
      return res.status(200).json({ order });
    }

    if (action === "update-affiliate") {
      const code = String(body.code || "");
      const status = String(body.status || "");
      if (
        !code ||
        ["pending", "active", "rejected"].indexOf(status) === -1
      ) {
        return res.status(400).json({ error: "bad-request" });
      }
      const updated = await sb(
        "affiliates?code=eq." + encodeURIComponent(code),
        "PATCH",
        { status }
      );
      return res.status(200).json({
        affiliate: Array.isArray(updated) ? updated[0] : updated,
      });
    }

    if (action === "update-affiliate-order") {
      const id = String(body.id || "");
      const status = String(body.status || "");
      if (!id || ["hold", "ready", "paid"].indexOf(status) === -1) {
        return res.status(400).json({ error: "bad-request" });
      }
      const updated = await sb(
        "affiliate_orders?id=eq." + encodeURIComponent(id),
        "PATCH",
        { status }
      );
      return res.status(200).json({
        affiliate_order: Array.isArray(updated) ? updated[0] : updated,
      });
    }

    if (action === "save-product") {
      const p = body.product || {};
      if (!p.id || !p.name) return res.status(400).json({ error: "bad-request" });
      const row = {
        id: p.id,
        name: p.name,
        cat: p.cat,
        price: p.price || 0,
        old_price: p.old_price || 0,
        hot: !!p.hot,
        link: p.link || "",
        description: p.description || "",
        includes: Array.isArray(p.includes) ? p.includes : [],
        img: p.img || "",
      };
      const saved = await sb(
        "products?on_conflict=id",
        "POST",
        row,
        "return=representation,resolution=merge-duplicates"
      );
      return res.status(200).json({
        product: Array.isArray(saved) ? saved[0] : saved,
      });
    }

    if (action === "delete-product") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "bad-request" });
      await sb(
        "products?id=eq." + encodeURIComponent(id),
        "DELETE",
        undefined,
        "return=minimal"
      );
      return res.status(200).json({ ok: true });
    }

    if (action === "save-promo") {
      const p = body.promo || {};
      if (!p.id || !p.code) return res.status(400).json({ error: "bad-request" });
      const row = {
        id: p.id,
        code: p.code,
        type: p.type || "percent",
        value: p.value || 0,
        expiry: p.expiry || null,
        active: !!p.active,
      };
      const saved = await sb(
        "promos?on_conflict=id",
        "POST",
        row,
        "return=representation,resolution=merge-duplicates"
      );
      return res.status(200).json({
        promo: Array.isArray(saved) ? saved[0] : saved,
      });
    }

    if (action === "delete-promo") {
      const id = String(body.id || "");
      if (!id) return res.status(400).json({ error: "bad-request" });
      await sb(
        "promos?id=eq." + encodeURIComponent(id),
        "DELETE",
        undefined,
        "return=minimal"
      );
      return res.status(200).json({ ok: true });
    }

    if (action === "save-settings") {
      const s = body.settings || {};
      const rows = [
        { key: "zalo", value: String(s.zalo || "") },
        { key: "bank", value: String(s.bank || "") },
        { key: "bank_bin", value: String(s.bank_bin || "") },
        { key: "bank_account", value: String(s.bank_account || "") },
        { key: "bank_holder", value: String(s.bank_holder || "") },
        { key: "qr_img", value: String(s.qr_img || "") },
      ];
      await sb(
        "settings?on_conflict=key",
        "POST",
        rows,
        "return=minimal,resolution=merge-duplicates"
      );
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "unknown-action" });
  } catch (err) {
    return res
      .status(500)
      .json({ error: "server-error", detail: String((err && err.message) || err) });
  }
};
