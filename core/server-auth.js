import { authenticateDeviceCredential } from "./device-registry.js";

export function createServerAuthService({
  hanakoHome,
  loopbackToken,
  runtimeContext,
}) {
  if (!hanakoHome) throw new Error("hanakoHome required");
  if (!isNonEmptyString(loopbackToken)) throw new Error("loopbackToken required");

  function resolveRuntimeContext() {
    return typeof runtimeContext === "function" ? runtimeContext() : runtimeContext;
  }

  function authenticateRequest({
    authorization = null,
    queryToken = null,
    allowQueryToken = false,
    connectionKind = "local",
    now,
  } = {}) {
    const parsed = parseCredential({ authorization, queryToken, allowQueryToken, connectionKind });
    if (!parsed) return null;

    if (parsed.token === loopbackToken) {
      if (connectionKind !== "local") return null;
      return createLocalPrincipal(resolveRuntimeContext());
    }

    const devicePrincipal = authenticateDeviceCredential(hanakoHome, parsed.token, { now });
    if (!devicePrincipal) return null;
    if (!deviceCredentialAllowsConnection(devicePrincipal, connectionKind)) return null;
    return deepFreeze({
      ...devicePrincipal,
      connectionKind: connectionKind === "local" ? devicePrincipal.connectionKind : connectionKind,
    });
  }

  function authenticateToken(token, options = {}) {
    return authenticateRequest({
      ...options,
      authorization: token ? `Bearer ${token}` : null,
    });
  }

  return Object.freeze({
    authenticateRequest,
    authenticateToken,
  });
}

export function parseBearerAuthorization(authorization) {
  if (!isNonEmptyString(authorization)) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match ? match[1].trim() : null;
}

function parseCredential({ authorization, queryToken, allowQueryToken, connectionKind }) {
  const bearer = parseBearerAuthorization(authorization);
  if (bearer) return { token: bearer, source: "authorization" };
  if (!allowQueryToken || !isNonEmptyString(queryToken)) return null;
  if (connectionKind !== "local") return null;
  return { token: queryToken.trim(), source: "query" };
}

function createLocalPrincipal(runtimeContext) {
  return deepFreeze({
    kind: "local_user",
    credentialKind: "loopback_token",
    connectionKind: "local",
    trustState: "local",
    serverId: runtimeContext?.serverId ?? null,
    serverNodeId: runtimeContext?.serverNodeId ?? runtimeContext?.serverId ?? null,
    userId: runtimeContext?.userId ?? null,
    studioId: runtimeContext?.studioId ?? null,
    platformAccountId: runtimeContext?.platformAccountId ?? null,
    officialServiceKind: runtimeContext?.officialServiceKind ?? null,
    scopes: Array.isArray(runtimeContext?.capabilities) ? [...runtimeContext.capabilities] : ["chat", "resources", "tools"],
  });
}

function deviceCredentialAllowsConnection(principal, connectionKind) {
  if (!principal || principal.kind !== "device") return true;
  if (connectionKind === "local") return true;
  if (principal.trustState === "tunnel") return connectionKind === "custom_remote";
  return connectionKind === "lan";
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
