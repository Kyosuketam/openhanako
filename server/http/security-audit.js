import { appendSecurityAuditEvent } from "../../core/security-audit-log.js";
import { readAuthPrincipal } from "./capability-guard.js";

export function recordSecurityAuditEvent(c, engine, {
  action,
  target = null,
  result = "success",
  secretFields = [],
  metadata = {},
} = {}) {
  return appendSecurityAuditEvent(engine?.hanakoHome, {
    action,
    target,
    result,
    actor: readAuthPrincipal(c),
    secretFields,
    metadata,
  });
}
