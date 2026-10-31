// API công khai: trả về số điện thoại đã che của đơn thật gần nhất
// (để hiện toast "Khách vừa mua" trên trang shop).
// Chỉ trả về 6 số đầu + "xxxx", không trả tên, email hay số đầy đủ.
// Cần biến môi trường trên Vercel: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Khi chưa cấu hình (hoặc chưa có đơn thật nào đã giao) thì trả { phone: null }
// để trang dùng số ngẫu nhiên dự phòng.
module.exports = async (req, res) => {
  if (req.method !== "GET") return res.status(405).json({ phone: null });
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return res.status(200).json({ phone: null });
  try {
    const r = await fetch(
      url +
        "/rest/v1/orders?select=customer_phone&status=in.(paid,delivered)&order=created_at.desc&limit=1",
      { headers: { apikey: key, Authorization: "Bearer " + key } }
    );
    if (!r.ok) return res.status(200).json({ phone: null });
    const rows = await r.json();
    const phone = rows && rows[0] && rows[0].customer_phone;
    const d = String(phone || "").replace(/\D/g, "");
    if (d.length < 6) return res.status(200).json({ phone: null });
    return res.status(200).json({ phone: d.slice(0, 6) + "xxxx" });
  } catch (e) {
    return res.status(200).json({ phone: null });
  }
};
