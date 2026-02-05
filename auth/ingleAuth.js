// auth/ingleAuth.js
// Ingle-specific auth helpers
// Assumes optionalActorAuth has already run and may have set req.actor

export function isLocalRequest(req) {
  return (
    req.hostname === "localhost" ||
    req.hostname === "127.0.0.1"
  );
}

// Dev bypass via header (LOCAL ONLY)
export function attachIngleUserDevBypass(req, _res, next) {
  const allowDev =
    isLocalRequest(req) &&
    String(process.env.INGLE_DEV_BYPASS || "").toLowerCase() === "true";

  if (!allowDev) return next();

  const devEmail = String(req.headers["x-ingle-dev-email"] || "")
    .trim()
    .toLowerCase();

  if (!devEmail || !devEmail.includes("@")) return next();

  req.ingleUser = {
    email: devEmail,
    handle: devEmail.split("@")[0],
    actorId: null,
    is_dev: true,
  };

  return next();
}

// Normal path: derive Ingle user from unified actor JWT
export function attachIngleUser(req, _res, next) {
  if (req.ingleUser?.email) return next(); // preserve dev bypass

  const email = String(req.actor?.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) {
    req.ingleUser = null;
    return next();
  }

  req.ingleUser = {
    email,
    handle: email.split("@")[0],
    actorId: req.actor?.actorId ?? null,
    is_dev: false,
  };

  return next();
}

// Hard gate for submit / follow / etc.
export function requireIngleAuth(req, res, next) {
  if (req.ingleUser?.email) return next();
  return res.status(401).json({ ok: false, error: "auth_required" });
}