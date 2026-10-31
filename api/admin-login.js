// Đăng nhập quản trị Dinh AI Miền Tây — chạy phía máy chủ trên Vercel.
// Cần biến môi trường trên Vercel (chủ shop tự nhập, KHÔNG ghi trong mã):
//   ADMIN_PASSWORD_HASH = sha256(mật khẩu quản trị) dạng hex,
//   APP_SECRET = chuỗi bí mật bất kỳ (dùng để ký token).
// Trả về token có hạn 12 giờ, ký bằng APP_SECRET.
const crypto = require("crypto");

function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "method-not-allowed" });
  }
  const hash = process.env.ADMIN_PASSWORD_HASH;
  const secret = process.env.APP_SECRET;
  if (!hash || !secret) {
    return res.status(503).json({
      error: "not-configured",
      message: "Chưa cấu hình đăng nhập quản trị phía máy chủ.",
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
  const password =
    body && typeof body.password === "string" ? body.password : "";
  let ok = false;
  if (password) {
    const a = Buffer.from(sha256(password));
    const b = Buffer.from(String(hash).toLowerCase());
    ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  if (!ok) {
    return res
      .status(401)
      .json({ error: "wrong-password", message: "Sai mật khẩu quản trị." });
  }
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000; // 12 giờ
  const sig = crypto
    .createHmac("sha256", secret)
    .update(String(expiresAt))
    .digest("hex");
  return res.status(200).json({ token: expiresAt + "." + sig, expiresAt });
};
